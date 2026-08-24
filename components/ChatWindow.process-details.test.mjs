import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("expands process details when a completed turn has no final answer", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\)/);
  assert.match(
    source,
    /<ProcessDetailsGroup[\s\S]*?defaultExpanded=\{!finalAnswerMessage\}/,
  );
});

test("bounds live process details and follows the latest operation", () => {
  assert.match(source, /function LiveProcessPanel/);
  assert.match(source, /maxHeight: "50dvh"/);
  assert.match(source, /overflowY: "auto"/);
  assert.match(source, /followLatestRef\.current/);
  assert.match(source, /element\.scrollTop = element\.scrollHeight/);
  // The panel sits mid-conversation, so it must let scrolling chain outward.
  assert.doesNotMatch(source, /overscrollBehavior: "contain"/);
});

test("keeps the live panel addressable by the minimap and out of bash runs", () => {
  assert.match(source, /const liveRefIdx = liveProcessIndices[\s\S]*?visibleRefIndexByMessage\.get\(processIdx\)/);
  assert.match(source, /ref=\{liveRefIdx === undefined \? undefined : \(el\) => \{ messageRefs\.current\[liveRefIdx\] = el; \}\}/);
  assert.match(source, /const showLiveProcessPanel = \(agentRunning \|\| streamState\.isStreaming\) && latestLiveAnchorIdx >= 0/);
  assert.match(source, /const showMainLiveProcessPanel = !activeThread && showLiveProcessPanel/);
});

test("renders live work in compact completed and detailed active states", () => {
  assert.match(source, /processingState: processIdx === activeCompletedIdx \? "active" : "complete"/);
  assert.match(source, /processingState="active"/);
  assert.match(source, /!showMainLiveProcessPanel && streamState\.isStreaming/);
});
