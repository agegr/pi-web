import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// pi#17 regression guards: the jump-to-bottom button must be visible exactly
// when the chat is scrolled up beyond the reattach tolerance, must not render
// (not merely be transparent) when at the tail or during scroll-restore, and
// clicking it must both smooth-scroll and re-attach live-follow.

test("hook derives isScrolledUp from the existing scroll path using CHAT_SCROLL_REATTACH_TOLERANCE", async () => {
  const source = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const handler = source.match(/const handleScrollPositionChange = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[scrollToBottom\]\);/);
  assert.ok(handler, "handleScrollPositionChange must exist");
  assert.match(handler[0], /const distanceFromBottom = scrollHeight - clientHeight - scrollTop;/);
  assert.match(handler[0], /CHAT_SCROLL_REATTACH_TOLERANCE/, "the visibility threshold must reuse the exported reattach tolerance, not a new constant");
  assert.match(handler[0], /setIsScrolledUp\(nextScrolledUp\)/);
  assert.doesNotMatch(handler[0], /addEventListener/, "no second scroll listener stack: visibility must come from the existing scroll event path");
  // Guard against redundant setState while streaming keeps firing tail scrolls.
  assert.match(handler[0], /isScrolledUpRef\.current !== nextScrolledUp/);
});

test("jumpToLatest smooth-scrolls and re-attaches live-follow with an optimistic state reset", async () => {
  const source = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const jump = source.match(/const jumpToLatest = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[scrollToBottom\]\);/);
  assert.ok(jump, "jumpToLatest callback must exist");
  assert.match(jump[0], /isNearBottomRef\.current = true;/, "clicking must re-attach live-follow (scrollToBottom alone does not touch the ref)");
  assert.match(jump[0], /isScrolledUpRef\.current = false;/, "the redundant-update guard mirror must be kept in sync with the optimistic reset");
  assert.match(jump[0], /setIsScrolledUp\(false\)/, "the button must hide immediately, not only once the smooth scroll lands");
  assert.match(jump[0], /scrollToBottom\("smooth"\)/);
});

test("hook exports the new state and action alongside scrollToBottom", async () => {
  const source = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  assert.match(source, /const \[isScrolledUp, setIsScrolledUp\] = useState\(false\);/);
  assert.match(source, /scrollToBottom, jumpToLatest, isScrolledUp, scrollUserMsgToTop, scrollToMessage, scrollToOffset,/);
});

test("JumpToBottom renders nothing when not visible and is a native accessible button", async () => {
  const source = await readFile(new URL("./JumpToBottom.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!visible\) return null;/, "hidden must mean not rendered, not merely transparent");
  assert.match(source, /<button type="button"/, "native button so Tab/Enter/Space activation works");
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /title=\{label\}/);
  assert.match(source, /position: "absolute",/, "overlay only: the pill must not participate in layout");
  assert.match(source, /bottom: insetBottom/);
  assert.match(source, /right: insetRight/);
});

test("ChatWindow gates the pill on isScrolledUp && !pendingScrollRestore and places it clear of the minimap", async () => {
  const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(source, /visible=\{isScrolledUp && !pendingScrollRestore\}/,
    "no pill during the hidden scroll-restore window; after restore only if the restored position is above threshold");
  assert.match(source, /onJump=\{jumpToLatest\}/);
  assert.match(source, /label=\{t\("chat\.jumpToLatest"\)\}/);
  assert.match(source, /insetRight=\{isMobile \? 8 : CHAT_MINIMAP_WIDTH\}/,
    "right inset must be derived from the minimap width on desktop and a small inset on mobile");
  assert.match(source, /import JumpToBottom from "\.\/JumpToBottom";/);
});

test("localized label key exists in all three locales", async () => {
  for (const file of ["../lib/i18n/messages/en.ts", "../lib/i18n/messages/zh-CN.ts", "../lib/i18n/messages/zh-TW.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /"chat\.jumpToLatest": "(.+)",/, `${file} must define chat.jumpToLatest`);
  }
});
