import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("groups the leading segment when the history page starts mid-turn", () => {
  // A turn longer than the initial page loses its anchor, and the old loop
  // flattened every message before the first anchor instead of grouping them.
  assert.match(source, /const hasAnchor = isMessageGroupAnchor\(msg\)/);
  assert.match(source, /if \(!hasAnchor && idx !== 0\)/);
  assert.match(source, /const userIdx = hasAnchor \? idx : -1/);
  assert.match(source, /const groupStartIdx = hasAnchor \? idx : 0/);
  assert.match(source, /if \(hasAnchor\) rendered\.push\(renderMessage\(userIdx\)\)/);
});

test("expands process details when a completed turn has no final answer", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\)/);
  assert.match(
    source,
    /<ProcessDetailsGroup[\s\S]*?defaultExpanded=\{!finalAnswerMessage\}/,
  );
});

test("resets process details when the turn gains or loses its final answer", () => {
  // useState only reads defaultExpanded on mount; keying on answer availability
  // makes an answered turn start collapsed even if it first rendered unanswered.
  assert.match(
    source,
    /<ProcessDetailsGroup key=\{finalAnswerMessage \? "answered" : "unanswered"\}[\s\S]*?defaultExpanded=\{!finalAnswerMessage\}/,
  );
});

test("passes a grouped turn's MessageViews the same copies on every render (#1005)", () => {
  // Fresh copies per render re-ran every visible answer's markdown on each
  // chat update, e.g. on every key typed into an extension's custom panel.
  assert.doesNotMatch(source, /withAssistantBlocks\(/);
  assert.match(source, /const finalAnswerViewCache = useMemo\(\(\) => new WeakMap<AssistantMessage, FinalAnswerViews>\(\), \[\]\)/);
  assert.match(source, /const finalViews = getFinalAnswerViews\(finalAnswerViewCache, messages\[finalAssistantIdx\] as AssistantMessage\)/);
  assert.match(source, /processIdx === finalAssistantIdx \? finalViews\.process : processMessage/);
  assert.match(source, /keepWrittenFiles\(finalViews, extractTurnWrittenFiles\(/);
});
