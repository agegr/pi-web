import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./[...path]/route.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function PATCH(");
const end = source.indexOf("export async function POST(", start);
assert.notEqual(start, -1, "Markdown edit route not found");
assert.notEqual(end, -1, "Markdown edit route end not found");
const patchBlock = source.slice(start, end);

test("Markdown editing keeps the file API request and path guards", () => {
  assert.match(patchBlock, /isApiRequestAllowed\(request\)/);
  assert.match(patchBlock, /hasJsonContentType\(request\)/);
  assert.match(patchBlock, /isFilePathAllowed\(filePath, allowedRoots\)/);
  assert.match(patchBlock, /isExistingFilePathAllowed\(filePath, allowedRoots\)/);
  assert.match(patchBlock, /lstatSync\(filePath\)/);
  assert.match(patchBlock, /isSymbolicLink\(\)/);
});

test("Markdown editing validates content and bounds the write size", () => {
  assert.match(source, /extension === "md" \|\| extension === "mdx"/);
  assert.match(patchBlock, /typeof body\.content !== "string"/);
  assert.match(patchBlock, /MAX_MARKDOWN_EDIT_BYTES/);
  assert.match(patchBlock, /writeFileSync\(filePath, body\.content, "utf8"\)/);
});
