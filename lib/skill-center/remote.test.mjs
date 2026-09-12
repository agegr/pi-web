import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
const jiti=createJiti(import.meta.url);
const {search,detail,snapshotContent}=await jiti.import('./remote.ts');
const {getTaxonomy,queryCatalog}=await jiti.import('./catalog.ts');
const empty=()=>JSON.parse(readFileSync(new URL('./catalog.json',import.meta.url)));
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'pi-catalog-test-')), path=join(root,'index.json');
  const old=process.env.PI_SKILL_CENTER_INDEX_PATH, fetch=globalThis.fetch;
  process.env.PI_SKILL_CENTER_INDEX_PATH=path;globalThis.__piSkillCatalog=undefined;
  t.after(()=>{globalThis.fetch=fetch;if(old===undefined)delete process.env.PI_SKILL_CENTER_INDEX_PATH;else process.env.PI_SKILL_CENTER_INDEX_PATH=old;globalThis.__piSkillCatalog=undefined;rmSync(root,{force:true,recursive:true});});
  const catalog=empty();writeFileSync(path,JSON.stringify(catalog));return {path,catalog};
}
function add(catalog) {
  catalog.skills.push({canonicalSkillId:'skills.sh:a/repo@review',provider:'skills.sh',package:'a/repo@review',name:'review',source:'a/repo',sourceUrl:'https://github.com/a/repo',directoryUrl:'https://skills.sh/a/repo/review',sourceType:'github',description:'Review evidence',metadataState:'ready',installCount:null});
  for(const [domainId,categoryId] of [['computing','code-review'],['finance','risk-management']])catalog.assignments.push({canonicalSkillId:'skills.sh:a/repo@review',domainId,categoryId,evidence:{sourceUrl:'https://github.com/a/repo',relativePath:'SKILL.md',excerpt:'Review evidence',verifiedAt:'2026-09-12T00:00:00Z'}});
}
test('F19/F20/F21: cross-domain entries count once per domain and once in all-domain query',t=>{
  const f=fixture(t);add(f.catalog);writeFileSync(f.path,JSON.stringify(f.catalog));
  const data=getTaxonomy();assert.deepEqual(data.counts.map(c=>c.indexedUnique),[1,1,0,0,0]);assert.equal(data.coverage.indexedUnique,1);assert.equal(queryCatalog({query:'evidence'}).results.length,1);assert.equal(queryCatalog({domainId:'finance',categoryId:'risk-management'}).results[0].classification.assignments.length,2);
});
test('F17/F19: invalid replacement and same-revision replacement keep last complete catalog',t=>{
  const f=fixture(t);getTaxonomy();writeFileSync(f.path,'{bad');assert.equal(getTaxonomy().diagnostics.length,1);
  add(f.catalog);writeFileSync(f.path,JSON.stringify(f.catalog));assert.equal(getTaxonomy().coverage.indexedUnique,0);
  f.catalog.taxonomy.indexRevision='reviewed-2';writeFileSync(f.path,JSON.stringify(f.catalog));assert.equal(getTaxonomy().coverage.indexedUnique,1);
});
test('F02/F03/F21: external search preserves full source order, deduplicates and never sends domain upstream',async t=>{
  const f=fixture(t);add(f.catalog);writeFileSync(f.path,JSON.stringify(f.catalog));
  globalThis.fetch=async(input,init)=>{const url=new URL(input);assert.equal(url.searchParams.has('domainId'),false);assert.equal(init.redirect,'error');return Response.json({skills:[{source:'b/repo',name:'review'},{source:'a/repo',name:'review',installs:12},{source:'b/repo',name:'review',description:'Actual description',installs:0}]});};
  const r=await search({query:'review',domainId:'finance',categoryId:'risk-management'});assert.deepEqual(r.results.map(s=>s.source),['b/repo','a/repo']);assert.equal(r.results[0].description,'Actual description');assert.equal(r.results[0].installCount.numeric,0);assert.equal(r.results[0].classification.state,'unclassified');assert.equal(r.results[1].classification.assignments.length,2);assert.equal(r.coverage.marketTotal,null);assert.equal(r.classificationSummary.currentDomainUnique,1);
});
test('F02: a normal empty response and rate limiting are distinct',async t=>{
  fixture(t);globalThis.fetch=async()=>Response.json({skills:[]});assert.equal((await search({query:'unknown'})).returnedCount,0);
  globalThis.fetch=async()=>new Response('',{status:429});await assert.rejects(()=>search({query:'review'}),e=>e.code==='SOURCE_RATE_LIMITED');
});
test('F19: taxonomy failure leaves external search available with unknown coverage',async t=>{
  const f=fixture(t);writeFileSync(f.path,'{bad');globalThis.fetch=async()=>Response.json({skills:[{source:'a/b',name:'review'}]});
  const r=await search({query:'review'});assert.equal(r.results.length,1);assert.equal(r.coverage.indexedUnique,null);assert.equal(r.taxonomyVersion,'unavailable');assert.equal(r.diagnostics[0].code,'TAXONOMY_UNAVAILABLE');
});
test('F04/F05: metadata is source grounded and snapshot content remains bound to its commit blob',async t=>{
  fixture(t);const commit='a'.repeat(40),sha='b'.repeat(40);let requests=[];
  globalThis.fetch=async(input)=>{const url=String(input);requests.push(url);if(url.endsWith('commits/HEAD'))return Response.json({sha:commit});if(url.includes('/git/trees/'))return Response.json({tree:[{path:'skills/review/SKILL.md',type:'blob',mode:'100644',sha,size:100}],truncated:false});return Response.json({encoding:'base64',content:Buffer.from('---\nname: review\ndescription: Original description\nlicense: MIT\ncompatibility: pi\n---\n<script>unsafe()</script>').toString('base64')});};
  const d=await detail({kind:'remote',canonicalSkillId:'skills.sh:a/b@review'});assert.equal(d.description,'Original description');assert.equal(d.license,'MIT');assert.equal(d.compatibility,'pi');assert.equal(d.version.value,commit);
  requests=[];const content=await snapshotContent(d.snapshotId,'SKILL.md');assert.equal(content.state,'text');assert.ok(requests.every(url=>url.endsWith('/git/blobs/'+sha)));assert.ok(content.sourceUrl.includes(commit));
});
test('F04: ambiguous frontmatter identities never pick the first candidate',async t=>{
  fixture(t);globalThis.fetch=async input=>{const url=String(input);if(url.endsWith('commits/HEAD'))return Response.json({sha:'a'.repeat(40)});if(url.includes('/git/trees/'))return Response.json({truncated:false,tree:['one','two'].map(p=>({path:p+'/SKILL.md',type:'blob',mode:'100644',size:100,sha:'b'.repeat(40)}))});return Response.json({encoding:'base64',content:Buffer.from('---\nname: review\ndescription: Test\n---\n').toString('base64')});};
  await assert.rejects(()=>detail({kind:'remote',canonicalSkillId:'skills.sh:a/b@review'}),e=>e.code==='AMBIGUOUS_SKILL');
});
test('F02 regression: failed API and inconclusive CLI output remain errors, not empty matches',async t=>{
  fixture(t);globalThis.fetch=async()=>new Response('',{status:502});
  for(const runner of [async()=>{throw new Error('CLI failed');},async()=>({stdout:'No skills found for review',stderr:''})])await assert.rejects(()=>search({query:'review'},runner),e=>e.code==='SOURCE_UNAVAILABLE');
});
test('F02/F03: CLI fallback uses remaining budget and preserves formatted unknown counts',async t=>{
  fixture(t);globalThis.fetch=async()=>new Response('',{status:502});
  const r=await search({query:'review'},async(args,opts)=>{assert.deepEqual(args,['skills','find','review']);assert.ok(opts.timeout<=10000);return {stdout:'a/repo@review 1.2K installs\nb/repo@review 14 installs\n',stderr:''};});
  assert.equal(r.searchMode,'cli');assert.equal(r.results[0].installCount.numeric,null);assert.equal(r.results[1].installCount.numeric,14);
  assert.equal(r.results[0].installCount.display,'1.2K');
});

test('GitHub quota exhaustion falls back to verified Git objects and caches preview content',async t=>{
  fixture(t);globalThis.fetch=async()=>new Response('',{status:403});
  const text=Buffer.from('---\nname: review\ndescription: Git fallback\n---\nContent');
  let reads=0;
  const d=await detail({kind:'remote',canonicalSkillId:'skills.sh:a/b@review'},async(source,revision,read)=>{
    assert.equal(source,'a/b');assert.equal(revision,null);
    return read({sha:'a'.repeat(40),tree:[{path:'skills/review/SKILL.md',type:'blob',mode:'100644',sha:'b'.repeat(40),size:text.length}],readBlob:async()=>{reads++;return text;}});
  });
  assert.equal(d.description,'Git fallback');assert.equal(d.version.value,'a'.repeat(40));
  assert.equal((await snapshotContent(d.snapshotId,'SKILL.md')).text,text.toString());assert.equal(reads,1);
});

test('external search accepts namespaced skill identities without silently dropping them',async t=>{
  fixture(t);globalThis.fetch=async()=>Response.json({skills:[{source:'google-labs-code/stitch-skills',name:'stitch::react-native',skillId:'stitch::react-native',installs:6330}]});
  const r=await search({query:'react native'});assert.equal(r.results.length,1);assert.equal(r.results[0].package,'google-labs-code/stitch-skills@stitch::react-native');
});
