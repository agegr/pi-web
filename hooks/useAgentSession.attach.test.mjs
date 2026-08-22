import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hookSource = () => readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("opening a saved session starts in reviewing, a fresh one is already attached", async () => {
  const source = await hookSource();

  assert.match(
    source,
    /useState<AttachState>\(isNew \? "attached" : "reviewing"\)/,
  );
  // A previous session's claim must not leak into the next one.
  assert.match(source, /attachStateRef\.current = next;[\s\S]{0,200}\}, \[session\?\.id, isNew\]\)/);
});

test("promoting a new session keeps its claim instead of dropping to reviewing", async () => {
  const source = await hookSource();

  // Creating a session attaches it; the sidebar promotion then arrives as an
  // id change, which must not swap the editor for the review button mid-run.
  assert.match(source, /attachedSessionIdRef\.current = realId;\s*attachStateRef\.current = "attached"/);
  assert.match(
    source,
    /const stillHeld = session\?\.id !== undefined && attachedSessionIdRef\.current === session\.id/,
  );
  assert.match(source, /const next: AttachState = isNew \|\| stillHeld \? "attached" : "reviewing"/);
});

test("the hook never attaches on mount", async () => {
  const source = await hookSource();
  const mount = source.slice(source.indexOf("// Load session on mount"));

  // Browsing a transcript must not touch the working directory.
  assert.doesNotMatch(mount.slice(0, 1200), /attach\(\)/);
});

test("attach reports resume failures and conflicts separately", async () => {
  const source = await hookSource();
  const attach = source.slice(
    source.indexOf("const attach = useCallback"),
    source.indexOf("const detach = useCallback"),
  );

  assert.match(attach, /method: "POST"/);
  assert.match(attach, /if \(body\.conflict\) setAttachConflict\(body\.conflict\)/);
  assert.match(attach, /else setAttachError/);
  // A slow checkout must not resurrect state for a session left behind.
  assert.match(attach, /if \(sessionIdRef\.current !== sid\) return false/);
  // Extensions only exist once attached.
  assert.match(attach, /void loadTools\(sid\)/);
  assert.match(attach, /void loadSlashCommands\(\)/);
});

test("sending attaches first and restores the draft when it cannot", async () => {
  const source = await hookSource();
  const send = source.slice(source.indexOf("const handleSend = useCallback"));

  assert.match(
    send.slice(0, 700),
    /if \(!isNew && attachStateRef\.current !== "attached" && !\(await attach\(\)\)\) \{\s*restoreSubmission/,
  );
});

test("a state response never overrides an attach in flight", async () => {
  const source = await hookSource();

  assert.match(source, /if \(attachStateRef\.current !== "attaching"\) \{/);
});

test("the reviewing composer replaces the editor and focuses it after attaching", async () => {
  const chatWindow = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");

  assert.match(chatWindow, /attachState !== "attached" \? \(\s*<ReviewingComposer/);
  assert.match(chatWindow, /if \(attached\) requestAnimationFrame\(\(\) => chatInputRef\?\.current\?\.focus\(\)\)/);

  const composer = await readFile(new URL("../components/ReviewingComposer.tsx", import.meta.url), "utf8");
  // A real button is reachable with Tab and activates with Enter or Space.
  assert.match(composer, /<button\s+type="button"/);
  assert.match(composer, /disabled=\{attaching\}/);
  assert.match(composer, /role="alert"/);
});
