import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const {centerRequest,matchesDomain,matchesInstallationQuery}=await createJiti(import.meta.url).import('./client.ts');
test('F14-D: authentication and upstream non-JSON errors remain readable without retry',async t=>{
  const previous=globalThis.fetch;t.after(()=>globalThis.fetch=previous);
  for(const [status,body,type,message] of [[401,'Authentication required','text/plain',/重新认证/],[403,JSON.stringify({error:{message:'项目未信任',code:'PROJECT_UNTRUSTED',requestId:'test-request'}}),'application/json',/PROJECT_UNTRUSTED/],[502,'bad gateway','text/html',/HTTP 502/]]){
    let calls=0;globalThis.fetch=async()=>{calls++;return new Response(body,{status,headers:{'content-type':type}});};await assert.rejects(()=>centerRequest('inventory/query',{cwd:null}),message);assert.equal(calls,1);
  }
});
test('F20/F22: management filtering treats cross-domain and unclassified entries explicitly',()=>{
  const cross={state:'classified',assignments:[{domainId:'computing',categoryId:'code-review'},{domainId:'finance',categoryId:null}]};
  assert.equal(matchesDomain(cross,{domainId:'finance',categoryId:null,classificationState:'all'}),true);
  assert.equal(matchesDomain(cross,{domainId:'finance',categoryId:'risk-management',classificationState:'all'}),false);
  assert.equal(matchesDomain({state:'unclassified',assignments:[]},{domainId:null,categoryId:null,classificationState:'all'}),true);
});
test('F03: manage locates the exact source skill across installed scopes',()=>{
  const item={name:'review',source:'owner/repo',description:null,canonicalSkillId:'skills.sh:owner/repo@review'};
  assert.equal(matchesInstallationQuery(item,'skills.sh:owner/repo@review'),true);
  assert.equal(matchesInstallationQuery({...item,canonicalSkillId:'skills.sh:other/repo@review'},'skills.sh:owner/repo@review'),false);
  assert.equal(matchesInstallationQuery({...item,canonicalSkillId:'skills.sh:owner/repo@review-extra'},'skills.sh:owner/repo@review'),false);
  assert.equal(matchesInstallationQuery(item,'REVIEW'),true);
  assert.equal(matchesInstallationQuery({...item,installationId:'local-a'},'instance:local-a'),true);
  assert.equal(matchesInstallationQuery({...item,installationId:'local-b'},'instance:local-a'),false);
});

test('manage locates native provider identities without matching a same-named source', () => {
  for (const id of ['agentskill.sh:owner/review', 'skillsmp:https%3A%2F%2Fgithub.com%2Fa%2Fb%2Ftree%2Fmain%2Freview']) {
    const item = { name:'review', source:'owner', description:null, canonicalSkillId:id };
    assert.equal(matchesInstallationQuery(item, id), true);
    assert.equal(matchesInstallationQuery({ ...item, canonicalSkillId:id + '-other' }, id), false);
  }
});
