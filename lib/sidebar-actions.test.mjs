import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { enLocale } from "./i18n/messages/en.ts";
import { zhCNLocale } from "./i18n/messages/zh-CN.ts";
import { zhTWLocale } from "./i18n/messages/zh-TW.ts";

// Through jiti: the module imports values of other modules without extensions.
const jiti = createJiti(import.meta.url);
const { forkFailureMessage, projectNameMenuEntries, projectRenameRequest, sessionMenuEntries } = await jiti.import("./sidebar-actions.ts");

const idle = { running: false, unread: false, selected: false, transient: false };

function actions(entries) {
  return entries.map((entry) => entry.kind === "separator" ? "-" : `${entry.id}:${entry.shortcut}${entry.disabledReason ? ` (${entry.disabledReason})` : ""}`);
}

test("a group row offers pin, rename, fork, unread, archive, new tab and delete", () => {
  assert.deepEqual(actions(sessionMenuEntries("group", idle)), ["pin:P", "rename:R", "fork:F", "mark-unread:U", "archive:A", "open-new-tab:T", "-", "delete:D"]);
  assert.deepEqual(
    actions(sessionMenuEntries("pinned", { ...idle, unread: true })),
    ["unpin:P", "rename:R", "fork:F", "mark-read:U", "archive:A", "open-new-tab:T", "-", "delete:D"],
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

test("an archived row offers unarchive, pin (which restores it), rename, fork, new tab and delete", () => {
  assert.deepEqual(actions(sessionMenuEntries("archive", idle)), ["unarchive:A", "pin:P", "rename:R", "fork:F", "open-new-tab:T", "-", "delete:D"]);
});

test("every saved session opens in a new tab, enabled, just before Delete and never first; a transient one cannot", () => {
  for (const context of ["group", "pinned", "archive"]) {
    for (const status of [idle, { ...idle, running: true }, { ...idle, running: true, awaiting: true }, { ...idle, unread: true }, { ...idle, selected: true }]) {
      const entries = sessionMenuEntries(context, status);
      const label = `${context} ${JSON.stringify(status)}`;
      // A menu's first item takes focus when it opens: Enter must not leave the tab.
      assert.notEqual(entries[0].id, "open-new-tab", label);
      assert.deepEqual(entries.slice(-3), [
        { kind: "action", id: "open-new-tab", shortcut: "T" },
        { kind: "separator" },
        { kind: "action", id: "delete", shortcut: "D" },
      ], label);
      assert.equal(entries.filter((entry) => entry.id === "open-new-tab").length, 1, label);
    }
    // In the group and pinned views it follows Archive (disabled or not).
    if (context !== "archive") {
      for (const running of [false, true]) {
        const entries = sessionMenuEntries(context, { ...idle, running });
        assert.equal(entries[entries.length - 4].id, "archive");
      }
    }
    const ids = sessionMenuEntries(context, { ...idle, transient: true }).map((entry) => entry.id);
    assert.ok(!ids.includes("open-new-tab"));
  }
  for (const locale of [enLocale, zhCNLocale, zhTWLocale]) {
    assert.equal(typeof locale.messages["sidebar.openInNewTab"], "string", `${locale.id} has the label`);
  }
  assert.equal(enLocale.messages["sidebar.openInNewTab"], "Open in new tab");
  assert.equal(zhCNLocale.messages["sidebar.openInNewTab"], "在新标签页打开");
  assert.equal(zhTWLocale.messages["sidebar.openInNewTab"], "在新分頁開啟");
});

test("a transient session offers nothing that needs its file", () => {
  for (const context of ["group", "pinned", "archive"]) {
    assert.deepEqual(sessionMenuEntries(context, { ...idle, transient: true }), []);
  }
});

test("shortcuts are unique within a menu", () => {
  for (const context of ["group", "pinned", "archive"]) {
    for (const status of [idle, { ...idle, running: true }, { ...idle, unread: true }]) {
      const shortcuts = sessionMenuEntries(context, status).filter((entry) => entry.kind === "action").map((entry) => entry.shortcut);
      assert.equal(new Set(shortcuts).size, shortcuts.length);
    }
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

test("a group menu offers Rename… always and Reset name only while the project has a name of its own", () => {
  assert.deepEqual(projectNameMenuEntries({ customName: null }), ["rename-project"]);
  assert.deepEqual(projectNameMenuEntries({ customName: "Thermal Models" }), ["rename-project", "reset-project-name"]);
  for (const key of ["sidebar.renameProject", "sidebar.resetProjectName", "sidebar.projectName"]) {
    assert.equal(typeof enLocale.messages[key], "string", `${key} is translated`);
  }
});

test("a project rename saves a trimmed name, and empty or the folder's own name clears it", () => {
  const plain = { key: "/work/thermal-key", root: "/work/sim/thermal", name: "thermal", customName: null };
  const named = { ...plain, name: "Thermal Models", customName: "Thermal Models" };
  // The field starts with the name shown: left as it is, nothing is saved.
  assert.equal(projectRenameRequest(plain, "thermal"), null);
  assert.equal(projectRenameRequest(named, "  Thermal Models "), null);
  // Saved by projectKey, trimmed; Unicode and markup are text like any other.
  assert.deepEqual(projectRenameRequest(plain, "  热模型 <b>v2</b> "), { action: "rename-project", projectKey: "/work/thermal-key", name: "热模型 <b>v2</b>" });
  assert.deepEqual(projectRenameRequest(named, "Thermal"), { action: "rename-project", projectKey: "/work/thermal-key", name: "Thermal" });
  // Empty or the folder name: back to the folder name, which an unnamed project shows already.
  for (const value of ["", "   ", "thermal", " thermal "]) {
    assert.deepEqual(projectRenameRequest(named, value), { action: "rename-project", projectKey: "/work/thermal-key", name: null }, JSON.stringify(value));
  }
  assert.equal(projectRenameRequest(plain, ""), null);
  assert.equal(projectRenameRequest(plain, "  "), null);
  // Windows roots: the folder name is the last segment either way.
  assert.equal(projectRenameRequest({ ...plain, root: "C:\\work\\sim\\thermal\\" }, "thermal"), null);
  // A name too long for the server goes out as typed: the server refuses it and the sidebar says so.
  const long = "x".repeat(81);
  assert.deepEqual(projectRenameRequest(plain, long), { action: "rename-project", projectKey: "/work/thermal-key", name: long });
});
