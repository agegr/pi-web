import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url,{tsconfigPaths:true});
const { inventory } = await jiti.import('./inventory.ts');
const { visibility, checks, execute, getOperation, createPlan, submitOperation, reconcile, setClassification } = await jiti.import('./mutations.ts');
const { getTaxonomy } = await jiti.import('./catalog.ts');
const { sourceSkill } = await jiti.import('./remote.ts');
const { detail, snapshotContent, snapshotFiles } = await jiti.import('./remote.ts');
const { acquireLease, saveJson, stateDir, leaseRecord } = await jiti.import('./journal.ts');
const { handleSkillCenter } = await jiti.import('./http.ts');
const { allowFileRoot } = await jiti.import('../file-access.ts');
const { trustProject } = await jiti.import('../project-trust.ts');
const { safeRelative, localTree } = await jiti.import('./files.ts');

const write = (path, text) => { mkdirSync(dirname(path),{recursive:true}); writeFileSync(path,text); return path; };
const skillText = (name='review',body='Original body') => `---\r\nname: ${name}\r\ndescription: Test skill\r\ncustom: preserve\r\n---\r\n${body}\r\n`;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(),'pi-skill-center-test-'));
  const agent = join(root,'agent'); const cwd = join(root,'project'); mkdirSync(agent); mkdirSync(cwd);
  const previous = { PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR, XDG_STATE_HOME:process.env.XDG_STATE_HOME, HOME:process.env.HOME, USERPROFILE:process.env.USERPROFILE };
  process.env.PI_CODING_AGENT_DIR = agent; process.env.XDG_STATE_HOME = join(root,'state'); process.env.HOME=root; process.env.USERPROFILE=root;
  allowFileRoot(cwd); globalThis.__piAllowedRootsCache = undefined;
  t.after(()=>{ for(const [k,v] of Object.entries(previous)) if(v===undefined) delete process.env[k];else process.env[k]=v; rmSync(root,{recursive:true,force:true}); globalThis.__piAllowedRootsCache=undefined; });
  return {root,agent,cwd};
}
function lock(root,scope,skill='review',hash='old') {
  const path = scope==='global' ? join(root,'state','skills','.skill-lock.json') : join(root,'project','skills-lock.json');
  write(path,JSON.stringify({version:3,skills:{[skill]:{source:'example/skills',sourceType:'github',skillPath:`skills/${skill}/SKILL.md`,[scope==='global'?'skillFolderHash':'computedHash']:hash}}}));
}
test('F08/F15: no cwd loads global only; invalid and local untracked files remain visible',async t=>{
  const f=fixture(t); write(join(f.agent,'skills','review','SKILL.md'),skillText()); write(join(f.agent,'skills','invalid','SKILL.md'),'---\nname: [bad\n---\n'); write(join(f.cwd,'.pi','skills','project-only','SKILL.md'),skillText('project-only'));
  const result=await inventory(null); assert.equal(result.projectResourcesLoaded,false); assert.equal(result.coverage.project,'none');
  assert.equal(result.installations.length,2); assert.equal(result.installations.find(i=>i.name==='review').managed,false); assert.equal(result.installations.find(i=>i.name==='invalid').loadState,'invalid');
});
test('F08/F11: malformed lock is a diagnostic, not an empty inventory',async t=>{
  const f=fixture(t);write(join(f.agent,'skills','review','SKILL.md'),skillText());write(join(f.root,'state','skills','.skill-lock.json'),'{bad');
  const r=await inventory(null);assert.equal(r.installations.length,1);assert.ok(r.diagnostics.some(d=>d.code==='INVALID_LOCK'));assert.equal(r.coverage.global,'partial');
});
test('F08/F11/F15: trusted project read never executes extensions; same names keep both instances',async t=>{
  const f=fixture(t);write(join(f.agent,'skills','review','SKILL.md'),skillText());write(join(f.cwd,'.pi','skills','review','SKILL.md'),skillText());
  const marker=join(f.root,'executed');write(join(f.cwd,'.pi','extensions','probe.js'),`import {writeFileSync} from 'node:fs'; export default()=>writeFileSync(${JSON.stringify(marker)},'bad');`);
  let r=await inventory(f.cwd);assert.equal(r.projectResourcesLoaded,false);assert.equal(r.installations.length,1);
  trustProject(f.cwd,f.agent);r=await inventory(f.cwd);assert.equal(r.installations.length,2);assert.ok(r.installations.some(i=>i.loadState==='shadowed'));assert.equal(existsSync(marker),false);
});
test('F10: visibility preserves unrelated bytes, rejects stale revisions and nonboolean inputs',async t=>{
  const f=fixture(t);const path=write(join(f.agent,'skills','review','SKILL.md'),skillText());let item=(await inventory(null)).installations[0];
  await assert.rejects(()=>visibility(item.installationId,{cwd:null,expectedRevision:item.revision,disableModelInvocation:'true'}),e=>e.status===400);
  await visibility(item.installationId,{cwd:null,expectedRevision:item.revision,disableModelInvocation:true});
  assert.equal(readFileSync(path,'utf8'),skillText().replace('---\r\n','---\r\ndisable-model-invocation: true\r\n'));
  await assert.rejects(()=>visibility(item.installationId,{cwd:null,expectedRevision:item.revision,disableModelInvocation:false}),e=>e.code==='REVISION_CONFLICT');
  item=(await inventory(null)).installations[0];await visibility(item.installationId,{cwd:null,expectedRevision:item.revision,disableModelInvocation:false});assert.equal(readFileSync(path,'utf8'),skillText());
});
test('F08/F10/F12: shared physical files retain both bindings and block ambiguous updates',async t=>{
  const f=fixture(t);const global=join(f.agent,'skills','review');write(join(global,'SKILL.md'),skillText());const project=join(f.cwd,'.pi','skills','review');mkdirSync(dirname(project),{recursive:true});symlinkSync(global,project,'junction');lock(f.root,'global');lock(f.root,'project');trustProject(f.cwd,f.agent);
  const r=await inventory(f.cwd);assert.equal(r.installations.length,1);const item=r.installations[0];assert.equal(item.managementBindings.length,2);assert.equal(item.managementBindingId,null);assert.equal(item.capabilities.update,false);assert.equal(item.installedVersion,null);
  const result=await checks(f.cwd,[item.installationId]);assert.equal(result.results[0].state,'unsupported');
  await assert.rejects(()=>visibility(item.installationId,{cwd:f.cwd,expectedRevision:item.revision,disableModelInvocation:true}),e=>e.code==='SHARED_FILE');
});
test('F05: snapshots reject traversal and expire after any file change',async t=>{
  const f=fixture(t);const path=write(join(f.agent,'skills','review','SKILL.md'),skillText());write(join(dirname(path),'notes','guide.txt'),'nested text');
  const item=(await inventory(null)).installations[0];const d=await detail({kind:'installed',cwd:null,installationId:item.installationId});
  assert.ok((await snapshotFiles(d.snapshotId)).files.some(f=>f.path==='notes/guide.txt'));
  assert.equal((await snapshotContent(d.snapshotId,'notes/guide.txt')).text,'nested text');
  for(const p of ['../x','/etc/passwd','C:/secret','%2e%2e/file','a\\b']) assert.throws(()=>safeRelative(p));
  write(join(dirname(path),'notes','guide.txt'),'new');await assert.rejects(()=>snapshotContent(d.snapshotId,'SKILL.md'),e=>e.code==='SNAPSHOT_EXPIRED');
});
test('F05/F08: escaped links are rejected before SDK reads their content',async t=>{
  const f=fixture(t);const external=join(f.root,'external');write(join(external,'SKILL.md'),skillText('secret-outside','PRIVATE'));const link=join(f.agent,'skills','escape');mkdirSync(dirname(link),{recursive:true});symlinkSync(external,link,'junction');
  const r=await inventory(null);assert.equal(r.installations.length,0);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);assert.ok(r.diagnostics.length>0);
});
test('F05: large file gives explicit state, tree hash uses bounded reads',async t=>{
  const f=fixture(t);const path=write(join(f.agent,'skills','review','SKILL.md'),skillText());write(join(dirname(path),'large.txt'),Buffer.alloc(524289,65));
  const item=(await inventory(null)).installations[0];const d=await detail({kind:'installed',cwd:null,installationId:item.installationId});const c=await snapshotContent(d.snapshotId,'large.txt');assert.equal(c.state,'too-large');assert.equal(c.text,null);assert.equal(c.complete,false);assert.equal(localTree(dirname(path)).complete,true);
});
test('F12: explicitly empty checks stays empty and unknown ids fail',async t=>{
  const f=fixture(t);write(join(f.agent,'skills','review','SKILL.md'),skillText());assert.deepEqual((await checks(null,[])).results,[]);await assert.rejects(()=>checks(null,['missing']),e=>e.status===404);
});
test('F14: filesystem lease excludes concurrent writers and survives a second module instance',t=>{
  const f=fixture(t);const a=acquireLease('one',f.root);assert.throws(()=>acquireLease('two',f.root),e=>e.code==='BUSY');a.release();const b=acquireLease('two',f.root);b.release();
});
test('F13 regression: failed CLI cannot turn existing unchanged files into a successful update',async t=>{
  const f=fixture(t);const path=write(join(f.agent,'skills','review','SKILL.md'),skillText());lock(f.root,'global');const item=(await inventory(null)).installations[0];const operationId=randomUUID();
  const record={operation:{operationId,kind:'update',state:'accepted',scope:'global',contextId:'global',projectLabel:null,skillName:'review',targetPath:path,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),finishedAt:null,result:null,error:null,outputExcerpt:null,pollAfterMs:1500},plan:{plan:{kind:'update',currentVersion:item.installedVersion},request:{kind:'update',cwd:null},targetRoot:dirname(path),canonical:item.canonicalSkillId,hidden:false,targetPhysical:path,sharedPhysical:null,beforeTree:Object.fromEntries(localTree(dirname(path)).files.filter(f=>f.kind==='file').map(f=>[f.path,f.revision])),args:[]},pid:process.pid,key:'test',payload:'test'};
  let calls=0;await execute(record,acquireLease(operationId),async()=>{calls++;throw new Error('CLI failed before write');});assert.equal(calls,1);assert.notEqual(record.operation.state,'succeeded');assert.equal(readFileSync(path,'utf8'),skillText());assert.equal(existsSync(join(stateDir(),`baseline-${item.installationId}.json`)),false);assert.equal(leaseRecord(),null);
});
test('F14: restarted nonterminal operations become needs-review without replay',async t=>{
  const f=fixture(t);const id=randomUUID();saveJson(join(stateDir(),`operation-${id}.json`),{pid:2147483647,plan:{request:{cwd:null}},operation:{operationId:id,state:'running',pollAfterMs:1500}});
  const op=await getOperation(id);assert.equal(op.state,'needs-review');assert.equal(op.pollAfterMs,null);assert.equal(existsSync(join(f.root,'executed')),false);
});
test('new route strict validation preserves readable HTTP error envelopes',async t=>{
  fixture(t);
  const call=(path,body,contentType='application/json')=>handleSkillCenter(new Request(`http://localhost/api/skill-center/${path}`,{method:'POST',headers:{host:'localhost','content-type':contentType},body:JSON.stringify(body)}),path.split('/'));
  assert.equal((await call('catalog/query',{limit:null})).status,400);assert.equal((await call('inventory/query',{})).status,400);assert.equal((await call('checks',{cwd:null,installationIds:[]},'text/plain')).status,415);
  const r=await call('plans',{kind:'install',cwd:null,canonicalSkillId:'skills.sh:a/b@c',scope:'other'});assert.equal(r.status,400);assert.ok((await r.json()).error.requestId);
});

function sourceFixture(t) {
  const original=globalThis.fetch; const commit='a'.repeat(40), blob='b'.repeat(40);
  globalThis.fetch=async (input)=>{
    const url=String(input);
    if(url.endsWith('/commits/HEAD')) return Response.json({sha:commit});
    if(url.includes('/git/trees/')) return Response.json({sha:commit,truncated:false,tree:[{path:'skills/review/SKILL.md',sha:blob,type:'blob',mode:'100644',size:100}]});
    if(url.includes('/git/blobs/')) return Response.json({encoding:'base64',content:Buffer.from(skillText()).toString('base64')});
    if(url.includes('/api/download/')) return Response.json({hash:'new-version'});
    throw new Error('Unexpected test URL '+url);
  };
  t.after(()=>globalThis.fetch=original);
}
async function settled(id) {
  for(let n=0;n<100;n++){const op=await getOperation(id);if(['succeeded','failed','needs-review'].includes(op.state)) return op;await new Promise(r=>setTimeout(r,10));}
  throw new Error('Operation did not settle');
}

function classificationBody(item, assignments, cwd=null) {
  const {taxonomy}=getTaxonomy();return {cwd,expectedRevision:item.revision,expectedClassificationRevision:item.classification.personalRevision??null,taxonomyVersion:taxonomy.version,indexRevision:taxonomy.indexRevision,assignments};
}
test('personal classification persists multiple domains without editing SKILL.md and survives content updates',async t=>{
  const f=fixture(t);const path=write(join(f.agent,'skills','review','SKILL.md'),skillText());lock(f.root,'global');
  let item=(await inventory(null)).installations[0];const bytes=readFileSync(path);
  const assignments=[{domainId:'computing',categoryId:'code-review'},{domainId:'finance',categoryId:'risk-management'}];
  await setClassification(item.installationId,classificationBody(item,assignments));
  item=(await inventory(null)).installations[0];assert.deepEqual(item.classification.assignments,assignments);assert.equal(item.classification.origin,'personal');assert.deepEqual(readFileSync(path),bytes);
  assert.deepEqual(sourceSkill('example/skills@review').classification.assignments,assignments);
  write(path,skillText('review','Updated content'));assert.deepEqual((await inventory(null)).installations[0].classification.assignments,assignments);
  assert.ok(existsSync(join(stateDir(),'classifications.json')));
});
test('local untracked instances classify independently; clearing and resetting are explicit',async t=>{
  const f=fixture(t);write(join(f.agent,'skills','one','SKILL.md'),skillText());write(join(f.agent,'skills','two','SKILL.md'),skillText());
  let [one,two]=(await inventory(null)).installations;assert.equal(one.canonicalSkillId,null);
  await setClassification(one.installationId,classificationBody(one,[{domainId:'philosophy',categoryId:null}]));
  let list=(await inventory(null)).installations;one=list.find(i=>i.installationId===one.installationId);two=list.find(i=>i.installationId===two.installationId);
  assert.equal(one.classification.state,'classified');assert.equal(two.classification.state,'unclassified');
  await setClassification(one.installationId,classificationBody(one,[]));one=(await inventory(null)).installations.find(i=>i.installationId===one.installationId);assert.equal(one.classification.state,'unclassified');assert.equal(one.classification.origin,'personal');
  await setClassification(one.installationId,{...classificationBody(one,[]),reset:true});assert.equal((await inventory(null)).installations.find(i=>i.installationId===one.installationId).classification.origin,undefined);
});
test('classification API rejects invalid mappings, stale revisions and writes during another operation',async t=>{
  const f=fixture(t);write(join(f.agent,'skills','review','SKILL.md'),skillText());const item=(await inventory(null)).installations[0];
  const body=classificationBody(item,[{domainId:'psychology',categoryId:null}]);
  for(const assignments of [null,[{domainId:'unknown',categoryId:null}],[{domainId:'finance',categoryId:'ethics'}],[{domainId:'finance'}],[{domainId:'finance',categoryId:null},{domainId:'finance',categoryId:null}]])await assert.rejects(()=>setClassification(item.installationId,{...body,assignments}),e=>e.code==='INVALID_CLASSIFICATION');
  await assert.rejects(()=>setClassification(item.installationId,{...body,indexRevision:'old'}),e=>e.code==='TAXONOMY_CHANGED');
  await assert.rejects(()=>setClassification(item.installationId,{...body,expectedRevision:'old'}),e=>e.code==='REVISION_CONFLICT');
  const lease=acquireLease(null);try{await assert.rejects(()=>setClassification(item.installationId,body),e=>e.code==='BUSY');}finally{lease.release();}
  const req=()=>new Request('http://localhost/api/skill-center/installations/'+item.installationId+'/classification',{method:'PATCH',headers:{host:'localhost',origin:'http://localhost','content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await handleSkillCenter(req(),['installations',item.installationId,'classification'])).status,200);
  assert.equal((await handleSkillCenter(req(),['installations',item.installationId,'classification'])).status,409);
  assert.equal(leaseRecord(),null);
});

test('first install into a clean project requires explicit trust before persisting the decision',async t=>{
  const f=fixture(t);sourceFixture(t);
  const stored=await createPlan({kind:'install',canonicalSkillId:'skills.sh:example/skills@review',scope:'project',cwd:f.cwd});
  assert.deepEqual(stored.plan.requiredAcknowledgements,['trust-project-resources']);
  const body={planId:stored.plan.planId,idempotencyKey:'clean-project-install',acknowledgements:[]};
  let calls=0;
  const runner=async()=>{calls++;write(stored.plan.target.logicalPath,skillText());lock(f.root,'project','review','new-version');return {stdout:'Installed',stderr:''};};
  await assert.rejects(()=>submitOperation(body,runner),e=>e.code==='ACKNOWLEDGEMENT_REQUIRED');assert.equal(calls,0);
  const r=await submitOperation({...body,acknowledgements:['trust-project-resources']},runner);assert.equal((await settled(r.operation.operationId)).state,'succeeded');assert.equal((await inventory(f.cwd)).projectResourcesLoaded,true);
});
test('F06/F07/F14: duplicate simultaneous intent starts one CLI; another intent receives busy',async t=>{
  const f=fixture(t);sourceFixture(t);write(join(f.cwd,'.pi','extensions','empty.js'),'export default()=>{}');trustProject(f.cwd,f.agent);
  const stored=await createPlan({kind:'install',canonicalSkillId:'skills.sh:example/skills@review',scope:'project',cwd:f.cwd});assert.equal(stored.plan.state,'ready');assert.equal(stored.plan.target.logicalPath,join(f.cwd,'.pi','skills','review','SKILL.md'));
  let calls=0,release;const gate=new Promise(r=>release=r);
  const runner=async args=>{calls++;assert.deepEqual(args.slice(0,5),['skills','add','example/skills','--skill','review']);await gate;write(stored.plan.target.logicalPath,skillText());lock(f.root,'project','review','new-version');return {stdout:'Installed 1 skill',stderr:''};};
  const body={planId:stored.plan.planId,idempotencyKey:'same-intent-key',acknowledgements:[]};
  const [a,b]=await Promise.all([submitOperation(body,runner),submitOperation(body,runner)]);assert.equal(a.operation.operationId,b.operation.operationId);assert.equal(a.operation.operationId,stored.plan.operationId);assert.equal(calls,1);
  await assert.rejects(()=>submitOperation({...body,acknowledgements:['different']},runner),e=>e.code==='IDEMPOTENCY_CONFLICT');
  assert.throws(()=>acquireLease(randomUUID()),e=>e.code==='BUSY');release();const op=await settled(a.operation.operationId);assert.equal(op.state,'succeeded');assert.equal(op.result.currentSourceStatus,'up-to-date');assert.equal(op.result.reloadRequired,true);
});
test('F07: success text without files never becomes succeeded',async t=>{
  const f=fixture(t);sourceFixture(t);write(join(f.cwd,'.pi','extensions','empty.js'),'export default()=>{}');trustProject(f.cwd,f.agent);
  const stored=await createPlan({kind:'install',canonicalSkillId:'skills.sh:example/skills@review',scope:'project',cwd:f.cwd});
  const result=await submitOperation({planId:stored.plan.planId,idempotencyKey:'missing-file-key',acknowledgements:[]},async()=>({stdout:'Installation complete',stderr:''}));
  assert.equal((await settled(result.operation.operationId)).state,'needs-review');
});
test('F13: update preserves only visibility and does not claim latest when comparison fails',async t=>{
  const f=fixture(t);sourceFixture(t);const path=write(join(f.cwd,'.pi','skills','review','SKILL.md'),skillText().replace('---\r\n','---\r\ndisable-model-invocation: true\r\n'));lock(f.root,'project');trustProject(f.cwd,f.agent);
  const item=(await inventory(f.cwd)).installations[0];const stored=await createPlan({kind:'update',cwd:f.cwd,installationId:item.installationId,expectedRevision:item.revision});assert.equal(stored.plan.localChanges,'unknown');
  await assert.rejects(()=>submitOperation({planId:stored.plan.planId,idempotencyKey:'update-unknown-key',acknowledgements:[]}),e=>e.code==='ACKNOWLEDGEMENT_REQUIRED');
  const result=await submitOperation({planId:stored.plan.planId,idempotencyKey:'update-unknown-key',acknowledgements:['overwrite-unknown-local-changes']},async()=>{write(path,skillText('review','New upstream body'));lock(f.root,'project','review','new-version');globalThis.fetch=async()=>{throw new Error('Source offline');};return {stdout:'success',stderr:''};});
  const op=await settled(result.operation.operationId);assert.equal(op.state,'succeeded');assert.equal(op.result.currentSourceStatus,'error');assert.match(readFileSync(path,'utf8'),/New upstream body/);assert.match(readFileSync(path,'utf8'),/disable-model-invocation: true/);
});

test('F13 regression: source-check-time local edits never become a trusted baseline',async t=>{
  const f=fixture(t);sourceFixture(t);const path=write(join(f.cwd,'.pi','skills','review','SKILL.md'),skillText());lock(f.root,'project');trustProject(f.cwd,f.agent);
  const item=(await inventory(f.cwd)).installations[0];const stored=await createPlan({kind:'update',cwd:f.cwd,installationId:item.installationId,expectedRevision:item.revision});
  const result=await submitOperation({planId:stored.plan.planId,idempotencyKey:'racing-edit-key',acknowledgements:['overwrite-unknown-local-changes']},async()=>{write(path,skillText('review','New upstream'));lock(f.root,'project','review','new-version');globalThis.fetch=async()=>{write(join(dirname(path),'notes.txt'),'User local edit during check');return Response.json({hash:'new-version'});};return {stdout:'success',stderr:''};});
  const op=await settled(result.operation.operationId);assert.equal(op.state,'needs-review');assert.equal(op.error.code,'REVISION_CONFLICT');assert.equal(existsSync(join(stateDir(),`baseline-${item.installationId}.json`)),false);
});
test('F14 regression: unconfirmed process tree performs no visibility restoration and keeps lease',async t=>{
  const f=fixture(t);sourceFixture(t);const path=write(join(f.cwd,'.pi','skills','review','SKILL.md'),skillText().replace('---\r\n','---\r\ndisable-model-invocation: true\r\n'));lock(f.root,'project');trustProject(f.cwd,f.agent);
  const item=(await inventory(f.cwd)).installations[0];const stored=await createPlan({kind:'update',cwd:f.cwd,installationId:item.installationId,expectedRevision:item.revision});
  const result=await submitOperation({planId:stored.plan.planId,idempotencyKey:'unknown-process-key',acknowledgements:['overwrite-unknown-local-changes']},async()=>{write(path,skillText('review','Unconfirmed write'));throw Object.assign(new Error('termination failed'),{killed:true,treeTerminated:false});});
  const op=await settled(result.operation.operationId);assert.equal(op.state,'needs-review');assert.equal(op.error.code,'PROCESS_UNCONFIRMED');assert.equal(readFileSync(path,'utf8'),skillText('review','Unconfirmed write'));assert.equal(leaseRecord().operationId,op.operationId);
});
test('F14 regression: read-only reconcile is excluded by another writer',async t=>{
  fixture(t);const id=randomUUID();saveJson(join(stateDir(),`operation-${id}.json`),{pid:process.pid,plan:{request:{cwd:null}},operation:{operationId:id,state:'needs-review',pollAfterMs:null}});
  const lease=acquireLease(randomUUID());try {await assert.rejects(()=>reconcile(id),e=>e.code==='BUSY');} finally {lease.release();}
});
