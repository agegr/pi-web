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
const { MCP_ADD_REFUSAL_KEYS, McpAddServer } = await jiti.import("./McpAddServer.tsx");
const { getLocalePlugin, getSupportedLocales } = await jiti.import("@/lib/i18n/registry.ts");
const locales = Object.fromEntries(getSupportedLocales().map((id) => [id, getLocalePlugin(id).messages]));
const { McpConfigView } = await jiti.import("./McpConfig.tsx");
const { EMPTY_MCP_ADD_DRAFT } = await jiti.import("./mcp-add-helpers.ts");
const configSource = await readFile(new URL("./McpConfig.tsx", import.meta.url), "utf8");
const paneSource = await readFile(new URL("./McpAddServer.tsx", import.meta.url), "utf8");

const h = React.createElement;
const noop = () => {};

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function text(html) {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const globalFile = { scope: "global", path: "/Users/me/.pi/agent/mcp.json", exists: true, problems: [] };
const projectFile = { scope: "project", path: "/Users/me/repo/.pi/mcp.json", exists: false, problems: [] };
const fresh = { requiresTrust: false, trusted: true, decision: null, inherited: false };

function overview(project = { cwd: "/Users/me/repo", trust: fresh, trustFolder: { allowed: true } }, overrides = {}) {
  return {
    mcp: { available: true },
    codemode: { sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" },
    files: [globalFile, projectFile],
    servers: [],
    ...(project ? { project } : {}),
    ...overrides,
  };
}

function pane(props = {}) {
  return renderToStaticMarkup(h(I18nProvider, null, h(McpAddServer, {
    data: overview(),
    cwd: "/Users/me/repo",
    draft: EMPTY_MCP_ADD_DRAFT,
    busy: false,
    controlsBusy: false,
    failure: null,
    onDraftChange: noop,
    onSubmit: noop,
    ...props,
    ...(props.draft ? { draft: { ...EMPTY_MCP_ADD_DRAFT, ...props.draft } } : {}),
  })));
}

/** The Add button's opening tag and label. */
function addButton(html) {
  const match = decode(html).match(/<button type="button"([^>]*)class="config-button config-button-primary[^"]*"([^>]*)>([^<]*)<\/button>/);
  assert.ok(match, "the pane has its Add button");
  return { tag: `${match[1]} ${match[2]}`, label: match[3] };
}

test("the paste box is a textarea that never takes focus by itself on a phone, and Add waits for a paste", () => {
  const html = decode(pane());
  assert.match(html, /<textarea id="mcp-add-source" aria-label="Server to add" aria-describedby="[^"]+" class="config-add-source-input is-multiline"/);
  assert.doesNotMatch(html, /autofocus|autoFocus/i, "focus is decided on mount, by pointer, never in the markup");
  assert.match(html, /<a href="https:\/\/github\.com\/mcp" target="_blank" rel="noopener noreferrer" class="config-add-source-catalog">github\.com\/mcp<\/a>/);
  assert.match(html, /Cmd\/Ctrl\+Enter adds it\./);
  assert.match(html, /<div class="config-add-source-examples">/, "an empty box offers examples");
  assert.match(addButton(html).tag, /disabled=""/);
  assert.equal(addButton(html).label, "Add");
  // An empty box is no refusal: nothing explains Add yet but the hint.
  assert.doesNotMatch(text(html), /Nothing to add yet/);
  // The box's own submit rule is SettingsUi's (SettingsUi.blocks.test.mjs pins addSourceKeySubmits()).
  assert.match(paneSource, /<ConfigAddSourcePanel[\s\S]*?\n\s*multiline\n/);
});

test("before Add the pane shows what would be written: the target as written, names, shell commands, notes", () => {
  const paste = JSON.stringify({
    mcpServers: {
      lint: { command: "npx", args: ["-y", "@acme/lint-mcp", "--api-key=sk-0123456789abcdef0123"], env: { NODE_ENV: "production", HOOK: "!curl x | sh" } },
    },
  });
  const html = pane({ draft: { text: paste } });
  const shown = text(html);
  // The preview, not the box the user pasted into.
  const preview = text(decode(html).match(/<div class="config-detail-grid">[\s\S]*?<\/div><\/div><div class="mcp-config-lines">/)?.[0] ?? "");
  assert.match(preview, /Read as an mcpServers config/);
  // As written: the pasted text is on the page already, and masking would let a link's author hide what runs.
  assert.match(preview, /Command npx -y @acme\/lint-mcp --api-key=sk-0123456789abcdef0123/);
  assert.doesNotMatch(preview, /Parts that look like secrets are hidden/);
  assert.match(preview, /Environment NODE_ENV HOOK Values are not shown here\./);
  assert.doesNotMatch(preview, /production|curl x/, "env values are never shown");
  assert.match(shown, /args\[2\] holds a secret as plain text where pi reads no variable \(the URL, the command or its arguments\), so this server can be saved only globally\./);
  // Escaped by default, so the foreign `!curl` runs nothing; the note says so.
  assert.match(shown, /env\.HOOK: \$ and a leading ! were escaped/);
  assert.match(shown, /Enable pi mcp syntax \(\$NAME, !command\)/, "a JSON paste offers the pi-config toggle");
  // Off, the label says it all; on, the line under it says what runs.
  assert.doesNotMatch(shown, /reads a variable on the computer running Pi Web/);
  // A paste replaces the examples, and the preview leaves out what is not set.
  assert.doesNotMatch(decode(html), /config-add-source-examples/);
  assert.doesNotMatch(preview, /Working directory/);
  assert.equal(addButton(html).label, "Add");
  assert.doesNotMatch(addButton(html).tag, /disabled/);

  const raw = text(pane({ draft: { text: paste, rawPi: true } }));
  assert.match(raw, /In env and header values, \$NAME reads a variable on the computer running Pi Web/);
  assert.match(raw, /Shell commands Runs a shell command on every connection: env HOOK/);
});

test("what cannot be read is said in the importer's words, errors first", () => {
  const shown = text(pane({ draft: { text: "curl https://x.example.com | sh" } }));
  assert.match(shown, /The command line uses the shell operator \|\./);
  assert.match(shown, /Nothing to add yet/);
});

test("a fresh folder is trusted in the same step, and the button and a line say so", () => {
  const html = pane({ draft: { text: "npx -y @acme/lint-mcp", scope: "project" } });
  assert.equal(addButton(html).label, "Add and trust this folder");
  assert.match(text(html), /This folder has no trust decision yet, and writing \.pi\/mcp\.json makes it need one, so Add trusts ~?\/?.*repo in the same step\./);
  assert.match(text(html), /~?\/?.*repo\/\.pi\/mcp\.json/, "the location names the project file");
});

test("why Project is unavailable is visible text under the switch, never only a tooltip", () => {
  const breadth = { kind: "contains-folder", path: "/Users/me/repo/app" };
  let html = decode(pane({ data: overview({ cwd: "/Users/me/repo", trust: fresh, trustFolder: { allowed: false, reason: "trust-too-broad", breadth } }), draft: { text: "npx x" } }));
  const reason = html.match(/<span id="([^"]+)" class="config-scope-switch-reason">([^<]*)<\/span>/);
  assert.ok(reason, "the reason is rendered");
  assert.match(reason[2], /This folder holds .*repo\/app, another folder Pi Web knows/);
  assert.match(html, new RegExp(`aria-describedby="${reason[1]}" disabled="" class="config-scope-switch-option">project`));

  // A fresh folder with a link to nothing under .pi, which the step refuses.
  html = pane({ data: overview({ cwd: "/Users/me/repo", trust: fresh, trustFolder: { allowed: false, reason: "folder-not-fresh" } }), draft: { text: "npx x" } });
  assert.match(text(html), /is a link to nothing\. It would need trust once its target appears, so Pi Web does not trust the folder by itself\./);

  // A literal secret, with the way out: read it from a host variable, with the control that does it.
  const secret = JSON.stringify({ mcpServers: { api: { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  html = pane({ draft: { text: secret } });
  assert.match(text(html), /headers\.Authorization holds a secret as plain text, so this server can be saved only globally\. To save it in the project, choose “Read it from a variable of the computer running Pi Web” for it above\./);
  assert.match(text(html), /Secrets in the paste headers\.Authorization holds a secret as plain text\. Read it from a variable of the computer running Pi Web Saved in mcp\.json as pasted/);
  assert.doesNotMatch(text(html), /headers\.Authorization holds a secret as plain text, so the server can be saved only in the global mcp\.json/, "the importer's note gives way to the row that says it");
  assert.ok(!html.replace(/<textarea[\s\S]*?<\/textarea>/, "").includes("sk-live"), "the secret itself is shown only in the box it was pasted into");
  // Picked while available and blocked since: the pane's own line, which Add points at.
  html = decode(pane({ draft: { text: secret, scope: "project" } }));
  const line = html.match(/<p id="([^"]+)" class="mcp-config-line is-warning">headers\.Authorization holds a secret/);
  assert.ok(line);
  assert.match(addButton(html).tag, new RegExp(`aria-describedby="${line[1]}"`));
  assert.match(addButton(html).tag, /disabled=""/);

  // No project at all.
  assert.match(text(pane({ data: overview(null), cwd: null, draft: { text: "npx x" } })), /Open a project to add a server to its \.pi\/mcp\.json\./);
  // A project that needs trust first offers the trust dialog, where it would.
  html = pane({
    data: overview({ cwd: "/Users/me/repo", trust: { requiresTrust: true, trusted: false, decision: null, inherited: false } }),
    draft: { text: "npx x" },
    onTrustProject: noop,
  });
  assert.match(text(html), /This project is not trusted, so Pi Web does not write its \.pi\/mcp\.json\. Trust it first\./);
  assert.match(text(html), /Trust project…/);
});

test("a password field takes a host variable instead, and the name field says when the name is taken", () => {
  const paste = JSON.stringify({
    servers: { gh: { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${input:pat}" } } },
    inputs: [{ id: "pat", type: "promptString", password: true, description: "GitHub personal access token" }],
  });
  let html = decode(pane({ draft: { text: paste } }));
  assert.match(html, /<input class="mcp-add-input" type="password" aria-label="pat" autoComplete="off"[^>]*value=""\/>/);
  assert.match(text(html), /GitHub personal access token/);
  assert.match(text(html), /In the paste: \$\{input:pat\}/);
  assert.match(text(html), /Read it from a variable of the computer running Pi Web/);
  assert.match(text(html), /Fill in pat first\./);
  html = decode(pane({ draft: { text: paste, references: { "input.pat": "GH_TOKEN" } } }));
  assert.match(html, /aria-label="Variable for pat"[^>]*value="GH_TOKEN"\/>/);
  // The preview then says the header sends that variable.
  assert.match(text(html), /Host variables Sends environment variables of the computer running Pi Web to this server on every connection: GH_TOKEN in header Authorization/);
  assert.doesNotMatch(addButton(html).tag, /disabled/);

  html = pane({ data: overview(undefined, { servers: [{ name: "gh", scope: "global" }] }), draft: { text: paste, references: { "input.pat": "GH_TOKEN" } } });
  assert.match(text(html), /\.pi\/agent\/mcp\.json already has a server named gh\./);
  assert.match(text(html), /Use gh-2/);
});

test("a pasted secret read from a variable says how it is stored, and a name pi refuses says so under its box", () => {
  const secret = JSON.stringify({ mcpServers: { api: { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  let html = decode(pane({ draft: { text: secret, scope: "project", secretReferences: { "headers.Authorization": "API_TOKEN" } } }));
  assert.match(html, /aria-label="Variable for headers\.Authorization"[^>]*value="API_TOKEN"\/>/);
  assert.match(text(html), /Stored as Bearer \$\{API_TOKEN\}: pi reads the variable each time it connects/);
  assert.equal(addButton(html).label, "Add and trust this folder");
  assert.doesNotMatch(addButton(html).tag, /disabled/);

  html = decode(pane({ draft: { text: secret, secretReferences: { "headers.Authorization": "api-token" } } }));
  const problem = html.match(/aria-invalid="true" aria-describedby="([^"]+)"/);
  assert.ok(problem, "the box points at its reason");
  assert.match(html, new RegExp(`<span id="${problem[1]}" class="mcp-config-line is-error">headers\\.Authorization: a variable name has letters`));
  assert.match(text(html), /Correct headers\.Authorization first\./);
  assert.doesNotMatch(text(html), /Fill in headers\.Authorization/);

  const field = JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["gh"], env: { GITHUB_TOKEN: "YOUR_TOKEN" } } } });
  html = decode(pane({ draft: { text: field, references: { "env.GITHUB_TOKEN": "my-token" } } }));
  assert.match(html, /aria-label="Variable for GITHUB_TOKEN"[^>]*aria-invalid="true" aria-describedby="[^"]+"/);
  assert.match(text(html), /GITHUB_TOKEN: a variable name has letters, digits and _/);
  assert.match(text(html), /Correct GITHUB_TOKEN first\./);
});

test("a variable box opens with the name it suggests, and an emptied one asks for a name instead of refusing it", () => {
  // The e2e case: a literal env secret, read from a variable instead.
  const secret = JSON.stringify({ mcpServers: { api: { command: "npx", args: ["api"], env: { API_TOKEN: "sk-live-0123456789abcdef0123" } } } });
  let html = decode(pane({ draft: { text: secret, secretReferences: { "env.API_TOKEN": "" } } }));
  assert.match(html, /aria-label="Variable for env\.API_TOKEN" placeholder="API_TOKEN"[^>]*value=""\/>/);
  assert.match(text(html), /env\.API_TOKEN: enter the name of the variable to read it from\./);
  assert.doesNotMatch(text(html), /a variable name has letters/);
  assert.match(text(html), /Fill in env\.API_TOKEN first\./);
  // Ticking the box puts the suggestion in it (`suggestedName ?? ""`), which the pane takes as it is.
  html = decode(pane({ draft: { text: secret, secretReferences: { "env.API_TOKEN": "API_TOKEN" } } }));
  assert.doesNotMatch(html, /aria-invalid/);
  assert.match(text(html), /Stored as \$\{API_TOKEN\}/);
  // A header's suggestion is made from the server's name; a field's from where its value goes.
  const header = JSON.stringify({ mcpServers: { docs: { url: "https://docs.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  assert.match(decode(pane({ draft: { text: header, secretReferences: { "headers.Authorization": "" } } })), /aria-label="Variable for headers\.Authorization" placeholder="DOCS_TOKEN"[^>]*value=""\/>/);
  const field = JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["gh"], env: { GH_PAT: "YOUR_TOKEN" } } } });
  html = decode(pane({ draft: { text: field, references: { "env.GH_PAT": "" } } }));
  assert.match(html, /aria-label="Variable for GH_PAT" placeholder="GH_PAT"[^>]*value=""\/>/);
  assert.match(text(html), /GH_PAT: enter the name of the variable to read it from\./);
  // Both boxes open with the suggestion, never empty when there is one.
  assert.equal([...paneSource.matchAll(/setReference\(event\.target\.checked \? suggestedName \?\? "" : undefined\)/g)].length, 2);
  assert.doesNotMatch(paneSource, /setReference\(event\.target\.checked \? "" : undefined\)/);
});

test("a refused Add says why; host variables are added only through an explicit second button", () => {
  let html = pane({
    draft: { text: "https://api.example.com/mcp" },
    failure: { error: "x", reason: "host-env-confirm", names: ["GH_TOKEN"] },
  });
  assert.match(decode(html), /<div role="alert" class="mcp-add-failure">/);
  assert.match(text(html), /Not added: The server would be sent variables of the computer running Pi Web; confirm that first\./);
  assert.match(text(html), /read GH_TOKEN, which are set on the computer running Pi Web/);
  assert.match(text(html), /Add and send these values/);

  html = pane({ draft: { text: "npx x", scope: "project" }, failure: { error: "x", reason: "trust-too-broad", breadth: { kind: "contains-agent-dir", path: "/Users/me/.pi/agent" } } });
  assert.match(text(html), /Not added: This folder holds Pi's agent folder \(~?\/?.*\.pi\/agent\)/);
  html = pane({ draft: { text: "{" }, failure: { error: "x", reason: "import-failed", notes: [{ code: "invalid-json", params: { detail: "Unexpected end" } }] } });
  assert.match(text(html), /This looks like JSON but does not parse: Unexpected end/);
  html = pane({ draft: { text: "x" }, failure: { error: "x", timedOut: true } });
  assert.match(text(html), /Not added: Pi Web did not answer in time/);
  // The write failed after trusting, and the trust could not be taken back: said in words, not only in the diagnostic.
  html = pane({
    draft: { text: "npx x", scope: "project" },
    failure: { error: "x; the folder stays trusted", reason: "locked", trustKept: true, trust: { requiresTrust: false, trusted: true, decision: true, decisionPath: "/Users/me/repo", inherited: false } },
  });
  assert.match(text(html), /Not added: .* Pi Web trusted ~?\/?.*repo for this step and could not take that back, so the folder stays trusted\./);
  assert.doesNotMatch(text(html), /the folder stays trusted$/m, "not the English diagnostic");

  // Refusals worded as an Add's, not as the switch's, Test's or a session's.
  html = pane({ draft: { text: "https://api.example.com/mcp" }, failure: { error: 'server "server": url must be an http or https URL', reason: "server-invalid", name: "server" } });
  assert.match(text(html), /Not added: pi refuses it as filled in: server "server": url must be an http or https URL/);
  assert.doesNotMatch(text(html), /does not connect it/);
  html = pane({ draft: { text: "https://api.example.com/mcp" }, failure: { error: "x", reason: "web-password", name: "server" } });
  assert.match(text(html), /Not added: It references PI_WEB_PASSWORD, so Pi Web does not add it\./);
  for (const key of Object.values(MCP_ADD_REFUSAL_KEYS)) {
    for (const [locale, plugin] of Object.entries(locales)) assert.equal(typeof plugin[key], "string", `${key} in ${locale}`);
  }
});

test("Settings › MCP opens the add pane from the sidebar, keeps the draft, and tests what Add wrote", () => {
  const html = renderToStaticMarkup(h(I18nProvider, null, h(McpConfigView, {
    cwd: null,
    load: { state: "loaded", data: overview(null) },
    selected: null,
    refreshing: false,
    embedded: true,
    adding: true,
    addDraft: { ...EMPTY_MCP_ADD_DRAFT, text: "npx -y @acme/lint-mcp" },
    onSelect: noop,
    onRefresh: noop,
    onCodemodeChange: noop,
    onClose: noop,
  })));
  assert.match(decode(html), /<button type="button" aria-current="page" class="config-list-action-button">[\s\S]*?Add MCP<\/button>/);
  // No working directory and no env names: those rows are left out, not shown as "None".
  assert.match(text(html), /Preview Read as a command line Transport stdio Command npx -y @acme\/lint-mcp Named lint/);
  // The added notice: the server and its file, the folder trusted with it, the test, and Sign in.
  const addedView = (props = {}) => renderToStaticMarkup(h(I18nProvider, null, h(McpConfigView, {
    cwd: "/Users/me/repo",
    load: {
      state: "loaded",
      data: overview({ cwd: "/Users/me/repo", trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: "/Users/me/repo", inherited: false } }, {
        servers: [{
          name: "docs", scope: "project", sourcePath: projectFile.path, configKey: "k", enabled: true, validated: true,
          transport: "http", url: "https://docs.example.com/mcp", envNames: [], headerNames: [], usesOAuth: true,
          commandFields: [], variableReferences: [], masked: false,
          status: { origin: "test", state: "needs-auth", tools: [], toolCount: 0, testedAt: Date.now(), durationMs: 10 },
        }],
      }),
    },
    selected: "project\0docs",
    refreshing: false,
    embedded: true,
    added: { scope: "project", name: "docs", path: projectFile.path, key: "project\0docs", trustedFolder: "/Users/me/repo" },
    onSelect: noop,
    onRefresh: noop,
    onCodemodeChange: noop,
    onClose: noop,
    ...props,
  })));
  const notice = addedView();
  // Short on a phone: the project file from the panel's folder, and that folder as the button named it.
  assert.match(text(notice), /Added docs to \.\/\.pi\/mcp\.json, and trusted this folder\. It asks for a sign-in\./);
  assert.match(decode(notice), /<div role="status" class="config-notice has-action">[\s\S]*?<button type="button" class="config-button config-button-primary config-button-small">Sign in<\/button>/);
  // Outside the home folder too, where `~` shortens nothing (the e2e run's folder). The detail
  // pane's File row still shows the whole path.
  const far = "/private/tmp/work/some/long/folder/project";
  const farView = decode(renderToStaticMarkup(h(I18nProvider, null, h(McpConfigView, {
    cwd: far,
    load: {
      state: "loaded",
      data: overview({ cwd: far, trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: far, inherited: false } }, {
        files: [globalFile, { ...projectFile, path: `${far}/.pi/mcp.json`, exists: true }],
        servers: [{
          name: "docs", scope: "project", sourcePath: `${far}/.pi/mcp.json`, configKey: "k", enabled: true, validated: true,
          transport: "http", url: "https://docs.example.com/mcp", envNames: [], headerNames: [], usesOAuth: false,
          commandFields: [], variableReferences: [], masked: false,
        }],
      }),
    },
    selected: "project\0docs",
    refreshing: false,
    embedded: true,
    added: { scope: "project", name: "docs", path: `${far}/.pi/mcp.json`, key: "project\0docs", trustedFolder: far },
    onSelect: noop,
    onRefresh: noop,
    onCodemodeChange: noop,
    onClose: noop,
  }))));
  const farNotice = farView.match(/<div role="status" class="config-notice[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.equal(text(farNotice), "Added docs to ./.pi/mcp.json, and trusted this folder.");
  assert.match(text(farView), new RegExp(`File ${far.replace(/[/.]/g, "\\$&")}\\/\\.pi\\/mcp\\.json`));
  // A global Add names its file as the other panels do, and a folder other than the panel's by its path.
  const globalNotice = text(addedView({ added: { scope: "global", name: "docs", path: globalFile.path, key: "project\0docs" } }));
  assert.match(globalNotice, /Added docs to ~\/\.pi\/agent\/mcp\.json\./);
  const elsewhere = text(addedView({ added: { scope: "project", name: "docs", path: projectFile.path, key: "project\0docs", trustedFolder: "/Users/me/other" } }));
  assert.match(elsewhere, /Added docs to \.\/\.pi\/mcp\.json, and trusted ~\/other\./);
  for (const [locale, words] of Object.entries(locales)) {
    assert.equal(typeof words["mcp.add.addedTrustedHere"], "string", locale);
    assert.match(words["mcp.add.addedTrustedHere"], /\{name\}[\s\S]*\{path\}/, locale);
    assert.doesNotMatch(words["mcp.add.addedTrustedHere"], /\{folder\}/, locale);
  }
  // A Sign out of the same server on its way would cancel a sign-in started now, so the notice's
  // Sign in waits for it, as the row's does.
  const signingOut = decode(addedView({ busy: "sign-out:project\0docs" }));
  assert.match(text(signingOut), /It asks for a sign-in\./);
  assert.doesNotMatch(signingOut.slice(signingOut.indexOf("Added docs"), signingOut.indexOf("</div>", signingOut.indexOf("Added docs"))), /Sign in</);
  assert.match(configSource, /signingOut=\{busy === `sign-out:\$\{added\.key\}`\}/);

  // The container: Add is a change like any other, and only an Add that worked starts the test.
  const submit = configSource.slice(configSource.indexOf("const submitAdd = useCallback"), configSource.indexOf("// The notice goes when the route lets the removal go."));
  assert.match(submit, /const result = await runAction\(request, "add", \(data\) => \(data\.added \? mcpServerKey\(data\.added\) : undefined\)\);/);
  assert.match(submit, /if \(listed && !mcpTestBlock\(listed, result\.data\)\) void testServer\(listed\);/);
  assert.ok(submit.indexOf("if (!result.ok)") < submit.indexOf("void testServer("), "a refused Add tests nothing");
  assert.match(submit, /if \(writtenTrust && cwd\) onProjectTrustChanged\?\.\(cwd, writtenTrust\);/);
  assert.match(submit, /if \(result\.error\.trust && cwd\) onProjectTrustChanged\?\.\(cwd, result\.error\.trust\);/);
  // The test after Add is never aborted, as every Test (postMcpTest leaves the request running).
  assert.doesNotMatch(submit, /AbortController/);
  // An Add that worked takes its pane away, Add button and box alike, whichever started it (a click or
  // Cmd/Ctrl+Enter in the box, which leaves no pressed button): focus goes to the new server's row.
  const success = submit.slice(submit.indexOf("setAdding(false)"));
  assert.match(success, /setFocusBack\(\{ control: null, toSelectedRow: true \}\);/);
  assert.match(configSource, /if \(focusBack\.toSelectedRow\) focusIfLost\(document, focusFallback\(\)\);/);
  // An answer about a draft edited while the request was out is not shown under the new draft, nor
  // acted on (the host-variable confirmation, Use <name>), and what was typed since is kept.
  assert.match(submit, /const sent = addDraftRef\.current;[\s\S]*?await runAction\(request, "add"/);
  assert.match(submit, /const edited = addDraftRef\.current !== sent;/);
  assert.match(submit, /if \(!edited\) setAddFailure\(result\.error\);/);
  assert.match(success, /if \(!edited\) setAddDraft\(EMPTY_MCP_ADD_DRAFT\);/);
  assert.match(configSource, /onAddDraftChange=\{\(draft\) => \{\n\s*addDraftRef\.current = draft;\n\s*setAddDraft\(draft\);/);
});
