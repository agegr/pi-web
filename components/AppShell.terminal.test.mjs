import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("keeps the integrated terminal mounted while chat is visible", () => {
  assert.match(source, /const \[terminalMounted, setTerminalMounted\] = useState\(false\)/);
  assert.match(source, /setTerminalMounted\(true\);[\s\S]*?setMainView/);
  assert.match(source, /terminalMounted && projectTrustCwd && \([\s\S]*?display: mainView === "terminal" \? "block" : "none"[\s\S]*?<TerminalPanel/);
  assert.doesNotMatch(source, /mainView === "terminal" && projectTrustCwd && <TerminalPanel/);
});
