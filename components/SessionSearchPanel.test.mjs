import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelSource = await readFile(new URL("./SessionSearchPanel.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const routeSource = await readFile(
  new URL("../app/api/sessions/search/route.ts", import.meta.url),
  "utf8",
);
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const globalsCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const highlightSource = await readFile(new URL("../lib/text-highlight.ts", import.meta.url), "utf8");

test("panel debounces conversation search and cancels superseded requests", () => {
  assert.match(panelSource, /SEARCH_DEBOUNCE_MS/);
  assert.match(panelSource, /new AbortController\(\)/);
  assert.match(panelSource, /fetch\(`\/api\/sessions\/search\?\$\{params\.toString\(\)\}`, \{ signal: controller\.signal \}\)/);
  assert.match(panelSource, /clearTimeout\(timer\);\s*\n\s*controller\.abort\(\);/);
  assert.match(panelSource, /trimmed\.length < MIN_QUERY_LENGTH/);
});

test("panel exposes project scope and tool-output toggles", () => {
  assert.match(panelSource, /const roles = useMemo\(/);
  assert.match(panelSource, /: "user,assistant"\),/);
  assert.match(panelSource, /toolCall,toolResult,bash,summary/);
  assert.match(panelSource, /params\.set\("projectKey", effectiveProjectKey\)/);
  assert.match(panelSource, /sidebar\.searchIncludeTools/);
  assert.match(panelSource, /sidebar\.searchScopeAll/);
});

test("panel renders highlighted snippets, status, and errors", () => {
  assert.match(panelSource, /<mark/);
  assert.match(panelSource, /role="status"/);
  assert.match(panelSource, /role="alert"/);
  assert.match(panelSource, /sidebar\.noMatchingSessions/);
  assert.match(panelSource, /sidebar\.searchTruncated/);
});

test("sidebar toggles the search panel in place of the session list", () => {
  assert.match(sidebarSource, /const \[sessionSearchOpen, setSessionSearchOpen\] = useState\(false\)/);
  assert.match(sidebarSource, /sessionSearchOpen \? \(\s*\n\s*<SessionSearchPanel/);
  assert.match(sidebarSource, /onSelectResult=\{handleSelectSearchResult\}/);
  assert.match(sidebarSource, /event\.key\.toLowerCase\(\) !== "f"/);
});

test("sidebar opens results from other projects through the normal select path", () => {
  assert.match(sidebarSource, /const known = allSessions\.find\(\(session\) => session\.id === result\.sessionId\)/);
  assert.match(sidebarSource, /handleSelectSessionFromList\(known \?\?/);
});

test("search route delegates to the bounded searcher and maps bad regex to 400", () => {
  assert.match(routeSource, /parseSessionSearchQuery\(req\.nextUrl\.searchParams\)/);
  assert.match(routeSource, /searchSessionContents\(\{ \.\.\.query, signal: req\.signal \}\)/);
  assert.match(routeSource, /error instanceof SyntaxError/);
  assert.match(routeSource, /status: 400/);
  assert.match(routeSource, /"Cache-Control": "no-store"/);
});

test("each snippet opens the session at its own message", () => {
  assert.match(panelSource, /onSelectResult: \(result: SessionSearchResult, jump: ChatJumpTarget\) => void/);
  assert.match(panelSource, /onClick=\{\(\) => openResult\(result, hit\.entryId\)\}/);
  assert.match(panelSource, /sidebar\.searchJumpToMessage/);
  // Snippets are buttons inside the result container, not nested in one button.
  assert.doesNotMatch(panelSource, /<button[\s\S]{0,400}<HitRow/);
});

test("the panel carries its own query into the jump so the chat highlights it", () => {
  assert.match(panelSource, /const target = entryId \?\? result\.hits\[0\]\?\.entryId/);
  assert.match(panelSource, /return \{ entryId: target, query: trimmed, mode: "substring", caseSensitive: false \}/);
  assert.match(sidebarSource, /onSelectSession\(s, false, jumpTarget\)/);
});

test("chat loads the window containing the target, then scrolls and flashes it", () => {
  assert.match(chatWindowSource, /if \(!entryIds\.includes\(targetEntryId\)\)/);
  assert.match(chatWindowSource, /loadContext\(sid, activeLeafId, null, targetEntryId\)/);
  assert.match(chatWindowSource, /if \(jumpRequestedRef\.current === targetEntryId\) return/);
  assert.match(chatWindowSource, /findRowIndexForEntry\(messages\.map\(\(m\) => m\.role\), entryIds, targetEntryId\)/);
  assert.match(chatWindowSource, /classList\.add\("entry-jump-flash"\)/);
  assert.match(chatWindowSource, /onTargetEntryHandled\?\.\(targetEntryId, true\)/);
  // The render window grows after messages load, so the effect must re-run on it.
  assert.match(chatWindowSource, /visibleCount, session, activeLeafId,/);
  assert.match(chatWindowSource, /data-entry-id=\{entryIds\[idx\]\}/);
});

test("chat highlights the query in the matched message and scrolls to the keyword", () => {
  assert.match(chatWindowSource, /applyTextHighlight\(\s*element,\s*buildMatcher\(jumpTarget\.query, jumpTarget\.mode \?\? "substring", jumpTarget\.caseSensitive \?\? false\),/);
  assert.match(chatWindowSource, /const scrollTarget = matches\[0\]\?\.startContainer\.parentElement \?\? element/);
  assert.match(chatWindowSource, /scrollTarget\.scrollIntoView\(\{ block: "center" \}\)/);
  // A stale or invalid regex target must not break the jump itself.
  assert.match(chatWindowSource, /\} catch \{[\s\S]{0,160}matches = \[\];/);
  // Cleared on the next jump and on unmount, not on a timer like the flash.
  assert.match(chatWindowSource, /clearFlash\(\);\s+clearTextHighlight\(\);/);
  // The rule is injected at runtime and self-contained: the build CSS parser
  // rejects the pseudo-element, and a var() that fails to resolve through the
  // highlight inheritance chain would silently drop the background.
  assert.match(highlightSource, /::highlight\(\$\{name\}\)/);
  assert.match(highlightSource, /color: #111827/);
  assert.doesNotMatch(globalsCss, /^::highlight\(/m);
  assert.doesNotMatch(globalsCss, /--search-highlight/);
});

test("app shell keeps the jump target across a same-session click and clears it after", () => {
  assert.match(appShellSource, /setPendingJump\(jumpTarget \?\? null\);[\s\S]{0,800}selectedSession\.id === session\.id/);
  assert.match(appShellSource, /jumpTarget=\{pendingJump\}/);
  assert.match(appShellSource, /onTargetEntryHandled=\{handleTargetEntryHandled\}/);
});

test("the jump flash respects reduced motion", () => {
  assert.match(globalsCss, /\.entry-jump-flash/);
  assert.match(globalsCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}entry-jump-flash/);
});
