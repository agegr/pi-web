import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const subagents = await jiti.import('./subagents.ts');

test('profile extension declarations distinguish legacy discovery, empty, explicit disable and named lists', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'scope-parser-'));
  try {
    await mkdir(join(cwd,'.pi/agents'),{recursive:true});
    for (const [yaml, expectedScope, enabled] of [
      ['',undefined,false], ['extensions: true',undefined,true], ['extensions: all',undefined,true],
      ['extensions: "*"',undefined,true], ['extensions: false',undefined,false],
      ['extensions: none',[],false], ['extensions: []',[],false],
      ['extensions: [all]',undefined,true], ['extensions: ["*"]',undefined,true], ['extensions: [none]',[],false],
      ['extensions: [Foo, "@Team/Adapter", foo]',['foo','@team/adapter'],true],
      ['extensions: Foo\nload_extensions: false',['foo'],false],
      ['extensions: []\nload_extensions: true',[],true],
    ]) {
      await writeFile(join(cwd,'.pi/agents/scoped.md'),`---\n${yaml}\n---\nPrompt`);
      const profile = subagents.resolveSubagentProfile(cwd,'scoped');
      assert.deepEqual(profile.extensionScope,expectedScope,yaml);
      assert.equal(profile.loadExtensions,enabled,yaml);
    }
    for (const invalid of ['[42]','[""]']) {
      await writeFile(join(cwd,'.pi/agents/scoped.md'),`---\nextensions: ${invalid}\n---\nPrompt`);
      assert.equal(subagents.resolveSubagentProfile(cwd,'scoped'),undefined);
    }
  } finally { await rm(cwd,{recursive:true,force:true}); }
});

test('authored list round-trip preserves foreign fields and selection independently of activation', async () => {
  const cwd = await mkdtemp(join(tmpdir(),'scope-roundtrip-'));
  try {
    await mkdir(join(cwd,'.pi/agents'),{recursive:true});
    const file=join(cwd,'.pi/agents/scoped.md');
    await writeFile(file,'---\nextensions: [Foo, "@Team/Adapter", foo]\nskills: [foreign]\nexclude_extensions: [other]\ndisallowed_tools: ext:foo/no\n---\nPrompt');
    const profile=subagents.resolveSubagentProfile(cwd,'scoped');
    subagents.saveProjectSubagentProfile(cwd,{...profile,loadExtensions:false});
    const {parseFrontmatter}=await jiti.import('./frontmatter.ts');
    const {data}=parseFrontmatter(await readFile(file,'utf8'));
    assert.deepEqual(data.extensions,['Foo','@Team/Adapter','foo']);
    assert.deepEqual(data.skills,['foreign']);
    assert.deepEqual(data.exclude_extensions,['other']);
    assert.equal(data.disallowed_tools,'ext:foo/no');
    const saved=subagents.resolveSubagentProfile(cwd,'scoped');
    assert.deepEqual(saved.extensionScope,['foo','@team/adapter']);
    assert.equal(saved.loadExtensions,false);
    subagents.saveProjectSubagentProfile(cwd,{...saved,extensionScope:['new'],loadExtensions:true});
    assert.deepEqual(subagents.resolveSubagentProfile(cwd,'scoped').extensionScope,['new']);
  } finally { await rm(cwd,{recursive:true,force:true}); }
});

test('save with omitted scope retains authored empty selection independently of activation', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'scope-omitted-save-'));
  const {parseFrontmatter} = await jiti.import('./frontmatter.ts');
  try {
    await mkdir(join(cwd, '.pi/agents'), {recursive:true});
    const file = join(cwd, '.pi/agents/scoped.md');
    for (const alias of ['none', '"false"', '""', '[]', '[none]', '["false"]']) {
      await writeFile(file, `---\nextensions: ${alias}\nskills: [foreign]\nload_extensions: false\n---\nPrompt`);
      const authored = parseFrontmatter(await readFile(file, 'utf8')).data;
      const request = {...subagents.resolveSubagentProfile(cwd, 'scoped'), loadExtensions:true};
      delete request.extensionScope;
      const saved = subagents.saveProjectSubagentProfile(cwd, request);
      const stored = parseFrontmatter(await readFile(file, 'utf8')).data;
      const reopened = subagents.resolveSubagentProfile(cwd, 'scoped');
      assert.deepEqual(saved.extensionScope, [], alias);
      assert.deepEqual(reopened.extensionScope, saved.extensionScope, alias);
      assert.deepEqual(stored.extensions, authored.extensions, alias);
      assert.deepEqual(stored.skills, authored.skills, alias);
      assert.equal(reopened.loadExtensions, true, alias);
    }
  } finally { await rm(cwd, {recursive:true, force:true}); }
});

test('snapshot old, empty and named declarations restore without discovered content', () => {
  for(const scope of [undefined,[],['Foo','foo','@Team/Adapter']]) {
    const resources=subagents.readSubagentSessionResources([{type:'custom',customType:subagents.SUBAGENT_META_TYPE,data:{
      version:1,parentSessionId:'p',parentSessionPath:'/p',resourceSnapshot:{version:1,appendSystemPrompt:[],tools:[],loadSkills:false,loadExtensions:false,...(scope===undefined?{}:{extensionScope:scope})},
    }}]);
    assert.deepEqual(resources.extensionScope,scope===undefined?undefined:scope.length?['foo','@team/adapter']:[]);
  }
});

test('discovery identity shares package aliases, collision ownership and longest matching, never tool suffixes', () => {
  const ext=(path,source)=>({path,sourceInfo:source?{origin:'package',source}:undefined,tools:new Map()});
  const records=[ext('/a/extensions/first.ts','npm:@a/pkg@1.0'),ext('/a/extensions/second.ts','npm:@a/pkg@1.0'),ext('/b/extensions/third.ts','npm:@b/pkg@2.0'),ext('/c/@a.ts'),ext('builtin:registered')];
  const select=scope=>subagents.selectSubagentExtensionPaths(records,scope);
  assert.deepEqual(select(['@a/pkg']),['/a/extensions/first.ts','/a/extensions/second.ts']);
  assert.deepEqual(select(['pkg']),[]);
  assert.deepEqual(select(['@a/pkg/tool']),[]);
  assert.deepEqual(select(['extensions','missing','*','builtin']),[]);
  assert.deepEqual(select(['builtin:registered']),['builtin:registered']);
  assert.deepEqual(select(['first']),['/a/extensions/first.ts']);
});

test('named profile scope normalizes and retains authored CSV across toggles', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'scope-profile-'));
  try {
    await mkdir(join(cwd, '.pi/agents'), { recursive: true });
    const file = join(cwd, '.pi/agents/scoped.md');
    await writeFile(file, '---\nextensions: Foo, @Team/Adapter, foo\nskills: foreign\n---\nPrompt');
    const profile = subagents.resolveSubagentProfile(cwd, 'scoped');
    assert.deepEqual(profile.extensionScope, ['foo', '@team/adapter']);
    assert.equal(profile.loadExtensions, true);
    subagents.saveProjectSubagentProfile(cwd, { ...profile, loadExtensions: false });
    const saved = subagents.resolveSubagentProfile(cwd, 'scoped');
    assert.deepEqual(saved.extensionScope, profile.extensionScope);
    assert.equal(saved.loadExtensions, false);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('corrupt scoped snapshot shape cannot fall back to ordinary discovery, while absent-scope legacy fallback is unchanged', () => {
  assert.throws(()=>subagents.readSubagentSessionResources([{type:'custom',customType:subagents.SUBAGENT_META_TYPE,data:{resourceSnapshot:{extensionScope:['foo']}}}]),/scoped/);
  assert.throws(()=>subagents.readSubagentSessionResources([{type:'custom',customType:subagents.SUBAGENT_META_TYPE,data:{resourceSnapshot:{extensionScope:'foo'}}}]),/extensionScope/);
  for(const resourceSnapshot of [
    {version:2,extensionScope:['foo'],tools:[],appendSystemPrompt:[]},
    {version:1,extensionScope:['foo'],tools:[42],appendSystemPrompt:[]},
  ]) {
    assert.throws(()=>subagents.readSubagentSessionResources([{type:'custom',customType:subagents.SUBAGENT_META_TYPE,data:{version:1,parentSessionId:'p',parentSessionPath:'/p',resourceSnapshot}}]),/scoped/);
    const legacy = {...resourceSnapshot};
    delete legacy.extensionScope;
    assert.equal(subagents.readSubagentSessionResources([{type:'custom',customType:subagents.SUBAGENT_META_TYPE,data:{version:1,parentSessionId:'p',parentSessionPath:'/p',resourceSnapshot:legacy}}]),null);
  }
});

test('snapshot present malformed scope throws rather than widening to ordinary resources', () => {
  for (const extensionScope of ['foo', [42], ['']]) {
    assert.throws(() => subagents.readSubagentSessionResources([{ type: 'custom', customType: subagents.SUBAGENT_META_TYPE, data: {
      version: 1, parentSessionId: 'p', parentSessionPath: '/p', resourceSnapshot: {
        version: 1, appendSystemPrompt: [], tools: [], loadExtensions: true, loadSkills: false, extensionScope,
      },
    } }]), /extensionScope/);
  }
});
