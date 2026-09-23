import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, "SplitPaneLayout.tsx"), "utf-8");
const paneStateSource = readFileSync(join(dir, "..", "lib", "pane-state.ts"), "utf-8");
const paneHeaderSource = readFileSync(join(dir, "PaneHeader.tsx"), "utf-8");

test("the shared tab strip is gone; headers are embedded per pane (pi#25)", () => {
  assert.ok(!source.includes("STRIP_HEIGHT"), "the strip height constant must be gone");
  assert.ok(!source.includes("data-split-tablist"), "the strip's data attribute must be gone");
  assert.ok(!source.includes("onOpenNewSessionTab"), "the strip's + callback must be gone (sidebar is the sole entry)");
  assert.ok(!source.includes("New session\""), "no strip-era new-session button remains");
  // Each pane column renders its own header as the first row, then the
  // content wrapper — PaneHeader sits before the tabpanel content div.
  const headerIdx = source.indexOf("<PaneHeader");
  const panelIdx = source.indexOf('role="tabpanel"');
  assert.ok(headerIdx >= 0, "each pane column embeds a PaneHeader");
  assert.ok(panelIdx > headerIdx, "the pane's content wrapper follows its embedded header");
  assert.ok(source.includes("flex: \"1 1 0\""), "the content wrapper takes the header's remaining height");
});

test("the pane area owns tablist semantics and a stable locator (pi#25)", () => {
  assert.ok(source.includes('role="tablist"'), "the pane area carries role=tablist");
  assert.ok(source.includes('data-split-pane-area="true"'), "the pane area carries the data-split-pane-area marker");
  assert.ok(source.includes('role="tabpanel"'), "each pane's content is a tabpanel");
  assert.ok(source.includes("aria-labelledby={`pane-tab-${tab.sessionId}`}"),
    "the tabpanel is labelled by its embedded header");
  assert.ok(paneHeaderSource.includes('role="tab"'), "headers keep role=tab");
  assert.ok(paneHeaderSource.includes("aria-selected={focused}"), "headers keep aria-selected focus semantics");
});

test("SplitPaneLayout pane area is a horizontal scroll container", () => {
  assert.ok(source.includes("overflowX: \"auto\""), "pane area must scroll horizontally");
  assert.ok(source.includes("flex: \"none\""), "panes must not flex (fixed width)");
  assert.ok(source.includes("width"), "panes must have a width prop");
});

test("SplitPaneLayout derives pixel pane widths from the measured pane area", () => {
  assert.ok(source.includes("paneWidth"), "must use the paneWidth helper");
  assert.ok(source.includes("paneWidth(tabs.length"), "width must derive from the tab count and the measured area");
  assert.ok(source.includes("useChatAppearance"), "must read the live chat content width setting (pi#43)");
  assert.ok(source.includes("minPaneWidthFor"), "must derive the pane minimum via minPaneWidthFor (pi#43)");
  assert.ok(!source.includes("MIN_PANE_WIDTH"), "the fixed 520px minimum constant must be gone");
  assert.ok(source.includes("ResizeObserver"), "must self-measure the pane area with a ResizeObserver");
  assert.ok(source.includes("setPaneAreaWidth"), "measured area width must feed pane sizing");
  assert.ok(source.includes("${width}px"), "pane width must be a pixel value");
  assert.ok(!source.includes("VisiblePanes"), "the manual visible-pane cap setting must be gone");
  assert.ok(!source.includes("density"), "the density concept must be gone");
  assert.ok(paneStateSource.includes("CHAT_COLUMN_PADDING = 16"),
    "pane-state owns the single padding constant the minimum derivation adds (pi#43)");
  assert.ok(paneStateSource.includes("minPaneWidthFor"),
    "pane-state owns the minPaneWidthFor derivation helper (pi#43)");
  assert.ok(!paneStateSource.includes("MIN_PANE_WIDTH = 520"),
    "the fixed 520px minimum constant must be gone from pane-state");
  assert.ok(paneStateSource.includes("Math.max(1, Math.floor(areaWidth / minPaneWidth))"),
    "pane-state clamps capacity to at least one pane");
});

test("embedded headers span the pane width with no strip-era max width", () => {
  assert.ok(!paneHeaderSource.includes("maxWidth: 150"), "the strip-era 150px cap must be gone");
  assert.ok(paneHeaderSource.includes("width: \"100%\""), "the header spans its pane column");
  assert.ok(source.includes("paneHeaderLabel"), "SplitPaneLayout labels headers via paneHeaderLabel");
  assert.ok(paneHeaderSource.includes("textOverflow: \"ellipsis\""), "long labels must truncate with an ellipsis");
  assert.ok(paneHeaderSource.includes("title={label}"), "full label must stay available via tooltip");
});

test("focus discrimination uses isPlainClick (drag-selection does not steal focus)", () => {
  assert.ok(source.includes("isPlainClick"), "must use the isPlainClick helper");
  assert.ok(source.includes("onPointerUp"), "must check selection at pointerup (blocker 2 fix)");
  assert.ok(source.includes("window.getSelection"), "must check for text selection");
  assert.ok(!source.includes("pointerDownHadSelectionRef"), "must NOT track selection at pointerdown");
});

test("SplitPaneLayout exports scrollPaneIntoView for sidebar routing", () => {
  assert.ok(source.includes("scrollPaneIntoView"), "must expose scrollPaneIntoView");
  assert.ok(source.includes("scrollTo"), "must call container.scrollTo");
  assert.ok(source.includes("useImperativeHandle(ref"), "must pass ref to useImperativeHandle (blocker 1 fix)");
});

test("overflow switcher shows only beyond the area's capacity (pi#25)", () => {
  assert.ok(source.includes("visiblePaneCapacity"), "visibility derives from visiblePaneCapacity");
  assert.ok(source.includes("overflowed = tabs.length > paneCapacity"),
    "the indicator shows iff the open count exceeds the capacity");
  assert.ok(source.includes("overflowed &&"), "the indicator is gated on overflowed");
  assert.ok(source.includes("aria-haspopup=\"menu\""), "the trigger carries menu semantics");
  assert.ok(source.includes("aria-expanded={overflowOpen}"), "the trigger exposes its expanded state");
  assert.ok(source.includes("role=\"menu\""), "the dropdown is a menu");
});

test("overflow entries carry label, running dot and badge; activation scrolls and focuses", () => {
  assert.ok(source.includes("paneHeaderLabel(tab)"), "menu entries list paneHeaderLabel");
  assert.ok(source.match(/runningSessionIds\.has\(tab\.sessionId\)/), "entries show the running dot");
  assert.ok(source.includes("data-pane-overflow-item"), "entries are locatable per pane");
  assert.ok(source.includes("tab.hasBadge &&"), "entries show the completion badge");
  const activate = source.match(/activateOverflowEntry = useCallback\([\s\S]*?\}, \[[^\]]*\]\);/);
  assert.ok(activate, "activation is a single callback");
  assert.ok(activate[0].includes("scrollPaneIntoView(sessionId)"), "activation scrolls the pane into view");
  assert.ok(activate[0].includes("onFocusPane(sessionId)"), "activation focuses the pane");
  assert.ok(source.includes("key === \"Escape\""), "Esc closes the dropdown");
});
