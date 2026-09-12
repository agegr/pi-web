// Manual network integration check: node docs/skills-center-2026-09-12/verify-real-install.mjs
// Uses the actual skills CLI and public source, but writes only into an isolated HOME.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { createJiti } from 'jiti';
const root=mkdtempSync(join(tmpdir(),'pi-real-install-'));
Object.assign(process.env,{HOME:root,USERPROFILE:root,XDG_STATE_HOME:join(root,'state'),PI_CODING_AGENT_DIR:join(root,'.pi','agent'),DISABLE_TELEMETRY:'1'});
mkdirSync(process.env.PI_CODING_AGENT_DIR,{recursive:true});
const jiti=createJiti(import.meta.url,{tsconfigPaths:true});
const {createPlan,submitOperation,getOperation}=await jiti.import('../../lib/skill-center/mutations.ts');
const {inventory}=await jiti.import('../../lib/skill-center/inventory.ts');
const {allowFileRoot}=await jiti.import('../../lib/file-access.ts');
const {trustProject}=await jiti.import('../../lib/project-trust.ts');
const {leaseRecord}=await jiti.import('../../lib/skill-center/journal.ts');
const canonicalSkillId='skills.sh:anthropics/skills@frontend-design';
const cwd=join(root,'project');mkdirSync(cwd);allowFileRoot(cwd);trustProject(cwd,process.env.PI_CODING_AGENT_DIR);
console.log('Isolated integration directory:',root);
try {
  for(const scope of ['global','project']) {
    const context=scope==='global'?null:cwd;
    const started=Date.now();const {plan}=await createPlan({kind:'install',scope,cwd:context,canonicalSkillId});
    assert.equal(plan.state,'ready');
    let {operation}=await submitOperation({planId:plan.planId,idempotencyKey:randomUUID(),acknowledgements:plan.requiredAcknowledgements});
    const deadline=Date.now()+180000;
    while(['accepted','running','verifying'].includes(operation.state)&&Date.now()<deadline){await delay(300);operation=await getOperation(operation.operationId);}
    console.log(JSON.stringify({scope,state:operation.state,elapsedMs:Date.now()-started,result:operation.result,error:operation.error,outputExcerpt:operation.state==='succeeded'?undefined:operation.outputExcerpt}));
    if(operation.state!=='succeeded') {
      console.log('Inventory evidence:',JSON.stringify(await inventory(context)));
      for(const file of [join(root,'state','skills','.skill-lock.json'),join(cwd,'skills-lock.json')])if(existsSync(file))console.log('Lock evidence:',file,readFileSync(file,'utf8'));
    }
    assert.equal(operation.state,'succeeded');
    const installed=(await inventory(context)).installations.find(i=>i.installationId===operation.result.installationId);
    assert.equal(installed.canonicalSkillId,canonicalSkillId);assert.equal(installed.managed,true);assert.equal(installed.scope,scope);assert.match(readFileSync(installed.realPath,'utf8'),/name: frontend-design/);assert.equal(leaseRecord(),null);
  }
} finally {
  // Keep evidence if a writer is still running; do not delete beneath it.
  if(!leaseRecord()) {const child=relative(resolve(tmpdir()),resolve(root));assert.ok(child.startsWith('pi-real-install-')&&!child.includes('/')&&!child.includes('\\'));rmSync(root,{recursive:true,force:true});}
}
