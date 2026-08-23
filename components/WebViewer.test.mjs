import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./WebViewer.tsx", import.meta.url), "utf8");

test("web viewer validates and normalizes user-entered addresses before framing them", () => {
  assert.match(source, /normalizeWebUrl\(input\)/);
  assert.match(source, /onNavigate\(nextUrl, getWebUrlLabel\(nextUrl\)\)/);
  assert.match(source, /inputMode="url"/);
  assert.match(source, /type="text"/);
});

test("web viewer restricts framed content and provides an external fallback", () => {
  assert.match(source, /<iframe/);
  assert.match(source, /sandbox="allow-downloads allow-forms allow-popups allow-same-origin allow-scripts"/);
  assert.match(source, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
});
