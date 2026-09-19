import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const session = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const thinkingControl = source.slice(source.indexOf("{onThinkingLevelChange && ("));

test("keeps one thinking control and disables it while the session is busy", () => {
  assert.doesNotMatch(source, /isStreaming && onThinkingLevelChange/);
  assert.doesNotMatch(thinkingControl, /<span\s+title=\{t\("chat\.currentReasoning"/);
  assert.match(thinkingControl, /disabled=\{isStreaming\}/);
  assert.match(thinkingControl, /title=\{isStreaming/);
  assert.match(thinkingControl, /t\("chat\.currentReasoning", \{ level: thinkingDisplayLabel \}\)/);
  assert.match(thinkingControl, /t\("chat\.changeReasoning", \{ level: thinkingDisplayLabel \}\)/);
});

test("shows the resolved level and treats auto as an uncommitted default", () => {
  assert.match(source, /resolvedThinkingLevel = thinkingLevel && thinkingLevel !== "auto"/);
  assert.match(source, /isAutoThinkingSelection/);
  assert.match(thinkingControl, /lvl === "auto"\s*\n\s*\? isAutoThinkingSelection/);
  assert.match(thinkingControl, /if \(!isActive \|\| isAutoThinkingSelection\) onThinkingLevelChange\(lvl\)/);
});

test("session hook layers thinking like the model selector", () => {
  assert.match(session, /displayThinkingLevel = isNew/);
  assert.match(session, /newSessionThinkingLevel \?\? newSessionDefaultThinkingLevel/);
  assert.match(session, /isAutoThinkingSelection: isNew && newSessionThinkingLevel === null/);
  assert.match(session, /if \(state\?\.thinkingLevel !== undefined\) \{\s*setLiveThinkingLevel\(asConcreteThinkingLevel\(state\.thinkingLevel\)\);/);
  const start = session.slice(session.indexOf('case "agent_start":'), session.indexOf('case "agent_end":'));
  assert.doesNotMatch(start, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}`\)/);
  assert.match(session, /if \(level === "auto"\) \{/);
});
