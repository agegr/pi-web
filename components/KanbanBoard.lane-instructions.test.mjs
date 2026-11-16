import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// The lane config dialog's per-lane model-facing instructions textarea:
// a work lane holds one, seeded from the lane's saved text; the fixed backlog
// never does (its cards carry no session, so nothing would inject).
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { ConfigLaneRow } = await jiti.import("./KanbanBoard.tsx");
const { KANBAN_LANE_INSTRUCTIONS_MAX } = await jiti.import("@/lib/kanban-tool-limits");
const h = React.createElement;
const noop = () => {};

const render = (lane, index) => renderToStaticMarkup(
  h(I18nProvider, null, h(ConfigLaneRow, {
    lane, index, count: 0, dragged: false,
    onGripPointerDown: noop, onMoveUp: noop, onMoveDown: noop, onRename: noop, onEditInstructions: noop, onDelete: noop,
  })),
);
const textareaOf = (html) => {
  const match = html.match(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/);
  return match ? match[0] : null;
};

test("a work lane holds an instructions textarea seeded with its saved text", () => {
  const html = render({ id: "lane-implement", name: "Implement", description: "", instructions: "Run the suite before done." }, 1);
  const textarea = textareaOf(html);
  assert.ok(textarea, "the textarea renders");
  assert.match(textarea, /data-kanban-lane-instructions="lane-implement"/);
  assert.match(textarea, new RegExp(`maxlength="${KANBAN_LANE_INSTRUCTIONS_MAX}"`, "i"));
  assert.match(textarea, />Run the suite before done\.<\/textarea>/, "the saved text is the value");
  assert.match(textarea, /sent to cards in this lane and the lanes before it/, "the placeholder says it is model-facing");
});

test("a lane without instructions renders an empty textarea; the fixed backlog renders none", () => {
  const empty = textareaOf(render({ id: "lane-plan", name: "Plan", description: "" }, 2));
  assert.ok(empty, "a work lane still offers the field");
  assert.match(empty, /^<textarea[^>]*><\/textarea>$/);
  assert.equal(textareaOf(render({ id: "lane-backlog", name: "Backlog", description: "", fixed: true }, 0)), null, "the backlog never injects");
});
