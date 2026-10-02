import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
const root = await mkdtemp(join(tmpdir(), 'scope-lifecycle-'));
const cwd = join(root,'project'), agentDir = join(root,'agent');
await mkdir(cwd,{recursive:true}); await mkdir(agentDir,{recursive:true});
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR=agentDir;
const jiti = createJiti(import.meta.url);
const { createSubagentController } = await jiti.import('./subagent-runtime.ts');
const { startRpcSession } = await jiti.import('./rpc-manager.ts');
const { readSubagentSessionResources, SUBAGENT_META_TYPE } = await jiti.import('./subagents.ts');
const put = async (path, body) => { await mkdir(join(path,'..'),{recursive:true}); await writeFile(path,body); };
const wrappers = new Map();
const code = name => `globalThis.__lifecycleEffects.push('${name}:module');export default pi=>{
  globalThis.__lifecycleEffects.push('${name}:factory');
  pi.on('session_start',()=>globalThis.__lifecycleEffects.push('${name}:handler'));
  pi.registerProvider('${name}',{api:'openai-completions',baseUrl:'https://example.invalid',apiKey:'test',models:[{id:'model',name:'model',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:4096,maxTokens:256}]});
}`;

test('fresh controller, live resume and RPC reopen preserve declarations and exclude module/factory/handler/provider effects', async () => {
  globalThis.__lifecycleEffects=[];
  const rpcWrappers=[];
  try {
    await put(join(agentDir,'allowed.mjs'),code('allowed'));
    await put(join(agentDir,'excluded.mjs'),code('excluded'));
    await put(join(agentDir,'settings.json'),JSON.stringify({extensions:['allowed.mjs','excluded.mjs']}));
    await put(join(cwd,'.pi/agents/scoped.md'),'---\nextensions: allowed\nmodel: allowed/model\ntools: read\n---\nWork');
    const modelRuntime=await ModelRuntime.create({authPath:join(agentDir,'auth.json'),modelsPath:join(agentDir,'models.json')});
    const manager=SessionManager.create(cwd,join(root,'sessions'));
    const parent={cwd,sessionFile:join(root,'parent.jsonl'),isAlive:()=>true,isRunning:()=>false,inner:{modelRuntime,sessionManager:manager,agent:{state:{thinkingLevel:'off'}}}};
    wrappers.set(manager.getSessionId(),parent);
    const controller=createSubagentController({
      getSession:id=>wrappers.get(id),
      registerSession:inner=>{
        const ready=inner.bindExtensions({});
        inner.prompt=async()=>{}; // Startup/lifecycle is real; no network generation.
        wrappers.set(inner.sessionId,{cwd,sessionFile:inner.sessionFile,inner,isAlive:()=>true,isRunning:()=>false,waitUntilReady:()=>ready});
      },
      reopenSession:async()=>{throw Error('unexpected reopen')},
      resolveSessionPath:async id=>wrappers.get(id)?.sessionFile,
      invalidateSessionList:()=>{},isBuiltInSubagentsEnabled:()=>true,
    });
    const execution=await controller.extensionRuntime.start({parentContext:parent.inner,parentToolCallId:'call',profile:'scoped',task:'task',description:'task'});
    await execution.completion;
    assert.deepEqual(globalThis.__lifecycleEffects,['allowed:module','allowed:factory','allowed:handler']);
    const child=wrappers.get(execution.run.sessionId);
    assert.equal(child.inner.model.provider,'allowed');
    assert.equal(modelRuntime.getModel('excluded','model'),undefined);
    const resources=readSubagentSessionResources(child.inner.sessionManager.getEntries());
    assert.deepEqual(resources.extensionScope,['allowed']);
    assert.equal(JSON.stringify(resources).includes('allowed.mjs'),false);
    const declaration=child.inner.sessionManager.getEntries().find(entry=>entry.customType===SUBAGENT_META_TYPE).data.resourceSnapshot;
    declaration.extensionScope=[''];
    await assert.rejects(controller.extensionRuntime.resume({parentContext:parent.inner,parentToolCallId:'invalid',sessionId:child.inner.sessionId,task:'no',description:'no'}),/extensionScope/);
    declaration.extensionScope=['allowed'];
    const resumed=await controller.extensionRuntime.resume({parentContext:parent.inner,parentToolCallId:'again',sessionId:child.inner.sessionId,task:'again',description:'again'});
    await resumed.completion;
    assert.deepEqual(readSubagentSessionResources(child.inner.sessionManager.getEntries()).extensionScope,['allowed']);
    // Persist a finalized message so SDK model restoration is exercised without a request.
    child.inner.sessionManager.appendMessage({role:'user',content:'saved',timestamp:Date.now()});
    child.inner.dispose();
    globalThis.__lifecycleEffects=[];
    const reopened=await startRpcSession(child.inner.sessionId,child.sessionFile,cwd);
    rpcWrappers.push(reopened.session);
    await reopened.session.waitUntilReady();
    assert.equal(reopened.session.inner.model.provider,'allowed');
    assert.ok(!globalThis.__lifecycleEffects.some(value=>value.startsWith('excluded:')));
    assert.ok(globalThis.__lifecycleEffects.includes('allowed:handler'));
    // Live RPC startup cannot bypass malformed scope validation either.
    const liveSnapshot=reopened.session.inner.sessionManager.getEntries().find(entry=>entry.customType===SUBAGENT_META_TYPE).data.resourceSnapshot;
    liveSnapshot.extensionScope='allowed';
    await assert.rejects(startRpcSession(child.inner.sessionId,child.sessionFile,cwd),/extensionScope/);
    liveSnapshot.extensionScope=['allowed'];
    await reopened.session.shutdown();
    for(const [extensionScope,loadExtensions,expected] of [[[],true,[]],[['allowed'],false,[]],[undefined,true,['allowed:factory','excluded:module','excluded:factory','allowed:handler','excluded:handler']]]) {
      const saved=SessionManager.create(cwd,join(root,'sessions'));
      saved.appendCustomEntry(SUBAGENT_META_TYPE,{version:1,parentSessionId:manager.getSessionId(),parentSessionPath:parent.sessionFile,resourceSnapshot:{version:1,appendSystemPrompt:[],tools:['read'],loadSkills:false,loadExtensions,...(extensionScope===undefined?{}:{extensionScope})}});
      saved.appendMessage({role:'user',content:'saved',timestamp:Date.now()});
      globalThis.__lifecycleEffects=[];
      const result=await startRpcSession(saved.getSessionId(),saved.getSessionFile(),cwd);
      rpcWrappers.push(result.session);
      await result.session.waitUntilReady();
      assert.deepEqual(globalThis.__lifecycleEffects,expected);
      assert.deepEqual(readSubagentSessionResources(result.session.inner.sessionManager.getEntries()).extensionScope,extensionScope);
      await result.session.shutdown();
    }
    // Fresh controller with explicit [] remains scoped rather than native fallback.
    await put(join(cwd,'.pi/agents/empty.md'),'---\nextensions: []\nload_extensions: true\ntools: read\n---\nWork');
    globalThis.__lifecycleEffects=[];
    const empty=await controller.extensionRuntime.start({parentContext:parent.inner,parentToolCallId:'empty',profile:'empty',task:'empty',description:'empty'});
    await empty.completion;
    assert.deepEqual(globalThis.__lifecycleEffects,[]);
    assert.deepEqual(readSubagentSessionResources(wrappers.get(empty.run.sessionId).inner.sessionManager.getEntries()).extensionScope,[]);
    const text=await readFile(child.sessionFile,'utf8');
    const entries=text.trim().split('\n').map(line=>JSON.parse(line));
    entries.find(entry=>entry.customType===SUBAGENT_META_TYPE).data.resourceSnapshot.extensionScope=[''];
    await writeFile(child.sessionFile,entries.map(entry=>JSON.stringify(entry)).join('\n')+'\n');
    globalThis.__lifecycleEffects=[];
    await assert.rejects(startRpcSession(child.inner.sessionId,child.sessionFile,cwd),/extensionScope/);
    assert.deepEqual(globalThis.__lifecycleEffects,[]);
  } finally {
    for(const wrapper of rpcWrappers) await wrapper.shutdown();
    for(const wrapper of wrappers.values()) wrapper.inner.dispose?.();
    if(previous===undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR=previous;
    delete globalThis.__lifecycleEffects;
    await rm(root,{recursive:true,force:true});
  }
});
