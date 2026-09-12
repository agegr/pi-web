import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { validateNativeBundle, nativeTarget, nativeRecord, nativeTree, writeNativeBundle } = await jiti.import('./native-install.ts');
const entry = body => `---\nname: review\ndescription: Review code\n---\n${body}\n`;
const bundle = (body = 'First version') => ({
  skill: { canonicalSkillId: 'agentskill.sh:owner/review', name: 'review', source: 'owner/review' },
  files: [{ path: 'SKILL.md', content: entry(body) }, { path: 'scripts/probe.js', content: 'throw new Error("must not execute")' }],
  version: { value: body, kind: 'provider-content-hash', label: '文件包版本' },
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-native-skill-test-'));
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); });
  return { root, target: nativeTarget('global', null, 'review') };
}
test('native bundle rejects escaping paths, Windows aliases, duplicate paths and directory/file collisions', () => {
  for (const path of ['../outside', '/outside', 'C:/outside', 'a\\b', 'a/%2e', 'con.txt', 'a./x', 'a /x', 'a//b', 'a/../b', 'SKILL.md', 'skill.md', 'scripts']) {
    const value = bundle(); value.files.push({ path, content: 'bad' });
    assert.throws(() => validateNativeBundle(value), e => e.code === 'INVALID_BUNDLE', path);
  }
  const value = bundle(); value.files[0].content = entry('x').replace('name: review', 'name: different');
  assert.throws(() => validateNativeBundle(value), e => e.code === 'INVALID_BUNDLE');
});
test('native bundle enforces nested directory limit and per-file size', () => {
  const size = process.env.PI_SKILL_CENTER_MAX_TREE_ENTRIES;
  process.env.PI_SKILL_CENTER_MAX_TREE_ENTRIES = '3';
  try { const value = bundle(); value.files[1].path = 'a/b/c/script.js'; assert.throws(() => validateNativeBundle(value), e => e.code === 'INVALID_BUNDLE'); }
  finally { if (size === undefined) delete process.env.PI_SKILL_CENTER_MAX_TREE_ENTRIES; else process.env.PI_SKILL_CENTER_MAX_TREE_ENTRIES = size; }
  const value = bundle(); value.files[1].content = 'a'.repeat(524289);
  assert.throws(() => validateNativeBundle(value), e => e.code === 'INVALID_BUNDLE');
});
test('native installation writes support scripts without executing them and stores independent identity', t => {
  const { target } = fixture(t); const value = bundle();
  writeNativeBundle(value, target, 'global', null, null, null);
  assert.equal(readFileSync(target, 'utf8'), entry('First version'));
  assert.equal(readFileSync(join(dirname(target), 'scripts/probe.js'), 'utf8'), value.files[1].content);
  assert.equal(nativeRecord(target).canonical, value.skill.canonicalSkillId);
  assert.equal(nativeRecord(target).version.value, value.version.value);
  assert.equal(nativeRecord(target).scope, 'global');
});
test('native installation refuses an existing directory even without SKILL.md', t => {
  const { target } = fixture(t); mkdirSync(dirname(target), { recursive: true });
  const existing = join(dirname(target), 'user.txt'); writeFileSync(existing, 'keep');
  assert.throws(() => writeNativeBundle(bundle(), target, 'global', null, null, null), e => e.code === 'TARGET_CONFLICT');
  assert.equal(readFileSync(existing, 'utf8'), 'keep'); assert.equal(existsSync(target), false);
});
test('native update replaces the complete directory, removes old upstream files and preserves visibility', t => {
  const { target } = fixture(t); const initial = bundle();
  writeNativeBundle(initial, target, 'global', null, null, null);
  const before = nativeTree(dirname(target)); const updated = bundle('Updated'); updated.files.pop();
  writeNativeBundle(updated, target, 'global', null, before, true);
  assert.match(readFileSync(target, 'utf8'), /disable-model-invocation: true/);
  assert.match(readFileSync(target, 'utf8'), /Updated/);
  assert.equal(existsSync(join(dirname(target), 'scripts/probe.js')), false);
  assert.equal(nativeRecord(target).version.value, 'Updated');
});
test('native update refuses changed support files and preserves the previous install', t => {
  const { target } = fixture(t); writeNativeBundle(bundle(), target, 'global', null, null, null);
  const before = nativeTree(dirname(target)); const support = join(dirname(target), 'scripts/probe.js'); writeFileSync(support, 'local change');
  assert.throws(() => writeNativeBundle(bundle('Updated'), target, 'global', null, before, false), e => e.code === 'REVISION_CONFLICT');
  assert.equal(readFileSync(support, 'utf8'), 'local change'); assert.match(readFileSync(target, 'utf8'), /First version/);
});
test('native update refuses links without reading or writing their external targets', t => {
  const { root, target } = fixture(t); writeNativeBundle(bundle(), target, 'global', null, null, null);
  const before = nativeTree(dirname(target)); const external = join(root, 'external'); mkdirSync(external); writeFileSync(join(external, 'private.txt'), 'keep');
  symlinkSync(external, join(dirname(target), 'linked'), 'junction');
  assert.throws(() => writeNativeBundle(bundle('Updated'), target, 'global', null, before, false), e => e.code === 'FORBIDDEN_PATH');
  assert.equal(readFileSync(join(external, 'private.txt'), 'utf8'), 'keep');
});
test('SkillsMP uses the same independent installation contract', t => {
  const { target } = fixture(t); const value = bundle();
  value.skill.canonicalSkillId = 'skillsmp:' + encodeURIComponent('https://github.com/example/repo/tree/main/skills/review'); value.skill.source = 'example/repo';
  writeNativeBundle(value, target, 'global', null, null, null);
  assert.equal(nativeRecord(target).canonical, value.skill.canonicalSkillId);
});
test('native bundle preserves binary bytes and rejects malformed base64 or binary SKILL.md', t => {
  const { target } = fixture(t); const value = bundle(); const bytes = Buffer.from([0, 255, 128, 1, 9]);
  value.files.push({ path: 'assets/template.bin', encoding: 'base64', content: bytes.toString('base64') });
  writeNativeBundle(value, target, 'global', null, null, null);
  assert.deepEqual(readFileSync(join(dirname(target), 'assets/template.bin')), bytes);
  for (const content of ['@@@', 'Zg', 'Zg==\n', 'Zg===']) {
    const bad = bundle(); bad.files.push({ path: 'asset.bin', encoding: 'base64', content });
    assert.throws(() => validateNativeBundle(bad), e => e.code === 'INVALID_BUNDLE');
  }
  const bad = bundle(); bad.files[0] = { ...bad.files[0], encoding: 'base64', content: Buffer.from(bad.files[0].content).toString('base64') };
  assert.throws(() => validateNativeBundle(bad), e => e.code === 'INVALID_BUNDLE');
});
