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
  assert.match(source, /maxHeight: "50vh"/);
  assert.match(source, /overflowY: "auto"/);
  assert.match(source, /followLatestRef\.current/);
  assert.match(source, /element\.scrollTop = element\.scrollHeight/);
});

test("renders live work in compact completed and detailed active states", () => {
  assert.match(source, /processingState: processIdx === activeCompletedIdx \? "active" : "complete"/);
  assert.match(source, /processingState="active"/);
  assert.match(source, /!showLiveProcessPanel && streamState\.isStreaming/);
});
