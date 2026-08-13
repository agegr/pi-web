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

test("destructive actions use the shared danger button", () => {
  assert.match(settings, /className="codex-dialog-button" data-variant="danger"/);
  assert.match(models, /className="codex-dialog-button" data-variant="danger"/);
  assert.match(sidebar, /className="codex-dialog-button" data-variant="danger"/);
});
