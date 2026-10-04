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
const { McpSignInRow } = await jiti.import("./McpSignIn.tsx");
const { enLocale } = await jiti.import("@/lib/i18n/messages/en.ts");
const source = await readFile(new URL("./McpSignIn.tsx", import.meta.url), "utf8");
const mcpConfigSource = await readFile(new URL("./McpConfig.tsx", import.meta.url), "utf8");

const h = React.createElement;
const messages = enLocale.messages;

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function text(html) {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const oauth = {
  name: "docs",
  scope: "global",
  sourcePath: "/Users/me/.pi/agent/mcp.json",
  configKey: "key",
  enabled: true,
  validated: true,
  transport: "http",
  url: "https://docs.example/mcp",
  envNames: [],
  headerNames: [],
  usesOAuth: true,
  signedIn: false,
  commandFields: [],
  variableReferences: [],
  masked: false,
};

const PAGE = "https://auth.example/authorize?client_id=pi&state=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2Fcallback";
const flow = (phase, extra = {}) => ({ flowId: "f1", scope: "global", name: "docs", configKey: "key", phase, expiresInMs: 200_000, ...extra });

function row(props = {}) {
  return decode(renderToStaticMarkup(h(I18nProvider, null, h(McpSignInRow, {
    server: oauth,
    run: undefined,
    block: undefined,
    signOutBlock: undefined,
    controlsBusy: false,
    signingOut: false,
    onSignIn() {},
    onSignOut() {},
    onPaste() {},
    onCancel() {},
    ...props,
  }))));
}

/** The buttons of the row: their attributes and labels. */
function buttons(html) {
  return [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attributes, label]) => ({ attributes, label }));
}

test("a server with its own Authorization header says so, with nothing to press", () => {
  const html = row({ server: { ...oauth, usesOAuth: false } });
  assert.equal(text(html), "Sign-in Authorization header");
  assert.deepEqual(buttons(html), []);
});

test("an OAuth server offers Sign in, says what it does and, once something is stored, that it may replace it, and Sign out", () => {
  const out = row();
  assert.deepEqual(buttons(out).map((button) => button.label), ["Sign in"]);
  assert.match(text(out), /^Sign-in Not signed in\./);
  // Nothing stored for the URL: nothing to replace, and nothing to sign out of.
  assert.doesNotMatch(text(out), /may replace|Sign out deletes/);

  const signedIn = row({ server: { ...oauth, signedIn: true } });
  assert.deepEqual(buttons(signedIn).map((button) => button.label), ["Sign in", "Sign out"]);
  assert.match(text(signedIn), /^Sign-in Signed in\./);
  assert.match(text(signedIn), /Signing in may replace what is stored for this server\./);
  assert.match(text(signedIn), /Sign out deletes what is stored for this server; open sessions lose access at their next request\./);
  // An unreadable mcp-auth.json still offers Sign out.
  assert.deepEqual(buttons(row({ server: { ...oauth, signedIn: undefined } })).map((button) => button.label), ["Sign in", "Sign out"]);
  // A cancelled or expired sign-in leaves a client registration and its PKCE state but no tokens:
  // Sign out still clears them, as `pi mcp logout` would.
  const leftover = row({ server: { ...oauth, signedIn: false, oauthStateStored: true } });
  assert.deepEqual(buttons(leftover).map((button) => button.label), ["Sign in", "Sign out"]);
  assert.match(text(leftover), /^Sign-in Not signed in, but a client registration or an unfinished sign-in is stored for this server\./);
  assert.deepEqual(buttons(row({ server: { ...oauth, signedIn: false, oauthStateStored: false } })).map((button) => button.label), ["Sign in"]);
  // While a change runs, Sign out waits; Sign in, which writes no mcp.json, does not.
  const busy = buttons(row({ server: { ...oauth, signedIn: true }, controlsBusy: true }));
  assert.doesNotMatch(busy[0].attributes, /disabled/);
  assert.match(busy[1].attributes, /disabled=""/);
  assert.equal(buttons(row({ server: { ...oauth, signedIn: true }, controlsBusy: true, signingOut: true }))[1].label, "Signing out…");
  // A Sign out on its way would cancel a sign-in that reached the server first, so Sign in waits for it.
  assert.match(buttons(row({ server: { ...oauth, signedIn: true }, controlsBusy: true, signingOut: true }))[0].attributes, /disabled=""/);
});

test("a blocked sign-in is disabled and points at the visible reason", () => {
  const html = row({ server: { ...oauth, signedIn: true }, block: "project-untrusted", signOutBlock: "project-untrusted" });
  const [signIn, signOut] = buttons(html);
  for (const button of [signIn, signOut]) {
    assert.match(button.attributes, /disabled=""/);
    const id = button.attributes.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(id, button.label);
    assert.match(html, new RegExp(`<span id="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" class="mcp-config-line is-dim">This project is not trusted, so Pi Web does not sign in to or out of its servers\\.</span>`));
  }
  assert.doesNotMatch(text(html), /may replace|Sign out deletes/, "no explanation of what cannot be done");
  // A PI_WEB_PASSWORD entry cannot sign in, but its tokens can still go.
  const password = buttons(row({ server: { ...oauth, signedIn: true }, block: "web-password" }));
  assert.match(password[0].attributes, /disabled=""/);
  assert.doesNotMatch(password[1].attributes, /disabled/);
});

test("a sign-in under way says what it does, and offers Cancel instead", () => {
  const connecting = row({ run: { flow: flow("connecting") } });
  assert.match(connecting, /<span role="status" class="mcp-config-line">Checking whether the server asks for a sign-in…<\/span>/);
  assert.deepEqual(buttons(connecting).map((button) => button.label), ["Cancel sign-in"]);
  assert.match(row({ run: { flow: flow("starting") } }), /Preparing the sign-in with the server's authorization server…/);
  const finishing = row({ run: { flow: flow("finishing") } });
  assert.match(finishing, /Finishing the sign-in…/);
  assert.match(buttons(finishing)[0].attributes, /disabled=""/, "the code is on its way: nothing left to cancel");
  // Why it cannot be cancelled is a visible line the disabled button points at.
  const noCancel = buttons(finishing)[0].attributes.match(/aria-describedby="([^"]+)"/)?.[1];
  assert.ok(noCancel);
  assert.match(finishing, new RegExp(`<span id="${noCancel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" class="mcp-config-line is-dim">The authorization server has answered, so this step can no longer be cancelled\\.</span>`));
  assert.doesNotMatch(buttons(connecting)[0].attributes, /aria-describedby/);
  assert.doesNotMatch(text(connecting), /can no longer be cancelled/);
  assert.equal(buttons(row({ run: { flow: flow("connecting"), cancelling: true } }))[0].label, "Cancelling…");
  // No Sign out while one runs.
  assert.deepEqual(buttons(row({ server: { ...oauth, signedIn: true }, run: { flow: flow("connecting") } })).map((button) => button.label), ["Cancel sign-in"]);
  // The other file's entry of the same name and URL started it: the row says whose it is.
  assert.match(text(row({ run: { flow: flow("connecting", { scope: "project" }) } })), /The other docs entry, with the same URL, started this sign-in: the tokens serve both\./);
});

test("waiting for the browser shows the page as a link, the paste box, and where the browser goes back to", () => {
  const html = row({ run: { flow: flow("authorize", { authorizationUrl: PAGE, redirectUrl: "http://127.0.0.1:53682/callback" }) } });
  assert.match(html, /<p class="oauth-paste-message">Open the sign-in page and approve access\./);
  assert.match(html, new RegExp(`<p class="oauth-paste-hint">Sign-in page: <a href="${PAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" target="_blank" rel="noopener noreferrer">`));
  // The box is never focused by itself, has a name, and submits only a value.
  assert.match(html, /<input class="oauth-paste-input" placeholder="http:\/\/127\.0\.0\.1:…\/callback\?code=…" aria-label="Address the browser landed on" value=""\/>/);
  assert.match(html, /<button type="button" class="oauth-paste-submit" disabled="">Continue<\/button>/);
  assert.match(text(html), /After you approve, the browser is sent to http:\/\/127\.0\.0\.1:53682\/callback, which only the computer running Pi Web can open\./);
  assert.match(text(html), /Pi Web waits up to 5 minutes from the start of the sign-in\./);
  assert.deepEqual(buttons(html).map((button) => button.label), ["Continue", "Cancel sign-in"]);

  // A page that is not an http(s) address is shown as text, never as a link.
  const odd = row({ run: { flow: flow("authorize", { authorizationUrl: "javascript:alert(1)" }) } });
  assert.doesNotMatch(odd, /<a /);
  assert.match(text(odd), /The server's sign-in page is not a web address, so it is shown as text only: javascript:alert\(1\)/);

  // A refused paste says why in the panel's words, and the box stays.
  const refused = row({ run: { flow: flow("authorize", { authorizationUrl: PAGE }), pasteError: { error: "x", reason: "redirect-state-mismatch" } } });
  assert.match(refused, /<span role="alert" class="mcp-config-line is-error">That address does not finish this sign-in: That address belongs to another sign-in\./);
  assert.match(refused, /class="oauth-paste-input"/);
  const denied = row({ run: { flow: flow("authorize", { authorizationUrl: PAGE }), pasteError: { error: "The user said no", reason: "redirect-denied" } } });
  assert.match(text(denied), /The authorization server did not grant access\. Open the sign-in page again, or cancel\. The user said no/);
  // While a paste is checked, the box and its button wait.
  const pasting = row({ run: { flow: flow("authorize", { authorizationUrl: PAGE }), pasting: true } });
  assert.match(pasting, /<input class="oauth-paste-input"[^>]*disabled=""/);
  assert.match(pasting, /<button type="button" class="oauth-paste-submit" disabled="">Checking…<\/button>/);
});

test("how the sign-in ended stays under the row, with Sign in again", () => {
  const result = (state, extra = {}) => ({ state, tools: [], toolCount: 1, durationMs: 4, testedAt: 1, afterSignIn: true, ...extra });
  assert.match(text(row({ run: { flow: flow("done", { result: result("connected") }) } })), /Signed in\. Connection above shows what the server offers\./);
  assert.match(text(row({ run: { flow: flow("done", { alreadySignedIn: true, result: result("connected") }) } })), /Already signed in: the server connected without a new sign-in\./);
  assert.match(text(row({ run: { flow: flow("done", { refreshed: true, result: result("connected") }) } })), /Signed in again with the stored refresh token, without the browser\./);
  const after = row({ run: { flow: flow("done", { result: result("failed", { error: "ECONNRESET" }) }) } });
  assert.match(after, /<span role="status" class="mcp-config-line is-warning">Signed in, but the server did not connect afterwards\. Connection above says why\.<\/span>/);
  const failed = row({ run: { flow: flow("failed", { failure: "sign-in-failed", error: "registration failed: •••" }) } });
  assert.match(failed, /<span role="status" class="mcp-config-line is-error">The sign-in failed\.<\/span><span class="mcp-config-line is-error">Error: <code class="mcp-config-chip">registration failed: •••<\/code><\/span>/);
  assert.match(text(row({ run: { flow: flow("expired") } })), /The sign-in was not finished within 5 minutes, so Pi Web stopped waiting\./);
  assert.match(text(row({ run: { flow: flow("cancelled") } })), /Sign-in cancelled\./);
  assert.deepEqual(buttons(row({ run: { flow: flow("cancelled") } })).map((button) => button.label), ["Sign in"]);
  // A flow the server forgot, and requests that failed, each say so.
  assert.match(text(row({ run: { flow: flow("authorize"), gone: true } })), /Pi Web no longer knows this sign-in: it ended a while ago, or Pi Web restarted\. Press Sign in to start again\./);
  assert.match(text(row({ run: { error: { error: "x", reason: "sign-in-not-oauth" } } })), /Could not sign in: This server does not sign in with OAuth: only an HTTP server without an Authorization header does\./);
  assert.match(text(row({ run: { error: { error: "x", reason: "project-untrusted" } } })), /Could not sign in: This project is not trusted, so Pi Web does not sign in to or out of its servers\./);
  assert.match(text(row({ run: { error: { error: "x", reason: "unparsable" } } })), /Could not sign in: Pi Web cannot read this entry from its file anymore\. Press Refresh\./);
  assert.match(text(row({ run: { error: { error: "GET timed out", timedOut: true } } })), /Pi Web did not answer in time\. Press Sign in again to see the sign-in under way\./);
  assert.match(text(row({ server: { ...oauth, signedIn: true }, run: { signOutError: { error: "x", timedOut: true } } })), /Could not sign out: Pi Web did not answer in time, so the change may not have been made\./);
  assert.match(text(row({ run: { signedOut: { removed: true } } })), /Signed out: the tokens stored for this server were deleted\./);
  assert.match(text(row({ run: { signedOut: { removed: false } } })), /Nothing was stored for this server, so there was nothing to sign out of\./);
});

test("a sign-in joined from the other entry of the name and URL ends naming that entry, not this one's Connection row", () => {
  const result = { state: "connected", tools: [], toolCount: 1, durationMs: 4, testedAt: 1, afterSignIn: true };
  const done = text(row({ run: { flow: flow("done", { scope: "project", result }) } }));
  assert.match(done, /Signed in through the other docs entry, which has the same URL, so the tokens serve this entry too\. Press Test connection to see what this entry's server offers\./);
  assert.doesNotMatch(done, /Connection above/);
  assert.match(text(row({ run: { flow: flow("done", { scope: "project", alreadySignedIn: true, result }) } })), /The other docs entry, which has the same URL, was already signed in/);
  const failed = text(row({ run: { flow: flow("failed", { scope: "project", failure: "connect-failed", result: { ...result, state: "failed" } }) } }));
  assert.match(failed, /The sign-in through the other docs entry, which has the same URL, found nothing to sign in to: that entry's server did not connect, and did not ask for a sign-in\. Its Connection row says why\./);
  // The entry that started it keeps its own words.
  assert.match(text(row({ run: { flow: flow("done", { result }) } })), /Signed in\. Connection above shows what the server offers\./);
});

test("a failed cancel is shown while the sign-in runs, and not once it has ended", () => {
  const cancelError = { error: "DELETE timed out", timedOut: true };
  assert.match(text(row({ run: { flow: flow("authorize", { authorizationUrl: PAGE }), cancelError } })), /Could not cancel the sign-in: Pi Web did not answer in time\. The sign-in may still be under way/);
  const ended = text(row({ run: { flow: flow("done", { result: { state: "connected", tools: [], toolCount: 1, durationMs: 4, testedAt: 1 } }), cancelError } }));
  assert.match(ended, /Signed in\./);
  assert.doesNotMatch(ended, /Could not cancel/);
  assert.doesNotMatch(text(row({ run: { flow: flow("authorize"), gone: true, cancelError } })), /Could not cancel/);
});

test("the row's words come from the locale files, and nothing hides in a tooltip or takes focus by itself", () => {
  const keys = [...source.matchAll(/t\("([^"]+)"/g)].map((match) => match[1]);
  assert.ok(keys.length >= 20);
  for (const key of keys) assert.equal(typeof messages[key], "string", `${key} is missing from en.ts`);
  assert.doesNotMatch(source, />\s*[A-Z][a-z]+(?: [a-z]+){2,}[.:]?\s*</);
  assert.doesNotMatch(source, /\btitle=/);
  assert.doesNotMatch(source, /autoFocus|\.focus\(\)/);
  assert.doesNotMatch(source, /style=\{/);
  // Focus moves only from the page itself, to the button that replaced the one pressed.
  assert.match(source, /if \(!wasActive && active\) focusIfLost\(document, cancelRef\.current\);/);
  assert.match(source, /else if \(wasActive && !active\) focusIfLost\(document, signInRef\.current\);/);
  assert.match(source, /if \(wasPasting && !pasting\) focusIfLost\(document, inputRef\.current\);/);
  // The paste box submits from its button or Cmd/Ctrl+Enter, never a plain Enter.
  assert.match(source, /<OAuthPastePanel[\s\S]*?plainEnterSubmits=\{false\}[\s\S]*?\/>/);
  // The panel's Sign-in row is this one, and the needs-sign-in words above it never send the user to a chat command.
  assert.match(mcpConfigSource, /<McpSignInRow\n\s*server=\{server\}/);
  for (const key of ["mcp.test.summary.needs-auth", "mcp.session.summary.needs-auth"]) {
    assert.equal(typeof messages[key], "string", key);
    assert.doesNotMatch(messages[key], /\/mcp/, key);
  }
});
