import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ModelsConfigNavigator.tsx", import.meta.url), "utf8");

test("navigator rows are native buttons with a labelled selected state", () => {
  assert.match(source, /<button\b[\s\S]*?models-settings-row/);
  assert.match(source, /data-selected=\{/);
  // No div-based rows with inline hover mutation.
  assert.doesNotMatch(source, /onMouseEnter/);
});

test("search has a visible label and a clear button when non-empty", () => {
  assert.match(source, /aria-label=\{t\("models\.searchPlaceholder"\)\}/);
  assert.match(source, /\{query && \(/);
  assert.match(source, /aria-label=\{t\("i18n\.clearSearch"\)\}/);
});

test("renders labelled Accounts and Custom providers groups", () => {
  assert.match(source, /role="group"/);
  assert.match(source, /aria-label=\{t\("models\.accounts"\)\}/);
  assert.match(source, /aria-label=\{t\("models\.customProviders"\)\}/);
});

test("provider disclosure exposes aria-expanded and aria-controls", () => {
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /aria-controls=\{`models-provider-models-\$\{provider\.name\}`\}/);
});

test("connection status is text, not color alone", () => {
  assert.match(source, /t\("i18n\.connected"\)/);
  assert.match(source, /t\("i18n\.notConnected"\)/);
});

test("footer holds one add-provider command and empty state offers recovery", () => {
  assert.match(source, /models-settings-add-provider[\s\S]*?t\("i18n\.addProvider"\)/);
  assert.match(source, /t\("models\.noMatches"\)[\s\S]*?onClick=\{onAddProvider\}/);
});

test("navigator stays controlled: no fetch or config mutation inside", () => {
  assert.doesNotMatch(source, /fetch\(/);
  assert.doesNotMatch(source, /useState/);
});

test("model rows are native buttons and keep the new-model placeholder", () => {
  assert.match(source, /models-settings-model-row/);
  assert.match(source, /t\("i18n\.newModel"\)/);
});

test("model selection uses the original index, not the filtered array index", () => {
  assert.match(source, /onSelect\(\{ type: "model", providerName: provider\.name, index: model\.index \}\)/);
  assert.match(source, /selection\.index === model\.index/);
});

test("accounts retry and config retry are separate actions", () => {
  assert.match(source, /onClick=\{onRetryAccounts\}/);
  assert.match(source, /onClick=\{onRetryConfig\}/);
});
