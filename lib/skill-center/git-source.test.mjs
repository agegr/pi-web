import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
const { withGitSource }=await createJiti(import.meta.url).import('./git-source.ts');

test('Git fallback reads real committed objects, pins snapshots and rejects links/unlisted objects',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pi-git-fixture-'));const repo=join(root,'repo');mkdirSync(repo);
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true}).trim();
  git('init','--quiet');mkdirSync(join(repo,'skill'));writeFileSync(join(repo,'skill','SKILL.md'),'---\nname: review\ndescription: test\n---\nFirst');
  git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--quiet','-m','fixture');
  const original=git('rev-parse','HEAD');
  const keys=['GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:`url.${pathToFileURL(repo).href}.insteadOf`,GIT_CONFIG_VALUE_0:'https://github.com/fixture/skills.git'});
  t.after(()=>{for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;const child=relative(resolve(tmpdir()),resolve(root));assert.ok(child.startsWith('pi-git-fixture-')&&!child.includes('\\')&&!child.includes('/'));rmSync(root,{recursive:true,force:true});});
  const before=readdirSync(tmpdir()).filter(n=>n.startsWith('pi-skill-source-'));
  await withGitSource('fixture/skills',null,async reader=>{
    assert.equal(reader.sha,original);const file=reader.tree.find(f=>f.path==='skill/SKILL.md');assert.ok((await reader.readBlob(file.sha)).toString().endsWith('First'));
    await assert.rejects(()=>reader.readBlob('f'.repeat(40)),e=>e.code==='FILE_NOT_FOUND');
  });
  writeFileSync(join(repo,'skill','SKILL.md'),'Second');git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--quiet','-m','second');
  await withGitSource('fixture/skills',original,async reader=>{assert.equal(reader.sha,original);assert.ok((await reader.readBlob(reader.tree.find(f=>f.path==='skill/SKILL.md').sha)).toString().endsWith('First'));});
  assert.deepEqual(readdirSync(tmpdir()).filter(n=>n.startsWith('pi-skill-source-')),before);
  await assert.rejects(()=>withGitSource('../escape','HEAD',async()=>{}),e=>e.code==='INVALID_PACKAGE');
});

test('Git fallback retains its temporary repository when process-tree termination is unconfirmed',async()=>{
  let directory;
  try {
    await assert.rejects(()=>withGitSource('fixture/skills',null,async()=>assert.fail('No content may be read'),async(command,args,opts)=>{
      directory=args[1];assert.equal(command,'git');assert.ok(opts.timeout<=30000);
      throw Object.assign(new Error('simulated timeout'),{killed:true,treeTerminated:false});
    }),/simulated timeout/);
    assert.ok(readdirSync(directory).includes('HEAD'));
  } finally {
    // The fake runner created no processes; only this test owns the retained directory.
    if(directory){const child=relative(resolve(tmpdir()),resolve(directory));assert.ok(child.startsWith('pi-skill-source-')&&!child.includes('/')&&!child.includes('\\'));rmSync(directory,{recursive:true,force:true});}
  }
});
