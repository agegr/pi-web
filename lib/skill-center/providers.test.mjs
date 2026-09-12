import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { search, detail, snapshotContent, snapshotFiles } = await jiti.import('./remote.ts');
const { nativeSourceSkill, validateBundle, skillsmpBundle, nativeSkillBundle } = await jiti.import('./providers.ts');
const text = '---\nname: review\ndescription: Review code\n---\nReview the supplied code.';
function fixture(t) {
  const original = globalThis.fetch;
  const old = process.env.SKILLSMP_API_KEY;
  globalThis.__piProviderReads = new Map(); globalThis.__piProviderCooldowns = new Map();
  t.after(() => { globalThis.fetch = original; globalThis.__piProviderReads = undefined; globalThis.__piProviderCooldowns = undefined; if (old === undefined) delete process.env.SKILLSMP_API_KEY; else process.env.SKILLSMP_API_KEY = old; });
}
test('SkillsMP search maps exact GitHub location and stars without manufacturing install counts', async t => {
  fixture(t); process.env.SKILLSMP_API_KEY = 'fixture-secret'; let calls = 0;
  globalThis.fetch = async (input, options) => { calls++; const url = new URL(input); assert.equal(url.pathname, '/api/v1/skills/search'); assert.equal(url.searchParams.has('domainId'), false); assert.equal(options.headers.Authorization, 'Bearer fixture-secret'); return Response.json({ success: true, data: { skills: [{ name: 'review', githubUrl: 'https://github.com/a/b/tree/main/skills/review', stars: 100 }], pagination: { hasNext: true } } }); };
  const result = await search({ provider: 'skillsmp', query: 'review', domainId: 'computing' });
  assert.equal(result.results[0].repositoryStars, 100); assert.equal(result.results[0].installCount, null);
  assert.equal(decodeURIComponent(result.results[0].canonicalSkillId.slice(9)), 'https://github.com/a/b/tree/main/skills/review');
  assert.equal(result.coverage.truncated, true); assert.equal(result.coverage.marketTotal, null);
  await search({ provider: 'skillsmp', query: 'review' }); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});
test('agentskill.sh search uses its official endpoint and keeps zero distinct from missing installs', async t => {
  fixture(t); globalThis.fetch = async input => { assert.equal(new URL(input).pathname, '/api/agent/search'); return Response.json({ results: [{ slug: 'a/review', installCount: 0 }, { slug: 'b/review' }], total: 2, hasMore: false }); };
  const result = await search({ provider: 'agentskill.sh', query: 'review' });
  assert.deepEqual(result.results.map(s => s.canonicalSkillId), ['agentskill.sh:a/review', 'agentskill.sh:b/review']);
  assert.equal(result.results[0].installCount.numeric, 0); assert.equal(result.results[1].installCount, null);
});
test('unknown sources, source errors, malformed replies and rate limits do not masquerade as empty results', async t => {
  fixture(t); await assert.rejects(() => search({ provider: 'other', query: 'review' }), e => e.code === 'INVALID_PROVIDER');
  for (const response of [new Response('', { status: 500 }), Response.json({ error: true }), Response.json({ success: false, data: { skills: [] } })]) {
    globalThis.__piProviderReads.clear(); globalThis.fetch = async () => response;
    await assert.rejects(() => search({ provider: 'skillsmp', query: 'review' }), e => e.code.startsWith('SOURCE_'));
  }
  let calls = 0; globalThis.__piProviderReads.clear(); globalThis.fetch = async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '120' } }); };
  for (const query of ['one', 'two']) await assert.rejects(() => search({ provider: 'skillsmp', query }), e => e.code === 'SOURCE_RATE_LIMITED');
  assert.equal(calls, 1);
});
test('agentskill.sh detail snapshots the complete verified bundle and never emits a fake GitHub link', async t => {
  fixture(t); let calls = 0;
  globalThis.fetch = async input => { calls++; assert.equal(new URL(input).pathname, '/api/agent/skills/a%2Freview/install'); return Response.json({ slug: 'a/review', skillMd: text, skillFiles: [{ path: 'references/notes.md', content: 'Notes' }], contentSha: 'opaque-version' }); };
  const d = await detail({ kind: 'remote', canonicalSkillId: 'agentskill.sh:a/review' });
  assert.equal(d.skill.name, 'review'); assert.equal(d.version.kind, 'provider-content-hash'); assert.match(d.version.value, /^[a-f0-9]{64}$/);
  assert.equal((await snapshotFiles(d.snapshotId)).files.length, 2);
  const content = await snapshotContent(d.snapshotId, 'references/notes.md'); assert.equal(content.text, 'Notes'); assert.equal(content.sourceUrl, 'https://agentskill.sh');
  await nativeSkillBundle('agentskill.sh:a/review'); assert.equal(calls, 1);
});
test('SkillsMP reads the exact directory at the longest matching slash-containing ref', async t => {
  fixture(t); const id = `skillsmp:${encodeURIComponent('https://github.com/a/b/tree/feature/ui/skills/review')}`;
  globalThis.fetch = async input => new URL(input).pathname.endsWith('/commits/feature%2Fui') ? Response.json({ sha: 'a'.repeat(40) }) : new Response('', { status: 404 });
  const bundle = await skillsmpBundle(id, false, async (source, commit, read) => {
    assert.equal(source, 'a/b'); assert.equal(commit, 'a'.repeat(40));
    return read({ sha: commit, tree: [{ path: 'skills/review/SKILL.md', type: 'blob', mode: '100644', sha: 'b'.repeat(40), size: text.length }, { path: 'skills/other/SKILL.md', type: 'blob', mode: '100644', sha: 'c'.repeat(40), size: text.length }, { path: 'skills/review/icon.png', type: 'blob', mode: '100644', sha: 'd'.repeat(40), size: 3 }], readBlob: async sha => sha.startsWith('d') ? Buffer.from([0,255,12]) : Buffer.from(text) });
  });
  assert.equal(bundle.files.length, 2); assert.equal(bundle.skill.name, 'review');
  assert.equal(bundle.files.find(f => f.path === 'icon.png').encoding, 'base64');
});
test('untrusted URLs and file paths are rejected before installation', t => {
  fixture(t);
  for (const url of ['http://github.com/a/b', 'https://github.com.evil/a/b', 'https://user:secret@github.com/a/b', 'https://github.com/a/b/tree/main/%2e%2e/file']) assert.throws(() => nativeSourceSkill(`skillsmp:${encodeURIComponent(url)}`));
  const skill = nativeSourceSkill('agentskill.sh:a/review');
  for (const path of ['../secret', 'C:/secret', '/secret', 'refs/CON', 'refs/name.', 'x:y', 'a\\b']) assert.throws(() => validateBundle(skill, [{ path: 'SKILL.md', content: text }, { path, content: 'x' }]));
  assert.throws(() => validateBundle(skill, [{ path: 'SKILL.md', content: text }, { path: 'skill.md', content: text }]));
  assert.throws(() => validateBundle(skill, [{ path: 'SKILL.md', content: text }, { path: 'x', content: 'x' }, { path: 'x/y', content: 'y' }]));
});
test('bundle version changes for support files and rejects invalid base64', t => {
  fixture(t); const skill = nativeSourceSkill('agentskill.sh:a/review');
  const one = validateBundle(skill, [{ path: 'SKILL.md', content: text }, { path: 'ref.md', content: 'one' }]);
  const two = validateBundle(skill, [{ path: 'SKILL.md', content: text }, { path: 'ref.md', content: 'two' }]);
  assert.notEqual(one.version.value, two.version.value);
  assert.throws(() => validateBundle(skill, [{ path: 'SKILL.md', content: text }, { path: 'bad.bin', content: '%%%', encoding: 'base64' }]));
});
