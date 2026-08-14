import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const trust = await readFile(new URL("./ProjectTrustDialog.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./SettingsPage.tsx", import.meta.url), "utf8");
const models = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./CodexSidebar.tsx", import.meta.url), "utf8");

test("risk dialogs use the shared confirmation shell", () => {
  assert.match(trust, /<DialogShell[\s\S]*?size="confirm"/);
  assert.match(settings, /<DialogShell[\s\S]*?size="confirm"/);
  assert.match(models, /<DialogShell[\s\S]*?size="confirm"/);
});

test("sidebar replaces native confirmations with styled dialogs", () => {
  assert.doesNotMatch(sidebar, /window\.confirm/);
  assert.match(sidebar, /pendingConfirmation/);
  assert.match(sidebar, /<DialogShell[\s\S]*?size="confirm"/);
});

test("busy trust confirmation cannot be dismissed or repeated", () => {
  assert.match(trust, /dismissible=\{!busy\}/);
  assert.match(trust, /disabled=\{busy\}/);
});

test("destructive confirmations reject backdrop dismissal", () => {
  assert.match(settings, /size="confirm"[\s\S]*?backdropDismissible=\{false\}/);
  assert.match(models, /size="confirm"[\s\S]*?backdropDismissible=\{false\}/);
  assert.match(sidebar, /size="confirm"[\s\S]*?backdropDismissible=\{false\}/);
});

test("async destructive worktree removal stays visible and disabled while pending", () => {
  assert.match(sidebar, /pendingConfirmation[\s\S]*?dismissible=\{!worktreeBusy\}/);
  assert.match(sidebar, /disabled=\{worktreeBusy\}/);
  assert.match(sidebar, /removeWorktree\(path, true\)/);
});

test("session deletion is an immediate async row action with inline error", () => {
  assert.match(sidebar, /const \[deleting, setDeleting\] = useState\(false\)/);
  assert.match(sidebar, /const \[deleteError, setDeleteError\] = useState<string \| null>\(null\)/);
  assert.match(sidebar, /ref=\{menuButtonRef\}/);
  assert.match(sidebar, /role="alert" className="codex-row-error"/);
});

test("destructive actions use the shared danger button", () => {
  assert.match(settings, /className="codex-dialog-button" data-variant="danger"/);
  assert.match(models, /className="codex-dialog-button" data-variant="danger"/);
  assert.match(sidebar, /className="codex-dialog-button" data-variant="danger"/);
});
