import assert from "node:assert/strict";
import test from "node:test";
import { enLocale } from "./i18n/messages/en.ts";
import { forkFailureMessage, sessionMenuEntries } from "./sidebar-actions.ts";

const idle = { running: false, unread: false, selected: false, transient: false };

function actions(entries) {
  return entries.map((entry) => entry.kind === "separator" ? "-" : `${entry.id}:${entry.shortcut}${entry.disabledReason ? ` (${entry.disabledReason})` : ""}`);
}

test("a group row offers pin, rename, fork, unread, archive and delete", () => {
  assert.deepEqual(actions(sessionMenuEntries("group", idle)), ["pin:P", "rename:R", "fork:F", "mark-unread:U", "archive:A", "-", "delete:D"]);
  assert.deepEqual(
    actions(sessionMenuEntries("pinned", { ...idle, unread: true })),
    ["unpin:P", "rename:R", "fork:F", "mark-read:U", "archive:A", "-", "delete:D"],
  );
});

test("a running family cannot be archived yet, but can be forked", () => {
  for (const context of ["group", "pinned"]) {
    const entries = actions(sessionMenuEntries(context, { ...idle, running: true }));
    assert.ok(entries.includes("archive:A (running)"));
    // Fork copies the finished entries and leaves the run alone.
    assert.ok(entries.includes("fork:F"));
    assert.ok(entries.includes("delete:D"));
  }
});

test("an archived row offers unarchive, pin (which restores it), rename, fork and delete", () => {
  assert.deepEqual(actions(sessionMenuEntries("archive", idle)), ["unarchive:A", "pin:P", "rename:R", "fork:F", "-", "delete:D"]);
});

test("a transient session offers nothing that needs its file", () => {
  for (const context of ["group", "pinned", "archive"]) {
    assert.deepEqual(sessionMenuEntries(context, { ...idle, transient: true }), []);
  }
});

test("shortcuts are unique within a menu", () => {
  for (const context of ["group", "pinned", "archive"]) {
    const shortcuts = sessionMenuEntries(context, idle).filter((entry) => entry.kind === "action").map((entry) => entry.shortcut);
    assert.equal(new Set(shortcuts).size, shortcuts.length);
  }
});

test("a refused fork names the reason in the user's language, anything else shows the error", () => {
  assert.deepEqual(forkFailureMessage("not_found", "Session not found"), { key: "sidebar.forkNotFound" });
  assert.deepEqual(forkFailureMessage("unsaved", "x"), { key: "sidebar.forkUnsaved" });
  assert.deepEqual(forkFailureMessage("empty", "x"), { key: "sidebar.forkEmpty" });
  assert.deepEqual(forkFailureMessage("subagent", "x"), { key: "sidebar.forkUnavailable" });
  assert.deepEqual(forkFailureMessage("request-denied", "x"), { key: "sidebar.forkUnavailable" });
  assert.deepEqual(forkFailureMessage("failed", "EACCES"), { key: "sidebar.forkFailed", params: { error: "EACCES" } });
  assert.deepEqual(forkFailureMessage(undefined, "HTTP 502"), { key: "sidebar.forkFailed", params: { error: "HTTP 502" } });
  for (const code of ["not_found", "unsaved", "empty", "subagent", "failed"]) {
    const { key, params } = forkFailureMessage(code, "x");
    assert.equal(typeof enLocale.messages[key], "string", `${key} is translated`);
    if (params) assert.match(enLocale.messages[key], /\{error\}/);
  }
});
