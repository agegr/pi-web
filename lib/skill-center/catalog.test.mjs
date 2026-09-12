import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { validateCatalog, canonicalId, classification, parseQuery, queryCatalog, getTaxonomy } = await jiti.import('./catalog.ts');
const fixture = () => JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url)));
test('empty production index retains five domains and never invents skills', () => {
  const t = getTaxonomy();
  assert.deepEqual(t.taxonomy.domains.map(d => d.id), ['computing','finance','philosophy','psychology','metaphysics']);
  assert.equal(t.coverage.returnedCount, 0);
  assert.equal(t.coverage.truncated, false);
  assert.equal(t.coverage.marketTotal, null);
  assert.deepEqual(queryCatalog({domainId:'finance'}).results, []);
});
test('identity separates repositories and unclassified remains unknown', () => {
  assert.notEqual(canonicalId('a/repo@review'),canonicalId('b/repo@review'));
  assert.equal(canonicalId('A/Repo@review'),'skills.sh:a/repo@review');
  assert.equal(classification(null, fixture()).state,'unclassified');
});
test('strict query validates scope and Unicode length without coercion', () => {
  const c = fixture();
  for (const b of [{limit:null},{limit:0},{limit:'3'},{categoryId:'ethics'},{domainId:'finance',categoryId:'ethics'},{domainId:'finance',classificationState:'unclassified'},{query:33}]) assert.throws(()=>parseQuery(b,c));
  assert.throws(()=>parseQuery({query:' '},c,true));
  assert.equal(parseQuery({query:'😀'.repeat(200)},c,true).query.length,400);
  assert.throws(()=>parseQuery({query:'😀'.repeat(201)},c,true));
});
test('rejects duplicate taxonomy and assignments without evidence', () => {
  const c = fixture(); c.taxonomy.domains[1].categories[0].id='frontend-design';
  assert.throws(()=>validateCatalog(c));
  const d = fixture(); d.assignments.push({canonicalSkillId:'skills.sh:a/b@c',domainId:'finance',categoryId:null});
  assert.throws(()=>validateCatalog(d));
});
