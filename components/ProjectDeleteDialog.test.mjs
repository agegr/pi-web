// The sidebar's delete-project flow: the type-to-confirm rule, the counts the
// dialog states, and how a route refusal becomes a message. The dialog's own
// markup is rendered through react-dom/server, so a missing string or a
// disabled Delete button is a failing assertion rather than a screenshot.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n.tsx");
const { ProjectDeleteDialogView } = await jiti.import("./ProjectDeleteDialog.tsx");
const { confirmationMatches, deleteProject, projectDisplayName } = await jiti.import("./project-delete-helpers.ts");
const { projectDeleteCounts } = await jiti.import("@/lib/project-groups.ts");

const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const dialogSource = await readFile(new URL("./ProjectDeleteDialog.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");

function session(overrides) {
  return {
    path: `/agent/sessions/--repo--/${overrides.id}.jsonl`,
    id: overrides.id,
    cwd: "/repo",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: overrides.id,
    projectRoot: "/repo",
    projectKey: "/repo",
    ...overrides,
  };
}

function render(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

test("the confirmation name is the dropdown's last path segment, and it must match exactly", () => {
  assert.equal(projectDisplayName("/Users/demo/code/pi-web"), "pi-web");
  assert.equal(projectDisplayName("/Users/demo/code/pi-web/"), "pi-web");
  // A Windows project root uses backslashes; the label is still the last segment.
  assert.equal(projectDisplayName("C:\\Users\\demo\\pi-web"), "pi-web");

  assert.equal(confirmationMatches("pi-web", "/Users/demo/code/pi-web"), true);
  assert.equal(confirmationMatches("pi-we", "/Users/demo/code/pi-web"), false);
  assert.equal(confirmationMatches("PI-WEB", "/Users/demo/code/pi-web"), false);
  assert.equal(confirmationMatches(" pi-web", "/Users/demo/code/pi-web"), false);
  assert.equal(confirmationMatches("pi-web/", "/Users/demo/code/pi-web"), false);
  // A root has a name too (its last segment), so it can still be confirmed.
  assert.equal(projectDisplayName("/"), "");
  assert.equal(confirmationMatches("", "/"), false);
});

test("the counts name the sessions and the directories the server will remove", () => {
  const sessions = [
    session({ id: "a" }),
    session({ id: "b" }),
    session({ id: "c", cwd: "/repo-worktrees/feature" }),
    session({ id: "d", cwd: "/other", projectRoot: "/other", projectKey: "/other" }),
    // A transient session has no file yet, so it is not something to delete.
    session({ id: "e", transient: true, path: "" }),
  ];
  assert.deepEqual(projectDeleteCounts(sessions, "/repo"), { sessions: 3, directories: 2 });
  assert.deepEqual(projectDeleteCounts(sessions, "/other"), { sessions: 1, directories: 1 });
  assert.deepEqual(projectDeleteCounts(sessions, "/missing"), { sessions: 0, directories: 0 });
});

test("a refusal is read as its reason, a busy project names its running sessions, and a network failure still answers", async () => {
  const calls = [];
  const fakeFetch = async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ error: "busy", reason: "session-busy", runningSessionTitles: ["A run", "B run"] }), { status: 409 });
  };
  assert.deepEqual(await deleteProject("/repo", fakeFetch), {
    ok: false,
    reason: "session-busy",
    runningSessionTitles: ["A run", "B run"],
    error: "busy",
  });
  assert.equal(calls[0].input, "/api/projects/delete");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { projectKey: "/repo" });

  const ok = await deleteProject("/repo", async () => new Response(
    JSON.stringify({ deletedSessions: 4, removedDirs: 2, failures: [{ path: "/x", error: "nope" }] }),
    { status: 200 },
  ));
  // The paths, so the dialog can name what is still on disk.
  assert.deepEqual(ok, { ok: true, deletedSessions: 4, removedDirs: 2, failedPaths: ["/x"] });

  const clean = await deleteProject("/repo", async () => new Response(
    JSON.stringify({ deletedSessions: 2, removedDirs: 1 }),
    { status: 200 },
  ));
  assert.deepEqual(clean.failedPaths, [], "a clean delete reports nothing left behind");

  const thrown = await deleteProject("/repo", async () => { throw new Error("offline"); });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.runningSessionTitles.length, 0);
  assert.equal(thrown.error, "offline");

  const garbage = await deleteProject("/repo", async () => new Response("not json", { status: 500 }));
  assert.equal(garbage.ok, false);
  assert.equal(garbage.error, "HTTP 500");
});

test("the dialog states what goes, holds Delete until the name matches, and offers only Cancel and Delete", () => {
  const html = render(React.createElement(ProjectDeleteDialogView, {
    projectRoot: "/repo",
    projectKey: "/repo",
    // One worktree of the same project, as a git project's sessions are split.
    sessions: [session({ id: "a" }), session({ id: "b", cwd: "/repo-worktrees/feature" })],
    onCancel() {},
    onDeleted() {},
  }));
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  assert.match(text, /Delete project repo/);
  assert.match(text, /2 sessions in 2 directories/);
  assert.match(text, /Type repo to confirm/);
  // The full path is shown, so two projects named "repo" are tellable apart.
  assert.match(html, /project-delete-path[^>]*>[\s\S]*?\/repo/);
  // Nothing is typed yet, so the destructive button is disabled.
  assert.match(html, /<button[^>]*disabled[^>]*>Delete permanently<\/button>/);
  assert.match(html, /aria-modal="true"/);
  // The dialog's own rules live in settings.css, next to the trust dialog's.
  assert.match(cssSource, /\.project-delete-dialog \{/);
  assert.match(cssSource, /\.project-delete-button\.is-danger \{/);
});

test("the dialog owns its Esc handling and the sidebar keeps the destructive action out of the toolbar", () => {
  // Esc closes the dialog (and is taken in the capture phase, so nothing below
  // reacts to it); a delete already running is not cancelled by it.
  assert.match(dialogSource, /openStackedDialog\(document, dialogRef\.current, \(\) => \{/);
  assert.match(dialogSource, /if \(!busyRef\.current\) onCancelRef\.current\(\);/);
  // On success the workspace memory is forgotten and the list refreshed; the
  // dialog closes either way.
  assert.match(sidebarSource, /clearLastOpen\(deleteProject\.key\)/);
  assert.match(sidebarSource, /void loadSessions\(true, true\)/);
  // The project is named by its key, and captured from the loaded list when the
  // dialog opens — deriving it live would unmount the dialog on the refresh the
  // delete itself triggers.
  assert.match(sidebarSource, /const startDeleteProject = useCallback\(\(project: RecentProject\) => \{/);
  assert.match(sidebarSource, /sessionIds: sessionsForProject\(allSessions, project\.key\)/);
  assert.match(sidebarSource, /t\("sidebar\.deleteProject"\)/);
  // The dialog goes through a portal: the sidebar is a transformed, clipped
  // container, so a fixed overlay inside it would be positioned against it.
  assert.match(dialogSource, /return createPortal\(<ProjectDeleteDialogView \{\.\.\.props\} \/>, document\.body\)/);
  // A wrong reason gets its own copy: a symlink refusal needs a different
  // action from the user than a network failure.
  assert.match(dialogSource, /failure\.reason === "symlink"\) return t\("sidebar\.deleteProjectSymlink"\)/);
  // A partly failed delete reports the leftovers and closes only on request.
  assert.match(dialogSource, /t\("sidebar\.deleteProjectPartial", \{ sessions: partial\.deletedSessions \}\)/);
  assert.match(dialogSource, /t\("sidebar\.deleteProjectLeftovers", \{ paths: partial\.failedPaths\.join\(", "\) \}\)/);
  assert.match(dialogSource, /const settled = partial !== null;/);
  // The footer's buttons are gone when the report appears, so focus is moved to
  // the one that is left instead of falling to the page behind the modal.
  assert.match(dialogSource, /if \(partial\) closeButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  // A synchronous guard, so two triggers in one React batch post once.
  assert.match(dialogSource, /if \(deletingRef\.current \|\| !canDelete\) return;/);
  // The AppShell is told which sessions went, so an open pane is dropped.
  assert.match(sidebarSource, /for \(const sessionId of deleteProject\.sessionIds\) onSessionDeleted\?\.\(sessionId\)/);
});
