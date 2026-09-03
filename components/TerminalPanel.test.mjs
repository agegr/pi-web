import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./TerminalPanel.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("connects the browser terminal through the bounded server session", () => {
  assert.match(source, /new Terminal\(/);
  assert.match(source, /new EventSource\(`\/api\/terminal\/\$\{encodeURIComponent\(data\.id\)\}\/events`\)/);
  assert.match(source, /method: "DELETE", keepalive: true/);
});

test("terminal fills the final grid row and reserves an input row", () => {
  assert.match(css, /\.terminal-xterm \{\s+grid-row: -2 \/ -1;/);
  assert.match(css, /padding: 10px 8px 22px 12px;/);
});
