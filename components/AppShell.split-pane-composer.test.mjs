import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script } from "node:vm";
import { createJiti } from "jiti";
import ts from "typescript";

// pi#33: "Edit from here" lost the composer on desktop split view.
//
// Root cause (reproduced by the tests below, which fail on pre-fix code):
// AppShell created ONE shared chatInputRef and passed it only to the classic
// ChatWindow; the split renderPane panes rendered ChatWindow with NO
// chatInputRef, so ChatInput mounted with ref={undefined} and the imperative
// handle never existed in split view. ChatWindow.handleEditContent
// (chatInputRef?.current?.replaceMessage) was therefore a silent no-op:
// the branch navigation happened, but the historical message was never
// restored — the composer ended up EMPTY after the click in the empty-before
// case, and a non-empty draft got no feedback at all (the silent skip users
// read as "the click ate my input"). Mobile classic was immune because its
// ChatWindow received the shared ref.
//
// No additional clearing writer exists for the has-text case: draftKey is
// session?.id (stable across in-session navigate_tree), panes render with
// stable key={sessionId} (no remount), and the composer is not conditionally
// rendered — the missing pane handle is the sole mechanism.

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const messageView = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");

// Extract the renderPane callback slice (same technique as
// AppShell.split-pane-stats.test.mjs).
const renderPaneStart = source.indexOf("renderPane={(sid, focused) => {");
assert.ok(renderPaneStart >= 0, "AppShell must define a split renderPane");
const renderPaneEnd = source.indexOf(") : showChat ? (", renderPaneStart);
assert.ok(renderPaneEnd > renderPaneStart, "the split branch must be followed by the classic ChatWindow");
const renderPane = source.slice(renderPaneStart, renderPaneEnd);

const sentinelStart = renderPane.indexOf("if (isNewSessionTab(sid)) {");
assert.ok(sentinelStart >= 0, "renderPane must have a sentinel (new-session tab) branch");
const sentinel = renderPane.slice(sentinelStart, renderPane.indexOf("const paneSession", sentinelStart));
const sessionPane = renderPane.slice(renderPane.indexOf("const paneSession", sentinelStart));

// Execute a real useCallback body extracted from AppShell.tsx by name
// (same technique as ChatInput.test.mjs's handleKeyDown extraction).
function extractAppShellCallback(name) {
  const ast = ts.createSourceFile("AppShell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let node = null;
  function find(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name) {
      node = n;
      return;
    }
    ts.forEachChild(n, find);
  }
  find(ast);
  assert.ok(node, `AppShell must define ${name}`);
  return node.initializer.arguments[0].getText(ast);
}

function runExtracted(callbackText, sandbox) {
  return new Script(ts.transpileModule(`(${callbackText})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText).runInNewContext(sandbox);
}

test("split panes receive their own imperative composer handle (reproduction: fails pre-fix)", () => {
  // The session pane must forward a per-pane handle so handleEditContent's
  // replaceMessage addresses the composer of the pane the click happened in.
  assert.match(
    sessionPane,
    /chatInputRef=\{getPaneChatInputRef\(sid\)\}/,
    "the session pane must receive its own pane-scoped chatInputRef",
  );
  // The sentinel new-session pane keeps the same guarantees (draft keying,
  // replaceMessage, addImages) as the classic new-session composer.
  assert.match(
    sentinel,
    /chatInputRef=\{getPaneChatInputRef\(NEW_SESSION_TAB_ID\)\}/,
    "the sentinel new-session pane must receive a pane-scoped chatInputRef",
  );
});

test("the classic layout keeps the shared handle (mobile regression pin)", () => {
  assert.match(source, /chatInputRef=\{chatInputRef\}/);
});

test("ChatWindow forwards the pane handle to ChatInput and the edit-from-here click", () => {
  // ChatWindow must keep forwarding its (now pane-scoped) chatInputRef into
  // ChatInput's imperative handle, and handleEditContent must keep routing
  // "Edit from here" through it — the click sequence only needs the ref to
  // actually reach a mounted composer.
  assert.match(chatWindow, /ref=\{chatInputRef\}/);
  assert.match(chatWindow, /chatInputRef\?\.current\?\.replaceMessage\(message\)/);
  assert.match(chatInput, /replaceMessage\(message: UserMessage\) \{/);
});

test("AppShell imperative callers address the focused pane's composer only", () => {
  const paneRefs = () => ({ current: new Map([
    ["pane-a", { current: { id: "a" } }],
    ["pane-b", { current: { id: "b" } }],
  ]) });
  const resolveWith = (env) => runExtracted(extractAppShellCallback("resolveChatInputHandle"), {
    paneChatInputRefsRef: paneRefs(),
    chatInputRef: { current: { id: "classic" } },
    splitPaneEnabled: env.splitPaneEnabled,
    isMobile: env.isMobile,
    focusedPaneId: env.focusedPaneId,
  })();

  // Split view: the focused pane's composer is the target...
  assert.equal(resolveWith({ splitPaneEnabled: true, isMobile: false, focusedPaneId: "pane-a" }).id, "a");
  assert.equal(resolveWith({ splitPaneEnabled: true, isMobile: false, focusedPaneId: "pane-b" }).id, "b");
  // ...and an insert can never leak into the other pane.
  assert.notEqual(resolveWith({ splitPaneEnabled: true, isMobile: false, focusedPaneId: "pane-a" }).id, "b");
  // Classic layout / mobile: the shared handle is the target.
  assert.equal(resolveWith({ splitPaneEnabled: false, isMobile: false, focusedPaneId: "pane-a" }).id, "classic");
  assert.equal(resolveWith({ splitPaneEnabled: true, isMobile: true, focusedPaneId: "pane-a" }).id, "classic");
  // No focused pane in split view: the resolver falls back to the shared
  // handle, which is unmounted (null) while the split layout is active.
  assert.equal(resolveWith({ splitPaneEnabled: true, isMobile: false, focusedPaneId: null }).id, "classic");

  // Every AppShell-level imperative caller routes through the resolver, so
  // @-mentions/file-line mentions insert into the focused pane's composer.
  for (const handler of ["handleAtMention", "handleAtMentions", "handleFileLineMention"]) {
    const body = extractAppShellCallback(handler);
    assert.match(body, /resolveChatInputHandle\(\)\?\.\s*insertText/, `${handler} must resolve the focused pane's handle`);
    assert.ok(!body.includes("chatInputRef.current"), `${handler} must not bypass the pane resolver`);
  }
});

test("getPaneChatInputRef returns one stable ref per pane and never shares across panes", () => {
  const refs = { current: new Map() };
  const get = runExtracted(extractAppShellCallback("getPaneChatInputRef"), {
    paneChatInputRefsRef: refs,
  });

  const a1 = get("pane-a");
  const a2 = get("pane-a");
  const b = get("pane-b");
  assert.equal(a1, a2, "the same pane must always get the same ref object");
  assert.notEqual(a1, b, "distinct panes must never share a composer handle");
  assert.equal(a1.current, null, "a fresh pane ref starts empty until ChatInput mounts");
  assert.equal(refs.current.get("pane-a"), a1);
});

test("closing a pane releases its composer-handle registry entry", () => {
  const closePaneStart = source.indexOf("onClosePane={(sid) => {");
  assert.ok(closePaneStart >= 0, "AppShell must define onClosePane");
  const closePane = source.slice(closePaneStart, source.indexOf("renderPane={(sid, focused)", closePaneStart));
  assert.match(closePane, /releasePaneChatInputRef\(sid\);/, "pane close must release the pane's handle entry");

  // The paneTabs hygiene effect sweeps the remaining removal paths: the
  // sentinel superseded by a session selection, and the sentinel adopted by
  // a created session (handleSessionCreated replaces the tab id in place).
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*\n\s*const open = new Set\(paneTabs\.map\(\(tab\) => tab\.sessionId\)\);\s*\n\s*for \(const paneId of paneChatInputRefsRef\.current\.keys\(\)\) \{\s*\n\s*if \(!open\.has\(paneId\)\) paneChatInputRefsRef\.current\.delete\(paneId\);\s*\n\s*\}\s*\n\s*\}, \[paneTabs\]\);/,
    "a pane id with no open tab must not keep a stale composer handle",
  );
});

test("editTarget provenance can never carry empty text into replaceMessage", async () => {
  const { skillExpansionToCommand } = await jiti.import("@/lib/slash-display.ts");

  // Plain text and non-skill input never produce a command form...
  assert.equal(skillExpansionToCommand("just a normal message"), null);
  assert.equal(skillExpansionToCommand(""), null);
  // ...and a recognized skill expansion always restores a non-empty command.
  const expansion = '<skill name="review" location="/skills/review/SKILL.md">\nReferences are relative to /repo.\n\nbody\n</skill>\n\nsrc/main.ts';
  const command = skillExpansionToCommand(expansion);
  assert.ok(command && command.trim(), "a restored skill command must never be empty text");
  assert.equal(command, "/skill:review src/main.ts");

  // MessageView only swaps the message for the command form when the command
  // text is truthy — an empty restore can never reach replaceMessage.
  assert.match(
    messageView,
    /const editTarget = commandText \? replaceUserMessageText\(message, commandText\) : message;/,
  );
});

test("the draft survives the navigate sequence: no writer re-keys or remounts the composer on branch navigation", () => {
  // draftKey is session?.id and navigate_tree stays within one session id:
  // the re-key effect (which swaps the composer value for getDraft(nextKey))
  // cannot fire on in-session branch navigation.
  assert.match(chatWindow, /draftKey=\{session\?\.id \?\? newSessionDraftKey \?\? undefined\}/);
  assert.match(
    chatInput,
    /const previousDraftKey = draftKeyRef\.current;\s*\n\s*if \(previousDraftKey === draftKey\) return;/,
    "the re-key writer must remain a no-op while the draft key is unchanged",
  );
  // Failed navigation (handleNavigate false) never reaches the composer:
  // ChatWindow keeps routing through handleNavigate, and MessageView gates
  // the restore on the navigated flag.
  assert.match(chatWindow, /onNavigate=\{sessionBusy \? undefined : handleNavigate\}/);
  assert.match(
    messageView,
    /void onNavigate!\(entryId!\)\.then\(\(navigated\) => \{\s*\n\s*if \(navigated\) onEditContent\?\.\(editTarget\);/,
  );
});
