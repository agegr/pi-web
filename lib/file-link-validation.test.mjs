import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { validateFileLink } = await jiti.import("./file-link-validation.ts");
const { remarkFileLinks } = await jiti.import("./remark-file-links.ts");

test("only successful authorized metadata requests validate a file; failures are retried", async (t) => {
  let status = 404;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls++;
    assert.match(url, /^\/api\/files\/.*\?type=meta$/);
    return new Response(null, { status });
  });
  for (const code of [404, 403, 400, 500]) {
    status = code;
    assert.equal(await validateFileLink("/project/foo.ts"), false);
  }
  status = 200;
  assert.equal(await validateFileLink("/project/foo.ts"), true);
  assert.equal(calls, 5);
});

test("deduplicates concurrent validation and fails closed on network errors", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("offline"); });
  assert.deepEqual(await Promise.all([validateFileLink("/p/a"), validateFileLink("/p/a")]), [false, false]);
  assert.equal(calls, 1);
});

test("candidate links preserve original text, with full labels stored separately", () => {
  const tree = { type: "root", children: [{ type: "paragraph", children: [
    { type: "inlineCode", value: "on/start/input" },
    { type: "inlineCode", value: "src/main.ts:12" },
  ] }] };
  remarkFileLinks({ cwd: "D:/project" })(tree);
  const nodes = tree.children[0].children;
  assert.equal(nodes[0].children[0].value, "on/start/input");
  assert.equal(nodes[1].children[0].value, "src/main.ts:12");
  assert.equal(nodes[1].data.hProperties.dataFilePathLabel, "D:/project/src/main.ts:12");
});
