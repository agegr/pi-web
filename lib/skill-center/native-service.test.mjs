import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createPlan, submitOperation, getOperation, checks, visibility, setClassification } = await jiti.import('./mutations.ts');
const { inventory } = await jiti.import('./inventory.ts');
const { getTaxonomy } = await jiti.import('./catalog.ts');
const { leaseRecord } = await jiti.import('./journal.ts');
const { allowFileRoot } = await jiti.import('../file-access.ts');
const canonical = 'agentskill.sh:owner/review';
const skillMd = body => `---\nname: review\ndescription: Review code\n---\n${body}\n`;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-native-service-test-'));
  const agent = join(root, 'agent'); const cwd = join(root, 'project'); mkdirSync(agent); mkdirSync(cwd);
  const previous = Object.fromEntries(['PI_CODING_AGENT_DIR', 'XDG_STATE_HOME', 'HOME', 'USERPROFILE'].map(k => [k, process.env[k]]));
  process.env.PI_CODING_AGENT_DIR = agent; process.env.XDG_STATE_HOME = join(root, 'state'); process.env.HOME = root; process.env.USERPROFILE = root;
  const originalFetch = globalThis.fetch;
  let body = 'First version'; let failure = false;
  globalThis.__piProviderReads = undefined; globalThis.__piProviderCooldowns = undefined;
  globalThis.fetch = async input => {
    assert.match(String(input), /\/api\/agent\/skills\/owner%2Freview\/install$/);
    if (failure) return new Response('unavailable', { status: 500 });
    return Response.json({ slug: 'owner/review', skillMd: skillMd(body), skillFiles: [{ path: 'scripts/check.js', content: 'throw new Error("Never execute")' }], installCount: 120 });
  };
  allowFileRoot(cwd); globalThis.__piAllowedRootsCache = undefined;
  t.after(() => {
    globalThis.fetch = originalFetch; globalThis.__piProviderReads = undefined; globalThis.__piProviderCooldowns = undefined;
    for (const [k, v] of Object.entries(previous)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(root, { recursive: true, force: true }); globalThis.__piAllowedRootsCache = undefined;
  });
  return { root, agent, cwd, update(value) { body = value; globalThis.__piProviderReads = undefined; }, fail() { failure = true; globalThis.__piProviderReads = undefined; } };
}
async function submit(stored, key = randomUUID()) {
  let calls = 0;
  const response = await submitOperation({ planId: stored.plan.planId, idempotencyKey: key, acknowledgements: stored.plan.requiredAcknowledgements }, async () => { calls++; throw new Error('Native install must not invoke CLI'); });
  let op = response.operation;
  for (let n = 0; n < 100 && ['accepted', 'running', 'verifying'].includes(op.state); n++) { await delay(10); op = await getOperation(op.operationId); }
  assert.equal(calls, 0); assert.equal(leaseRecord(), null);
  assert.equal(op.state, 'succeeded', JSON.stringify(op));
  return op;
}
test('native install persists verified identity, uses configured Agent directory and is idempotent', async t => {
  const f = fixture(t);
  const stored = await createPlan({ kind: 'install', canonicalSkillId: canonical, cwd: null, scope: 'global' });
  assert.equal(stored.plan.state, 'ready'); assert.equal(stored.plan.sourceVersionPinned, true);
  assert.equal(stored.plan.target.logicalPath, join(f.agent, 'skills', 'review', 'SKILL.md'));
  const key = randomUUID(); const op = await submit(stored, key);
  const retry = await submitOperation({ planId: stored.plan.planId, idempotencyKey: key, acknowledgements: stored.plan.requiredAcknowledgements });
  assert.equal(retry.duplicate, true); assert.equal(retry.operation.operationId, op.operationId);
  const item = (await inventory(null)).installations[0];
  assert.equal(item.canonicalSkillId, canonical); assert.equal(item.managed, true); assert.equal(item.capabilities.update, true);
  assert.equal(item.loadState, 'effective');
  assert.equal(item.managementBindings.length, 1); assert.equal(item.managementBindings[0].sourceType, 'native-bundle');
  assert.equal(existsSync(join(f.root, 'state', 'skills', '.skill-lock.json')), false);
  assert.equal((await checks(null, [item.installationId])).results[0].state, 'up-to-date');
  assert.equal((await createPlan({ kind: 'install', canonicalSkillId: canonical, cwd: null, scope: 'global' })).plan.state, 'blocked');
});
test('native update preserves classification and visibility, blocks local edits, and reports unavailable source', async t => {
  const f = fixture(t); await submit(await createPlan({ kind: 'install', canonicalSkillId: canonical, cwd: null, scope: 'global' }));
  let item = (await inventory(null)).installations[0];
  await visibility(item.installationId, { cwd: null, expectedRevision: item.revision, disableModelInvocation: true });
  item = (await inventory(null)).installations[0]; const { taxonomy } = getTaxonomy();
  await setClassification(item.installationId, { cwd: null, expectedRevision: item.revision, expectedClassificationRevision: item.classification.personalRevision ?? null, taxonomyVersion: taxonomy.version, indexRevision: taxonomy.indexRevision, assignments: [{ domainId: 'computing', categoryId: null }] });
  f.update('Updated'); assert.equal((await checks(null, [item.installationId])).results[0].state, 'update-available');
  const plan = await createPlan({ kind: 'update', installationId: item.installationId, cwd: null, expectedRevision: item.revision });
  assert.equal(plan.plan.state, 'ready'); assert.equal(plan.plan.localChanges, 'none');
  await submit(plan); item = (await inventory(null)).installations[0];
  assert.equal(item.disableModelInvocation, true); assert.deepEqual(item.classification.assignments, [{ domainId: 'computing', categoryId: null }]);
  assert.match(readFileSync(item.realPath, 'utf8'), /Updated/);
  writeFileSync(join(dirname(item.realPath), 'scripts/check.js'), 'Local change'); f.update('Third');
  const blocked = await createPlan({ kind: 'update', installationId: item.installationId, cwd: null, expectedRevision: item.revision });
  assert.ok(blocked.plan.blockers.some(b => b.code === 'LOCAL_CHANGES'));
  f.fail(); assert.equal((await checks(null, [item.installationId])).results[0].state, 'error');
});
test('native project install requires and persists existing project trust acknowledgement', async t => {
  const f = fixture(t); const plan = await createPlan({ kind: 'install', canonicalSkillId: canonical, cwd: f.cwd, scope: 'project' });
  assert.ok(plan.plan.requiredAcknowledgements.includes('trust-project-resources'));
  await submit(plan);
  const item = (await inventory(f.cwd)).installations.find(i => i.canonicalSkillId === canonical);
  assert.equal(item.scope, 'project'); assert.equal(item.logicalPath, join(f.cwd, '.pi', 'skills', 'review', 'SKILL.md'));
  assert.equal(existsSync(join(f.cwd, 'skills-lock.json')), false);
});
test('native operation installs the approved preview even if the source changes before submission', async t => {
  const f = fixture(t); const plan = await createPlan({ kind: 'install', canonicalSkillId: canonical, cwd: null, scope: 'global' });
  f.update('New upstream version'); const op = await submit(plan);
  const item = (await inventory(null)).installations[0];
  assert.match(readFileSync(item.realPath, 'utf8'), /First version/);
  assert.equal(op.result.currentSourceStatus, 'update-available');
  assert.equal(op.result.actualVersion.value, plan.plan.observedSourceVersion.value);
});
