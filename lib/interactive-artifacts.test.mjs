import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { interactiveFences, messageArtifactVersions, branchArtifactVersions, mergeArtifactVersions } = await jiti.import("./interactive-artifacts.ts");
const fence = (meta = '', code = '<button>Test</button>') => `\`\`\`pi-html${meta ? ' ' + meta : ''}\n${code}\n\`\`\``;

test("artifact IDs are optional, strict and parsed from Markdown code nodes", () => {
  assert.equal(interactiveFences(fence('id="bill-splitter"'))[0].id, 'bill-splitter');
  assert.equal(interactiveFences(fence('id=Test_2'))[0].id, 'Test_2');
  for (const meta of ['', 'id=""', 'id="-bad"', 'id="中文"', 'id="../bad"', 'id="x" id="y"', `id="${'a'.repeat(65)}"`]) {
    assert.equal(interactiveFences(fence(meta))[0].id, undefined);
  }
  for (const text of [`<pre><code>${fence('id="fake"')}</code></pre>`, `---\n${fence('id="fake"')}\n---`, `\`\`\`text\n${fence('id="fake"')}\n\`\`\``]) {
    assert.equal(messageArtifactVersions('e', [{ type: 'text', text }]).length, 0);
  }
});

test("quoted and tilde fences preserve source ordering and require matching closing markers", () => {
  const quoted = `> ${fence('id="demo"').replaceAll('\n', '\n> ')}`;
  const tilde = fence('id="demo"').replaceAll('```', '~~~~');
  assert.deepEqual(interactiveFences(`${quoted}\n\n${tilde}`).map((item) => [item.id, item.ordinal, item.complete]), [['demo', 0, true], ['demo', 1, true]]);
  for (const text of [fence('id="demo"').slice(0, -3), fence('id="demo"').replace(/```$/, '~~~'), fence('id="demo"').replace(/```$/, '    ```')]) {
    assert.equal(messageArtifactVersions('e', [{ type: 'text', text }]).length, 0);
  }
});

test("whitespace before a fence's info string still produces a completed version", () => {
  for (const marker of ['```', '~~~~']) {
    for (const space of [' ', '\t', ' \t ']) {
      const text = `${marker}${space}pi-html id="demo"\n<button>Test</button>\n${marker}`;
      assert.equal(interactiveFences(text)[0].complete, true);
      assert.equal(messageArtifactVersions('e', [{ type: 'text', text }])[0].id, 'demo');
      assert.equal(messageArtifactVersions('e', [{ type: 'text', text: text.slice(0, -marker.length) }]).length, 0);
    }
  }
});

test("only assistant messages produce versions; text block and fence identities are stable", () => {
  const content = [{ type: 'thinking', thinking: fence('id="hidden"') }, { type: 'text', text: `${fence()}\n\n${fence('id="demo"')}` }];
  assert.equal(messageArtifactVersions('e', content)[0].key, 'e:1:1');
  const entries = ['user', 'toolResult', 'custom', 'system', 'assistant'].map((role, index) => ({ type: 'message', id: 'e' + index, message: { role, content } }));
  assert.deepEqual(branchArtifactVersions(entries).map((item) => item.key), ['e4:1:1']);
  assert.equal(messageArtifactVersions('legacy', fence('id="legacy"'))[0].id, 'legacy');
});

test("full-branch metadata merges paged and newly completed local versions without duplication", () => {
  const version = (entryId, code) => ({ id: 'demo', key: entryId + ':0:0', entryId, blockIndex: 0, ordinal: 0, ...(code === undefined ? {} : { code }) });
  const history = [version('a'), version('b')];
  const local = [version('b', 'second'), version('pending-2', 'third')];
  const group = mergeArtifactVersions(history, local).get('demo');
  assert.deepEqual(group.map((item) => item.entryId), ['a', 'b', 'pending-2']);
  assert.equal(group[1].code, 'second');
  assert.equal(mergeArtifactVersions([], local).get('demo').length, 2);
  assert.equal(history[1].code, undefined, 'Metadata is not mutated');
});
