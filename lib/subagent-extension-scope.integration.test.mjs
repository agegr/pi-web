import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
import { ProjectTrustStore, SettingsManager, createAgentSessionFromServices, SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxText, getCurrentSystemPrompt } from '@earendil-works/pi-ai';
const { createScopedAgentSessionServices } = await createJiti(import.meta.url).import('./subagent-extension-scope.ts');
const { createExactSystemPromptExtension } = await createJiti(import.meta.url).import('./exact-system-prompt.ts');

test('empty and suppressed scopes retain the real exact-prompt factory and native/virtual provider services-first registration', () => fixture(async ({cwd,agentDir,put}) => {
  const faux=fauxProvider({id:'scope-native',models:[{id:'model'}]});
  globalThis.__scopeNative=faux.provider;
  try {
    await put(join(agentDir,'extensions/allowed.mjs'),`export default pi=>{pi.registerProvider(globalThis.__scopeNative);pi.registerVirtualModel({provider:'scope-router',id:'auto',name:'auto',route:()=>({model:globalThis.__scopeNative.getModels()[0],thinkingLevel:'off'})});}`);
    const selected=await createScopedAgentSessionServices({cwd,agentDir},['allowed']);
    assert.ok(selected.modelRuntime.getModel(faux.provider.id,'model'));
    assert.ok(selected.modelRuntime.getModel('scope-router','auto'));
    for(const [scope,noExtensions] of [[[],false],[['allowed'],true]]) {
      const services=await createScopedAgentSessionServices({cwd,agentDir,modelRuntime:selected.modelRuntime,resourceLoaderOptions:{noExtensions,extensionFactories:[createExactSystemPromptExtension(()=> 'Exact scope prompt')]}},scope);
      let prompt;
      faux.setResponses([context=>{prompt=getCurrentSystemPrompt(context.messages);return fauxAssistantMessage([fauxText('done')]);}]);
      const {session}=await createAgentSessionFromServices({services,sessionManager:SessionManager.inMemory(cwd),model:faux.getModel('model'),tools:[]});
      try {await session.bindExtensions({});await session.prompt('go');assert.equal(prompt,'Exact scope prompt');}
      finally {session.dispose();}
    }
  } finally {delete globalThis.__scopeNative;}
}));
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'scope-loader-'));
  const cwd = join(root, 'project'), agentDir = join(root, 'agent');
  await mkdir(cwd, { recursive: true }); await mkdir(agentDir, { recursive: true });
  globalThis.__scopeEffects = [];
  const put = async (path, body) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, body); };
  await put(join(agentDir,'settings.json'), JSON.stringify({extensions:['extensions/allowed.mjs','extensions/excluded.mjs']}));
  const code = (name) => `globalThis.__scopeEffects.push('${name}:module'); export default pi => {
    globalThis.__scopeEffects.push('${name}:factory');
    pi.on('session_start',()=>globalThis.__scopeEffects.push('${name}:start'));
    pi.on('session_shutdown',()=>globalThis.__scopeEffects.push('${name}:cleanup'));
    pi.registerCommand('${name}', {description:'sentinel', handler:async()=>{globalThis.__scopeEffects.push('${name}:handler')}});
    pi.registerTool({name:'${name}',label:'${name}',description:'sentinel',parameters:{type:'object',properties:{}},execute:async()=>({content:[],details:{}})});
    pi.registerProvider('${name}', {api:'openai-completions',baseUrl:'https://example.invalid',apiKey:'sentinel',models:[{id:'model',name:'model',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:4096,maxTokens:256}]});
  };`;
  try { await run({ root, cwd, agentDir, put, code }); }
  finally { delete globalThis.__scopeEffects; await rm(root, { recursive:true, force:true }); }
}

test('registered builtins have qualified identities and retain synthetic metadata', () => fixture(async ({cwd,agentDir}) => {
  const services=await createScopedAgentSessionServices({cwd,agentDir,resourceLoaderOptions:{extensionFactories:[
    {name:'one',builtin:true,factory:pi=>{globalThis.__scopeEffects.push('one');pi.registerCommand('one',{description:'one',handler:async()=>{}})}},
    {name:'two',builtin:true,factory:()=>globalThis.__scopeEffects.push('two')},
  ]}},['builtin:one']);
  assert.deepEqual(globalThis.__scopeEffects,['one']);
  const ext=services.resourceLoader.getExtensions().extensions[0];
  assert.equal(ext.path,'builtin:one');
  assert.deepEqual(ext.sourceInfo,{path:'builtin:one',source:'builtin',scope:'user',origin:'top-level'});
  assert.deepEqual(ext.commands.get('one').sourceInfo,ext.sourceInfo);
  globalThis.__scopeEffects=[];
  await services.resourceLoader.reload();
  assert.deepEqual(globalThis.__scopeEffects,['one']);
}));

test('scoped multi-file npm package owns metadata before overrides and after initial and reload passes; package disables win', () => fixture(async ({cwd,agentDir,put,code}) => {
  const sources=['npm:@a/pkg@1.0.0','npm:@b/pkg@1.0.0'];
  for(const [scope,names] of [['a',['first','second']],['b',['third']]]) {
    const dir=join(agentDir,'npm/node_modules',`@${scope}/pkg`);
    await put(join(dir,'package.json'),JSON.stringify({name:`@${scope}/pkg`,version:'1.0.0',pi:{extensions:names.map(name=>`${name}.mjs`)}}));
    for(const name of names) await put(join(dir,`${name}.mjs`),code(name));
  }
  await put(join(agentDir,'settings.json'),JSON.stringify({packages:sources}));
  const check=result=>{
    for(const ext of result.extensions) {
      assert.equal(ext.sourceInfo.source,sources[0]);
      assert.equal(ext.sourceInfo.origin,'package');
      for(const tool of ext.tools.values()) assert.equal(tool.sourceInfo.source,sources[0]);
      for(const command of ext.commands.values()) assert.equal(command.sourceInfo.source,sources[0]);
    }
    return result;
  };
  const services=await createScopedAgentSessionServices({cwd,agentDir,resourceLoaderOptions:{extensionsOverride:check}},['@a/pkg']);
  assert.deepEqual(globalThis.__scopeEffects,['first:module','first:factory','second:module','second:factory']);
  check(services.resourceLoader.getExtensions());
  globalThis.__scopeEffects=[];
  await services.resourceLoader.reload();
  assert.deepEqual(globalThis.__scopeEffects,['first:factory','second:factory']);
  check(services.resourceLoader.getExtensions());
  globalThis.__scopeEffects=[];
  await put(join(agentDir,'settings.json'),JSON.stringify({packages:[{source:sources[0],extensions:[]},sources[1]]}));
  await services.resourceLoader.reload();
  assert.deepEqual(globalThis.__scopeEffects,[]);
  assert.deepEqual(services.resourceLoader.getExtensions().extensions,[]);
  const aliasServices=await createScopedAgentSessionServices({cwd,agentDir},['pkg']);
  assert.deepEqual(globalThis.__scopeEffects,['third:module','third:factory']);
  // Disabled package is ineligible; the unscoped npm alias selects the only eligible owner.
  // Re-enable both packages to exercise collision ownership.
  await put(join(agentDir,'settings.json'),JSON.stringify({packages:sources}));
  globalThis.__scopeEffects=[];
  await aliasServices.resourceLoader.reload();
  assert.deepEqual(globalThis.__scopeEffects,[]);
}));

test('reload rejects bootstrap, serializes entire concurrent passes, and recovers without stale native execution after failure', () => fixture(async ({cwd,agentDir,put,code}) => {
  await put(join(agentDir,'extensions/allowed.js'),code('allowed'));
  await put(join(agentDir,'settings.json'),JSON.stringify({extensions:['extensions/allowed.js']}));
  const settings=SettingsManager.create(cwd,agentDir);
  const services=await createScopedAgentSessionServices({cwd,agentDir,settingsManager:settings},['allowed']);
  globalThis.__scopeEffects=[];
  await assert.rejects(services.resourceLoader.reload({resolveProjectTrust:async()=>true}),/bootstrap/);
  assert.deepEqual(globalThis.__scopeEffects,[]);
  const originalReload=settings.reload.bind(settings);
  let fail=true, active=0, maximum=0;
  settings.reload=async()=>{
    active++; maximum=Math.max(maximum,active);
    try {
      await new Promise(resolve=>setTimeout(resolve,5));
      if(fail) {fail=false;throw Error('discovery failure')}
      return await originalReload();
    } finally {active--}
  };
  await assert.rejects(services.resourceLoader.reload(),/discovery failure/);
  assert.deepEqual(globalThis.__scopeEffects,[]);
  await Promise.all([services.resourceLoader.reload(),services.resourceLoader.reload(),services.resourceLoader.reload()]);
  assert.equal(maximum,1);
  assert.deepEqual(globalThis.__scopeEffects,['allowed:module','allowed:factory','allowed:module','allowed:factory','allowed:module','allowed:factory']);
  await put(join(agentDir,'settings.json'),JSON.stringify({extensions:['-extensions/allowed.js']}));
  globalThis.__scopeEffects=[];
  await services.resourceLoader.reload();
  assert.deepEqual(globalThis.__scopeEffects,[]);
}));

test('failure during native reload recovers with current eligibility instead of the failed pass selection', () => fixture(async ({cwd,agentDir,put,code}) => {
  await put(join(agentDir, 'extensions/allowed.js'), code('allowed'));
  await put(join(agentDir, 'extensions/current.js'), code('current'));
  await put(join(agentDir, 'settings.json'), JSON.stringify({extensions:['extensions/allowed.js', '-extensions/current.js']}));
  const settings = SettingsManager.create(cwd, agentDir);
  const services = await createScopedAgentSessionServices({cwd, agentDir, settingsManager:settings}, ['allowed', 'current']);
  assert.deepEqual(globalThis.__scopeEffects, ['allowed:module', 'allowed:factory']);
  const originalReload = settings.reload.bind(settings);
  let calls = 0;
  settings.reload = async () => {
    calls++;
    // The adapter's preparation reload is first; the real native loader calls second.
    if (calls === 2) throw Error('native settings reload failure');
    return originalReload();
  };
  globalThis.__scopeEffects = [];
  await assert.rejects(services.resourceLoader.reload(), /native settings reload failure/);
  assert.equal(calls, 2);
  assert.deepEqual(globalThis.__scopeEffects, []);
  await put(join(agentDir, 'settings.json'), JSON.stringify({extensions:['-extensions/allowed.js', 'extensions/current.js']}));
  await services.resourceLoader.reload();
  assert.equal(calls, 4);
  assert.deepEqual(globalThis.__scopeEffects, ['current:module', 'current:factory']);
  const loaded = services.resourceLoader.getExtensions().extensions;
  assert.deepEqual(loaded.map(extension => extension.path), [join(agentDir, 'extensions/current.js')]);
  assert.equal(loaded[0].sourceInfo.source, 'local');
  globalThis.__scopeEffects = [];
  await services.resourceLoader.reload();
  assert.deepEqual(globalThis.__scopeEffects, ['current:module', 'current:factory']);
}));

test('scoped helper refuses arbitrary additional paths; undefined scope retains native additional paths', () => fixture(async ({cwd,agentDir,put,code}) => {
  const path=join(agentDir,'arbitrary.mjs');
  await put(path,code('arbitrary'));
  await assert.rejects(createScopedAgentSessionServices({cwd,agentDir,resourceLoaderOptions:{additionalExtensionPaths:[path]}},['arbitrary']),/additionalExtensionPaths/);
  assert.deepEqual(globalThis.__scopeEffects,[]);
  await createScopedAgentSessionServices({cwd,agentDir,resourceLoaderOptions:{noExtensions:true,additionalExtensionPaths:[path]}},undefined);
  assert.deepEqual(globalThis.__scopeEffects,['arbitrary:module','arbitrary:factory']);
}));

test('real session trust revocation keeps prior shutdown cleanup but does not re-import or restart excluded entries', () => fixture(async ({cwd,agentDir,put,code}) => {
  await put(join(cwd,'.pi/extensions/allowed.js'),code('allowed'));
  await put(join(cwd,'.pi/extensions/excluded.js'),code('excluded'));
  const trust=new ProjectTrustStore(agentDir);
  trust.set(cwd,true);
  const services=await createScopedAgentSessionServices({cwd,agentDir},['allowed']);
  const {session}=await createAgentSessionFromServices({services,sessionManager:SessionManager.inMemory(cwd),model:services.modelRuntime.getModel('allowed','model')});
  try {
    await session.bindExtensions({onError:error=>{throw Error(error.error)}});
    assert.deepEqual(globalThis.__scopeEffects,['allowed:module','allowed:factory','allowed:start']);
    globalThis.__scopeEffects=[];
    trust.set(cwd,false);
    await session.reload();
    assert.deepEqual(globalThis.__scopeEffects,['allowed:cleanup']);
    globalThis.__scopeEffects=[];
    trust.set(cwd,true);
    await session.reload();
    assert.deepEqual(globalThis.__scopeEffects,['allowed:module','allowed:factory','allowed:start']);
  } finally {session.dispose();}
}));

test('scope is a pre-import boundary and retains providers and source metadata', () => fixture(async ({cwd,agentDir,put,code}) => {
  await put(join(agentDir,'extensions/allowed.mjs'), code('allowed'));
  await put(join(agentDir,'extensions/excluded.mjs'), code('excluded'));
  const services = await createScopedAgentSessionServices({cwd,agentDir}, ['allowed']);
  assert.deepEqual(globalThis.__scopeEffects, ['allowed:module','allowed:factory']);
  assert.ok(services.modelRuntime.getModel('allowed','model'));
  assert.equal(services.modelRuntime.getModel('excluded','model'), undefined);
  const ext = services.resourceLoader.getExtensions().extensions[0];
  assert.equal(ext.sourceInfo.source, 'local');
  assert.equal(ext.tools.get('allowed').sourceInfo.source, 'local');
  assert.equal(ext.commands.get('allowed').sourceInfo.source, 'local');
}));

test('disabled project entry stays ineligible before and after trust grant until settings enable it', () => fixture(async ({cwd,agentDir,put,code}) => {
  await put(join(cwd,'.pi/extensions/allowed.js'),code('allowed'));
  await put(join(cwd,'.pi/settings.json'),JSON.stringify({extensions:['-extensions/allowed.js']}));
  const services=await createScopedAgentSessionServices({cwd,agentDir},['allowed']);
  assert.deepEqual(globalThis.__scopeEffects,[]);
  new ProjectTrustStore(agentDir).set(cwd,true);
  await services.resourceLoader.reload();
  assert.deepEqual(globalThis.__scopeEffects,[]);
  await put(join(cwd,'.pi/settings.json'),'{}');
  await services.resourceLoader.reload();
  assert.deepEqual(globalThis.__scopeEffects,['allowed:module','allowed:factory']);
}));

test('real reload refreshes selected content, deletion, trust and settings without stale imports', () => fixture(async ({cwd,agentDir,put,code}) => {
  const path = join(cwd,'.pi/extensions/allowed.js');
  await put(path,code('first'));
  await put(join(cwd,'.pi/settings.json'), JSON.stringify({extensions:['extensions/allowed.js']}));
  const trust = new ProjectTrustStore(agentDir);
  trust.set(cwd,true);
  const services = await createScopedAgentSessionServices({cwd,agentDir,resourceLoaderReloadOptions:{resolveProjectTrust:async()=>{throw Error('bootstrap executed')}}}, ['allowed']);
  assert.deepEqual(globalThis.__scopeEffects,['first:module','first:factory']);
  globalThis.__scopeEffects=[];
  await put(path,code('second'));
  await services.resourceLoader.reload();
  assert.deepEqual(globalThis.__scopeEffects,['second:module','second:factory']);
  globalThis.__scopeEffects=[];
  trust.set(cwd,false);
  await services.resourceLoader.reload();
  assert.deepEqual(globalThis.__scopeEffects,[]);
  trust.set(cwd,true);
  await put(join(cwd,'.pi/settings.json'), JSON.stringify({extensions:['-extensions/allowed.js']}));
  await services.resourceLoader.reload();
  assert.deepEqual(globalThis.__scopeEffects,[]);
  await put(join(cwd,'.pi/settings.json'),JSON.stringify({extensions:['extensions/allowed.js']}));
  await services.resourceLoader.reload();
  assert.deepEqual(globalThis.__scopeEffects,['second:module','second:factory']);
  globalThis.__scopeEffects=[];
  await rm(path);
  await services.resourceLoader.reload();
  assert.deepEqual(globalThis.__scopeEffects,[]);
}));

test('empty, unknown, tool suffix and original suppression exclude files and registered builtins but retain inline factories', () => fixture(async ({cwd,agentDir,put,code}) => {
  await put(join(agentDir,'extensions/allowed.mjs'),code('allowed'));
  for (const [scope,noExtensions] of [[[],false],[['unknown'],false],[['allowed/tool'],false],[['allowed','builtin:registered'],true]]) {
    globalThis.__scopeEffects=[];
    await createScopedAgentSessionServices({cwd,agentDir,resourceLoaderOptions:{noExtensions,extensionFactories:[
      {name:'registered',builtin:true,factory:()=>globalThis.__scopeEffects.push('builtin')},
      ()=>globalThis.__scopeEffects.push('inline'),
    ]}},scope);
    assert.deepEqual(globalThis.__scopeEffects,['inline']);
  }
  globalThis.__scopeEffects=[];
  const settings = SettingsManager.create(cwd,agentDir);
  await put(join(agentDir,'settings.json'),JSON.stringify({extensions:['-builtin:registered']}));
  await createScopedAgentSessionServices({cwd,agentDir,settingsManager:settings,resourceLoaderOptions:{extensionFactories:[{name:'registered',builtin:true,factory:()=>globalThis.__scopeEffects.push('builtin')}]}},['builtin:registered']);
  assert.deepEqual(globalThis.__scopeEffects,[]);
}));
