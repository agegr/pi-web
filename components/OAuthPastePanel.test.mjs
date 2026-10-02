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
const { OAuthPastePanel, oauthPasteKeySubmits } = await jiti.import("./OAuthPastePanel.tsx");
const modelsSource = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");

function render(props) {
  return renderToStaticMarkup(React.createElement(OAuthPastePanel, {
    message: "Paste the redirected address below.",
    placeholder: "http://localhost:1455/auth/callback?code=…",
    submitLabel: "Submit",
    onValueChange() {},
    onSubmit() {},
    ...props,
  }));
}

test("the paste box is always shown, with the submit button off until there is a value", () => {
  const empty = render({ value: "  " });
  assert.match(empty, /<p class="oauth-paste-message">Paste the redirected address below\.<\/p>/);
  assert.match(empty, /<input class="oauth-paste-input" placeholder="http:\/\/localhost:1455\/auth\/callback\?code=…" value="  "\/>/);
  assert.match(empty, /<button type="button" class="oauth-paste-submit" disabled="">Submit<\/button>/);
  assert.doesNotMatch(empty, /oauth-paste-hint/);

  const filled = render({ value: "http://localhost:1455/auth/callback?code=abc" });
  assert.match(filled, /<button type="button" class="oauth-paste-submit">Submit<\/button>/);
});

test("the hint line carries the caller's link to the sign-in page", () => {
  const html = render({
    value: "",
    hint: React.createElement("a", { href: "https://example.test/authorize" }, "open the login page"),
  });
  assert.match(html, /<p class="oauth-paste-hint"><a href="https:\/\/example\.test\/authorize">open the login page<\/a><\/p>/);
});

test("the Models subscription sign-in uses the shared paste panel", () => {
  const oauthDetail = modelsSource.slice(
    modelsSource.indexOf("function OAuthDetail"),
    modelsSource.indexOf("// ── API Key detail"),
  );
  assert.match(oauthDetail, /<OAuthPastePanel[\s\S]*?inputRef=\{inputRef\}[\s\S]*?onSubmit=\{\(\) => void submitCode\(loginState\.token, inputValue\)\}/);
  assert.doesNotMatch(oauthDetail, /<input\b/);
});

test("the box can carry an accessible name, and waits with its button while a value is checked", () => {
  const named = render({ value: "http://x/?code=1", inputLabel: "Address the browser landed on" });
  assert.match(named, /<input class="oauth-paste-input" placeholder="[^"]*" aria-label="Address the browser landed on" value="http:\/\/x\/\?code=1"\/>/);
  const waiting = render({ value: "http://x/?code=1", disabled: true });
  assert.match(waiting, /<input class="oauth-paste-input" placeholder="[^"]*" disabled="" value="http:\/\/x\/\?code=1"\/>/);
  assert.match(waiting, /<button type="button" class="oauth-paste-submit" disabled="">Submit<\/button>/);
});

test("Enter submits, never while an input method composes; without plainEnterSubmits only Cmd/Ctrl+Enter does", () => {
  const key = (overrides = {}) => ({ key: "Enter", metaKey: false, ctrlKey: false, isComposing: false, keyCode: 13, ...overrides });
  assert.equal(oauthPasteKeySubmits(key(), true), true);
  assert.equal(oauthPasteKeySubmits(key(), false), false);
  assert.equal(oauthPasteKeySubmits(key({ metaKey: true }), false), true);
  assert.equal(oauthPasteKeySubmits(key({ ctrlKey: true }), false), true);
  // An Enter that commits an input method's text (zh-CN / zh-TW) submits nothing, whichever flag tells.
  for (const plain of [true, false]) {
    assert.equal(oauthPasteKeySubmits(key({ isComposing: true, metaKey: true }), plain), false);
    assert.equal(oauthPasteKeySubmits(key({ keyCode: 229, ctrlKey: true }), plain), false);
  }
  assert.equal(oauthPasteKeySubmits(key({ key: "a", metaKey: true }), true), false);
  // The Models subscription box keeps plain Enter.
  assert.doesNotMatch(modelsSource, /plainEnterSubmits/);
});
