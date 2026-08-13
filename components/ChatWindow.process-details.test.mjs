import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("renders a Codex-style new-session home", () => {
  assert.match(source, /chat\.homeTitle/);
  assert.match(source, /className="new-session-home/);
  assert.match(source, /handleSend\(`\/skill:\$\{skill\}/);
  assert.match(source, /skill: "requesting-code-review"/);
  assert.match(source, /chat\.homeExplore/);
});

test("keeps process details collapsed even while a session is live", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\)/);
  assert.doesNotMatch(source, /<ProcessDetailsGroup[\s\S]*?\n\s+defaultExpanded(?:=|\s*\n)/);
  assert.doesNotMatch(source, /defaultDetailsExpanded: true/);
  assert.doesNotMatch(source, /<MessageView message=\{streamState\.streamingMessage as AgentMessage\} isStreaming[^>]*defaultDetailsExpanded/);
});
