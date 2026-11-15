import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { mock } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { McpConfig, McpConfigView } = await jiti.import("./McpConfig.tsx");
const { ConfigSidebarGroupSwitch } = await jiti.import("./SettingsUi.tsx");
const { enLocale } = await jiti.import("@/lib/i18n/messages/en.ts");
const source = await readFile(new URL("./McpConfig.tsx", import.meta.url), "utf8");
const helperSource = await readFile(new URL("./mcp-config-helpers.ts", import.meta.url), "utf8");
const displaySource = await readFile(new URL("../lib/mcp-server-display.ts", import.meta.url), "utf8");
const apiTypesSource = await readFile(new URL("../lib/api-types.ts", import.meta.url), "utf8");

const h = React.createElement;
const messages = enLocale.messages;

function render(element) {
  return renderToStaticMarkup(h(I18nProvider, null, element));
}

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** The text of the markup, tags dropped, entities decoded. */
function text(html) {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function server(overrides = {}) {
  return {
    name: "github",
    scope: "global",
    sourcePath: "/Users/me/.pi/agent/mcp.json",
    configKey: "key",
    enabled: true,
    validated: true,
    envNames: [],
    headerNames: [],
    usesOAuth: false,
    commandFields: [],
    variableReferences: [],
    masked: false,
    ...overrides,
  };
}

const globalFile = { scope: "global", path: "/Users/me/.pi/agent/mcp.json", exists: true, problems: [] };
const projectFile = { scope: "project", path: "/Users/me/repo/.pi/mcp.json", exists: true, problems: [] };
const trusted = { requiresTrust: true, trusted: true, decision: true, decisionPath: "/Users/me/repo", inherited: false };
const untrusted = { requiresTrust: true, trusted: false, decision: null, inherited: false };

function overview(overrides = {}) {
  return {
    mcp: { available: true },
    codemode: { sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" },
    files: [globalFile],
    servers: [],
    ...overrides,
  };
}

const stdioServer = server({
  name: "lint",
  transport: "stdio",
  exposure: "direct",
  command: "npx",
  args: ["-y", "@acme/lint-mcp", "--api-key=••••"],
  cwd: "tools",
  envNames: ["NODE_ENV", "LINT_TOKEN"],
  commandFields: [{ kind: "env", name: "LINT_TOKEN" }],
  masked: true,
});

const httpServer = server({
  name: "github",
  transport: "http",
  exposure: "codemode",
  url: "https://api.example.com/mcp",
  headerNames: ["Authorization"],
  variableReferences: [{ kind: "header", name: "Authorization", variables: ["GITHUB_TOKEN"] }],
});

function view(props = {}) {
  return render(h(McpConfigView, {
    cwd: null,
    load: { state: "loaded", data: overview({ servers: [httpServer, stdioServer] }) },
    selected: null,
    refreshing: false,
    embedded: true,
    onSelect() {},
    onRefresh() {},
    onClose() {},
    ...props,
  }));
}

/** The opening tag of the sidebar row whose accessible name starts with `name`. */
function row(html, name) {
  return decode(html).match(new RegExp(`<button[^>]*aria-label="${name}[^"]*"[^>]*>`))?.[0];
}

test("without a project only the global file is listed, under the Code mode row", () => {
  const html = view();
  const shown = text(html);
  assert.ok(!shown.includes(messages["skills.scope.project"]), "no Project group without a project");
  assert.match(decode(html), /class="config-sidebar-group-label-text">global</);
  // Code mode comes first, so the 190px phone sidebar always shows it.
  const sidebar = decode(html).slice(decode(html).indexOf('class="config-sidebar-list"'));
  assert.ok(sidebar.indexOf("Code mode: Automatic") < sidebar.indexOf("github: On"));
  assert.match(row(html, "Code mode"), /aria-label="Code mode: Automatic"/);
  assert.match(row(html, "github"), /aria-label="github: On"/);
  assert.match(shown, /2 of 2 servers turned on/);
});

test("with a project, its group comes first and every row names its state", () => {
  const data = overview({
    files: [globalFile, projectFile],
    servers: [
      server({ name: "shared", transport: "http", url: "https://a.example/mcp", shadowedByProject: true }),
      server({ name: "off", transport: "http", url: "https://b.example/mcp", enabled: false }),
      server({ name: "shared", scope: "project", sourcePath: projectFile.path, transport: "stdio", command: "node", replacesGlobal: true }),
      server({ name: "legacy", scope: "project", sourcePath: projectFile.path, invalidError: "sse is not supported", url: "https://old/sse" }),
    ],
    project: { cwd: "/Users/me/repo", trust: untrusted },
  });
  const html = view({ cwd: "/Users/me/repo", load: { state: "loaded", data } });
  const markup = decode(html);
  assert.ok(markup.indexOf(">project<") < markup.indexOf(">global<"));
  // Each heading holds its n/m count and the group switch, on only while every server is.
  assert.match(markup, /<span class="config-sidebar-group-count">1\/2<\/span><button type="button" role="switch" aria-checked="false" aria-label="Turn on every global server"/);
  // The untrusted project's switch waits for trust, pointing at the notice that says so.
  const projectSwitch = markup.match(/<span class="config-sidebar-group-count">2\/2<\/span>(<button[^>]*>)/)?.[1];
  assert.match(projectSwitch, /aria-checked="true" aria-label="Turn off every project server" aria-describedby="([^"]+)"[^>]*disabled=""/);
  const noticeId = projectSwitch.match(/aria-describedby="([^"]+)"/)[1];
  assert.match(markup, new RegExp(`<div id="${noticeId}" role="status" class="config-notice">This project is not trusted`));
  // The project is not trusted, so its entry does not connect and the global one is not replaced.
  assert.match(row(html, "shared: Project"), /aria-label="shared: Project not trusted"/);
  assert.match(row(html, "shared: On"), /aria-label="shared: On"/);
  assert.match(row(html, "off"), /aria-label="off: Turned off in the file"/);
  assert.match(row(html, "legacy"), /aria-label="legacy: Refused by Pi"/);
  // The state is visible text on the row too, never only the dot's color.
  for (const badge of ["untrusted", "off", "refused"]) {
    assert.match(markup, new RegExp(`class="mcp-sidebar-badge is-[a-z]+">${badge}<`), badge);
  }
  // The untrusted project gets the trust notice, which also says its servers cannot be changed
  // here; without a Trust handler it has no button.
  assert.match(markup, /<div id="[^"]+" role="status" class="config-notice">This project is not trusted, so the servers in its \.pi\/mcp\.json do not connect\. Pi Web does not change them until the project is trusted\.<\/div>/);

  const trustedHtml = view({
    cwd: "/Users/me/repo",
    load: { state: "loaded", data: { ...data, project: { cwd: "/Users/me/repo", trust: trusted } } },
  });
  assert.match(row(trustedHtml, "shared: Replaced"), /aria-label="shared: Replaced by the project's server"/);
  assert.ok(!decode(trustedHtml).includes("This project is not trusted"));
});

test("inherited trust names the folder it comes from", () => {
  const data = overview({
    files: [globalFile, projectFile],
    servers: [server({ name: "p", scope: "project", sourcePath: projectFile.path, transport: "stdio", command: "node" })],
    project: { cwd: "/Users/me/repo/app", trust: { ...trusted, decisionPath: "/Users/me/repo", inherited: true } },
  });
  const shown = text(view({ cwd: "/Users/me/repo/app", load: { state: "loaded", data } }));
  assert.match(shown, /Trusted through ~\/repo: the servers in this project's \.pi\/mcp\.json connect, as in every folder under it\./);
  const denied = text(view({
    cwd: "/Users/me/repo/app",
    load: { state: "loaded", data: { ...data, project: { cwd: "/Users/me/repo/app", trust: { ...untrusted, decision: false, decisionPath: "/Users/me/repo", inherited: true } } } },
  }));
  assert.match(denied, /This project is not trusted \(~\/repo is marked untrusted\)/);
});

test("a stdio server's detail shows its masked command line, folder, env names and !command fields", () => {
  const html = view({ selected: "global\0lint" });
  const shown = text(html);
  const markup = decode(html);
  assert.match(markup, /<div class="config-detail-title">lint<\/div>/);
  // The Command label says it runs over stdio: no Transport row repeats it.
  assert.doesNotMatch(shown, /Transport/);
  assert.match(markup, /<div class="config-detail-grid-label">Command<\/div><div class="config-detail-grid-value is-mono mcp-config-code">npx -y @acme\/lint-mcp --api-key=••••<\/div>/);
  assert.match(shown, /Working directory tools/);
  assert.match(markup, /<code class="mcp-config-chip">NODE_ENV<\/code><code class="mcp-config-chip">LINT_TOKEN<\/code>/);
  // Names only: the values stay in the file.
  assert.doesNotMatch(shown, /Values are not shown here/);
  assert.match(shown, /Shell commands Runs a shell command on every connection: env LINT_TOKEN/);
  assert.match(markup, /<option value="direct" selected="">direct<\/option>/);
  assert.match(shown, /Every tool's full declaration goes with every request: the most tokens\./);
  assert.match(shown, /File ~\/\.pi\/agent\/mcp\.json/);
  assert.match(shown, /Parts that look like secrets are hidden\./);
  // Headers and sign-in belong to HTTP servers.
  assert.doesNotMatch(shown, /Headers|Sign-in/);

  // What the entry does not set is left out: no working directory, no env names.
  const plain = text(view({ selected: "global\0lint", load: { state: "loaded", data: overview({ servers: [{ ...stdioServer, cwd: undefined, envNames: [] }] }) } }));
  assert.doesNotMatch(plain, /Working directory|Environment|None/);
});

test("an HTTP server's detail shows its URL, header names, the variables it sends and how it signs in", () => {
  const shown = text(view({ selected: "global\0github" }));
  assert.match(shown, /URL https:\/\/api\.example\.com\/mcp/);
  assert.match(shown, /Headers Authorization Host variables/);
  assert.match(shown, /Host variables Sends environment variables of the computer running Pi Web to this server on every connection: GITHUB_TOKEN in header Authorization/);
  // Its Authorization header is how it signs in, which the Headers row already says; the URL label says HTTP.
  assert.doesNotMatch(shown, /Sign-in|Transport/);
  assert.match(shown, /Only the server's name and summary are listed; Code mode scripts search for its tools\./);
  assert.doesNotMatch(shown, /Working directory|Environment/);

  const oauth = (signedIn) => text(view({
    selected: "global\0notion",
    load: { state: "loaded", data: overview({ servers: [server({ name: "notion", transport: "http", url: "https://n/mcp", usesOAuth: true, signedIn })] }) },
  }));
  assert.match(oauth(true), /Sign-in Signed in\./);
  assert.match(oauth(false), /Sign-in Not signed in\./);
  assert.match(oauth(undefined), /Sign-in Unknown: mcp-auth\.json cannot be read\./);

  // Code mode cannot run here, so its tools go through tool search.
  const sandboxDown = text(view({
    selected: "global\0github",
    load: { state: "loaded", data: overview({ servers: [httpServer], codemode: { sandbox: { state: "unavailable", error: "no wasm" }, builtinDisabled: false, preference: "automatic" } }) },
  }));
  assert.match(sandboxDown, /reached through tool search instead/);

  // -builtin:codemode registers no codemode tool, so only tool search can reach them.
  const builtinOff = text(view({
    selected: "global\0github",
    load: { state: "loaded", data: overview({ servers: [httpServer], codemode: { sandbox: { state: "available" }, builtinDisabled: true, preference: "always" } }) },
  }));
  assert.match(builtinOff, /search for its tools\. -builtin:codemode turns Code mode off, so these tools can be called only while tool search is active\./);

  // Automatic with autoEnableCodemode false never turns Code mode on for them.
  const autoOff = (preference) => text(view({
    selected: "global\0github",
    load: { state: "loaded", data: overview({
      files: [{ ...globalFile, autoEnableCodemode: false }],
      servers: [httpServer],
      codemode: { sandbox: { state: "available" }, builtinDisabled: false, preference },
    }) },
  }));
  assert.match(autoOff("automatic"), /autoEnableCodemode is false in ~\/\.pi\/agent\/mcp\.json, so sessions do not turn Code mode on for these tools: they can be called only while Code mode is Always on or tool search is active\./);
  assert.doesNotMatch(autoOff("always"), /autoEnableCodemode/);
  // Tools the model is offered directly need no Code mode.
  const direct = text(view({
    selected: "global\0lint",
    load: { state: "loaded", data: overview({ files: [{ ...globalFile, autoEnableCodemode: false }], servers: [stdioServer] }) },
  }));
  assert.doesNotMatch(direct, /autoEnableCodemode/);
});

test("a refused entry shows why, and nothing it would run or send", () => {
  const refused = server({
    name: "bad",
    invalidError: "\"sse\" transport is not supported",
    url: "https://old/sse",
    commandFields: [{ kind: "header", name: "X" }],
    variableReferences: [{ kind: "header", name: "X", variables: ["SECRET"] }],
  });
  const shown = text(view({ selected: "global\0bad", load: { state: "loaded", data: overview({ servers: [refused] }) } }));
  assert.match(shown, /Status Refused by Pi Pi refuses this entry, so it never connects: "sse" transport is not supported/);
  assert.doesNotMatch(shown, /Shell commands|Host variables|Sign-in/);

  const password = text(view({
    selected: "global\0pw",
    load: { state: "loaded", data: overview({ servers: [server({ name: "pw", transport: "http", url: "https://x/mcp", webPasswordField: { kind: "header", name: "Authorization" } })] }) },
  }));
  assert.match(password, /Status Refused: references PI_WEB_PASSWORD References PI_WEB_PASSWORD\. Pi Web refuses to connect it/);
});

test("repository text is shown with its hidden characters escaped", () => {
  const sneaky = server({ name: "safe\u202Ejs.revres", scope: "project", sourcePath: projectFile.path, transport: "stdio", command: "node", args: ["a\nb"], envNames: ["A\u200BB"] });
  const html = view({
    cwd: "/Users/me/repo",
    selected: "project\0safe\u202Ejs.revres",
    load: { state: "loaded", data: overview({ files: [globalFile, projectFile], servers: [sneaky], project: { cwd: "/Users/me/repo", trust: trusted } }) },
  });
  assert.ok(!/[\n\u202E\u200B]/.test(html), "no raw newline, override or zero-width space reaches the markup");
  assert.match(decode(html), /"a\\u\{000A\}b"/);
  assert.match(decode(html), /safe\\u\{202E\}js\.revres/);
  assert.match(text(html), /Holds invisible or control characters/);
});

test("MCP being off, a refused project folder, and file problems are said above and below the list", () => {
  const off = text(view({ load: { state: "loaded", data: overview({ mcp: { available: false, reason: "operator-disabled", error: "x" } }) } }));
  assert.match(off, /MCP is off: PI_WEB_DISABLE_MCP is set where Pi Web runs\./);
  const internals = text(view({ load: { state: "loaded", data: overview({ mcp: { available: false, reason: "internals-unavailable", error: "x", detail: "cannot find module" } }) } }));
  assert.match(internals, /cannot load the SDK's MCP modules\. .* cannot find module/);
  const builtin = text(view({ load: { state: "loaded", data: overview({ mcp: { available: false, reason: "builtin-disabled", error: "x", settingsPath: "/Users/me/.pi/agent/settings.json" } }) } }));
  assert.match(builtin, /the extensions setting in ~\/\.pi\/agent\/settings\.json turns off builtin:mcp/);

  const projectError = view({
    cwd: "/Users/me/gone",
    load: { state: "loaded", data: overview(), projectError: { error: "cwd must be a directory", reason: "cwd-not-directory" } },
  });
  assert.match(text(projectError), /This project's servers are not listed: The project folder no longer exists or is not a folder\./);
  assert.match(decode(projectError), /class="mcp-sidebar-group-empty">Not listed</);

  const broken = view({
    load: {
      state: "loaded",
      data: overview({ files: [{ ...globalFile, problems: [{ reason: "unparsable", error: "Unexpected token } in JSON at position 9 (line 1 column 10)" }] }] }),
    },
  });
  const shown = text(broken);
  assert.match(decode(broken), /class="config-footer-status-summary is-error">1 file problem</);
  assert.match(shown, /~\/\.pi\/agent\/mcp\.json The file is not valid JSON, so none of its servers load\. Unexpected token \} in JSON at position 9/);
  assert.match(decode(broken), /class="mcp-sidebar-group-empty">Not listed: see the file problem below</);
  // The detail pane agrees: the servers are hidden by the problem, not missing.
  assert.match(shown, /No servers could be listed: see the file problems below\./);
  assert.doesNotMatch(shown, /No MCP servers yet/);
});

test("MCP being off is said once, above the list: the server's pane points at that notice", () => {
  const html = view({
    selected: "global\0web",
    load: { state: "loaded", data: overview({
      mcp: { available: false, reason: "internals-unavailable", error: "x", detail: "cannot find module" },
      servers: [server({ name: "web", transport: "http", url: "https://x/mcp", usesOAuth: true, signedIn: false, validated: false })],
    }) },
  });
  const shown = text(html);
  assert.equal(shown.match(/MCP is off:/g)?.length, 1);
  assert.match(shown, /Servers cannot be changed here while MCP is off\./);
  assert.doesNotMatch(shown, /MCP is off on this Pi Web server/);
  assert.doesNotMatch(shown, /Listed unchecked/);
  const noticeId = noticeIdOf(html, "MCP is off");
  assert.ok(decode(html).split(`aria-describedby="${noticeId}"`).length - 1 >= 3, "Test, Remove and Sign in point at the notice");
});

test("a dangling project link needs no trust, so only the footer speaks of it", () => {
  const dangling = { ...projectFile, problems: [{ reason: "link-dangling", error: "a symbolic link to nothing" }] };
  const html = view({
    cwd: "/Users/me/repo",
    load: { state: "loaded", data: overview({
      files: [globalFile, dangling],
      project: { cwd: "/Users/me/repo", trust: { requiresTrust: false, trusted: true, decision: null, inherited: false } },
    }) },
  });
  const shown = text(html);
  assert.doesNotMatch(shown, /not trusted/);
  assert.match(shown, /1 file problem/);
});

test("an untrusted project's notice offers Trust only where the trust dialog would", () => {
  const trustButton = /<button type="button" class="config-button config-button-secondary config-button-small">Trust project…<\/button>/;
  const projectServer = server({ name: "p", scope: "project", sourcePath: projectFile.path, transport: "stdio", command: "node" });
  const withTrust = (project, files = [globalFile, projectFile], props = {}) => decode(view({
    cwd: "/Users/me/repo",
    load: { state: "loaded", data: overview({ files, servers: [projectServer], project: { cwd: "/Users/me/repo", ...project } }) },
    onTrustProject() {},
    ...props,
  }));

  // The folder requires trust and is not trusted: the notice and its button share one line.
  const offered = withTrust({ trust: untrusted });
  assert.match(offered, /<div id="[^"]+" role="status" class="config-notice has-action"><span class="config-notice-text">This project is not trusted, so the servers in its \.pi\/mcp\.json do not connect\. Pi Web does not change them until the project is trusted\.<\/span><button type="button"[^>]*>Trust project…<\/button><\/div>/);
  // An ancestor marked untrusted: trusting records this folder's own decision, which wins.
  assert.match(withTrust({ trust: { ...untrusted, decision: false, decisionPath: "/Users/me", inherited: true } }), trustButton);

  // The notice stays, without a button, where trusting could not succeed:
  // an unreadable trust.json, whose failure trusting would meet too...
  const unreadable = withTrust({ trustError: "Lock file is already being held" });
  assert.match(unreadable, /Pi Web cannot read the trust store/);
  assert.doesNotMatch(unreadable, trustButton);
  // ...and an explicit false on a folder that requires no trust (a dangling .pi/mcp.json link),
  // where POST /api/project-trust answers trust-not-required.
  const dangling = withTrust(
    { trust: { requiresTrust: false, trusted: true, decision: false, decisionPath: "/Users/me/repo", inherited: false } },
    [globalFile, { ...projectFile, problems: [{ reason: "link-dangling", error: "a symbolic link to nothing" }] }],
  );
  assert.match(dangling, /This project is not trusted/);
  assert.doesNotMatch(dangling, trustButton);

  // Nothing to trust: trusted, exactly or through a parent.
  assert.doesNotMatch(withTrust({ trust: trusted }), trustButton);
  assert.doesNotMatch(withTrust({ trust: { ...trusted, decisionPath: "/Users/me", inherited: true } }), trustButton);
  // No handler, no button: the panel never offers one that does nothing.
  assert.doesNotMatch(withTrust({ trust: untrusted }, undefined, { onTrustProject: undefined }), trustButton);
});

test("the container renders with the page's trust status and handler without fetching anything itself", () => {
  assert.match(text(render(h(McpConfig, { cwd: "/Users/me/repo", trust: untrusted, onTrustProject() {}, onClose() {}, embedded: true }))), /Loading\.\.\./);
});

test("the notices above the list sit together in their own box, right before the split view", () => {
  const html = decode(view({
    load: { state: "loaded", data: overview({ servers: [httpServer], hostInactive: { owner: "/ext/other-mcp.ts", cwd: "/Users/me/repo", updatedAt: 1 } }) },
    undo: { scope: "global", name: "lint", path: globalFile.path, token: "t", expiresInMs: 60_000, undoing: false },
  }));
  const notices = html.match(/<div class="mcp-config-notices">([\s\S]*?)<\/div><div class="config-split-view">/);
  assert.ok(notices, "the notices sit in one box right before the split view");
  assert.equal((notices[1].match(/role="status" class="config-notice/g) ?? []).length, 2);
});

test("a selected row renders with the ref attached as a plain button: the ref is not an attribute", () => {
  assert.match(view({ selected: "codemode" }), /<button type="button" aria-label="Code mode: [^"]+" aria-current="page" class="config-sidebar-item">/);
});

test("loading, a failed load and an empty listing each say so", () => {
  assert.match(text(view({ load: { state: "loading" } })), /Loading\.\.\./);
  const denied = decode(view({ load: { state: "failed", error: { error: "Access denied", reason: "cwd-denied" } } }));
  assert.match(denied, /<div role="alert" class="config-sidebar-message is-error">Could not read the MCP settings\. Pi Web may not read this folder\.<\/div>/);
  // Nothing to translate for an internal failure: its diagnostic is the reason.
  assert.match(text(view({ load: { state: "failed", error: { error: "EACCES: permission denied", reason: "internal" } } })), /Could not read the MCP settings\. EACCES: permission denied/);
  // A load that never answered ends with a way out, never "Loading..." for good.
  assert.match(
    text(view({ load: { state: "failed", error: { error: "GET /api/mcp did not answer within 15000 ms", timedOut: true } } })),
    /Could not read the MCP settings\. Pi Web did not answer in time\. Press Refresh to try again\./,
  );
  const empty = text(view({ load: { state: "loaded", data: overview() } }));
  assert.match(empty, /No MCP servers yet\. Servers in ~\/\.pi\/agent\/mcp\.json and in a project's \.pi\/mcp\.json appear here\./);
  assert.match(empty, /global No servers/);
  assert.doesNotMatch(empty, /0 of 0/);
  assert.match(text(view({ selected: "global\0gone" })), /Select a server or Code mode\./);
  assert.match(decode(view({ refreshing: true })), /<button type="button" disabled="" class="config-button config-button-secondary config-button-default">Refresh<\/button>/);
});

/** The Code mode switch's buttons, by label, with whether each is pressed and disabled. */
function codemodeOptions(html) {
  const group = decode(html).match(/<div role="group" aria-label="Code mode"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(group, "the Code mode switch is rendered");
  return [...group.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attributes, label]) => ({
    label,
    pressed: /aria-pressed="true"/.test(attributes),
    disabled: /disabled=""/.test(attributes),
    describedBy: attributes.match(/aria-describedby="([^"]+)"/)?.[1],
  }));
}

function codemodeView(info, props = {}) {
  return view({ selected: "codemode", load: { state: "loaded", data: overview({ codemode: info, ...props.data }) }, ...props.view });
}

test("the Code mode pane offers Automatic and Always on, and says once when its settings apply", () => {
  const automatic = codemodeView({ sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" });
  assert.deepEqual(codemodeOptions(automatic), [
    { label: "Automatic", pressed: true, disabled: false, describedBy: undefined },
    { label: "Always on", pressed: false, disabled: false, describedBy: undefined },
  ]);
  assert.match(text(automatic),
    /Add MCP Code mode The model calls tools from a short script; MCP tools use it by default\. Changes apply to sessions started afterwards\. Mode Automatic Always on Turns on when an MCP server that uses code mode connects\. Sandbox Available\./);
  // Said once, in the intro, not under every row.
  assert.equal(text(codemodeView({
    sandbox: { state: "available" },
    builtinDisabled: false,
    preference: "automatic",
    mode: { settingsPath: "/Users/me/.pi/agent/settings.json", value: "on" },
    inlineBudget: { settingsPath: "/Users/me/.pi/agent/settings.json", default: 3000, max: 1_000_000 },
  })).match(/sessions started afterwards/g).length, 1);
  assert.doesNotMatch(automatic, /role="alert"/);

  // A self-test nobody has run yet leaves Always on available and has its own wording.
  const always = codemodeView({ sandbox: { state: "not-checked" }, builtinDisabled: false, preference: "always" });
  assert.deepEqual(codemodeOptions(always).map(({ label, pressed, disabled }) => [label, pressed, disabled]), [
    ["Automatic", false, false],
    ["Always on", true, false],
  ]);
  assert.match(text(always),
    /Sessions start with Code mode on\. Sandbox Not checked yet: the self-test runs when the first session starts after Pi Web does\./);

  // While a save is on its way both options wait, and the pane says it is saving.
  const saving = codemodeView({ sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" }, {
    view: { codemodeSave: { saving: true, error: null } },
  });
  assert.deepEqual(codemodeOptions(saving).map(({ disabled }) => disabled), [true, true]);
  assert.match(decode(saving), /<span role="status" class="mcp-config-line is-dim">Saving…<\/span>/);
});

test("Always on is disabled with a visible reason while no session could offer Code mode", () => {
  const reasonOf = (html) => {
    const [, always] = codemodeOptions(html);
    assert.equal(always.disabled, true);
    assert.ok(always.describedBy, "the disabled option points at its reason");
    const reason = decode(html).match(new RegExp(`<span id="${always.describedBy}" class="config-scope-switch-reason">([^<]*)</span>`))?.[1];
    assert.ok(reason, "the reason is visible text, not a tooltip");
    // Automatic can still be chosen.
    assert.equal(codemodeOptions(html)[0].disabled, false);
    return reason;
  };
  assert.equal(
    reasonOf(codemodeView({ sandbox: { state: "unavailable", error: "worker exited" }, builtinDisabled: false, preference: "automatic" })),
    "Always on is unavailable: Code mode's sandbox cannot run on this Pi Web server.",
  );
  const globalPath = "/Users/me/.pi/agent/settings.json";
  assert.equal(
    reasonOf(codemodeView({ sandbox: { state: "available" }, builtinDisabled: true, builtinSettingsPath: globalPath, globalBuiltinSettingsPath: globalPath, preference: "always" })),
    "Always on is unavailable: -builtin:codemode in ~/.pi/agent/settings.json turns Code mode off.",
  );
  // A project that turns Code mode back on for its sessions does not make the global switch work elsewhere.
  assert.equal(
    reasonOf(codemodeView({ sandbox: { state: "available" }, builtinDisabled: false, globalBuiltinSettingsPath: globalPath, preference: "automatic" })),
    "Always on is unavailable: -builtin:codemode in ~/.pi/agent/settings.json turns Code mode off.",
  );

  const down = text(codemodeView({ sandbox: { state: "unavailable", error: "worker exited" }, builtinDisabled: true, builtinSettingsPath: globalPath, globalBuiltinSettingsPath: globalPath, preferenceError: "Unexpected token" }));
  // An unreadable settings file offers no choice to save into it.
  assert.match(down, /Cannot read the global settings file: Unexpected token/);
  assert.doesNotMatch(down, /Turns on when an MCP server/);
  assert.match(down, /Cannot run on this Pi Web server, so no session offers Code mode: worker exited/);
  assert.match(down, /Turned off by -builtin:codemode in ~\/\.pi\/agent\/settings\.json\./);
  const html = view({ load: { state: "loaded", data: overview({ codemode: { sandbox: { state: "unavailable", error: "x" }, builtinDisabled: false, preference: "automatic" } }) } });
  assert.match(row(html, "Code mode"), /aria-label="Code mode: Unavailable"/);
  assert.match(decode(html), /class="mcp-sidebar-badge is-error">Unavailable</);
});

test("a trusted project that turns Code mode off for itself leaves Always on, a global choice, available", () => {
  const html = codemodeView({
    sandbox: { state: "available" },
    builtinDisabled: true,
    builtinSettingsPath: "/work/app/.pi/settings.json",
    preference: "automatic",
  });
  assert.deepEqual(codemodeOptions(html).map(({ label, disabled, describedBy }) => [label, disabled, describedBy]), [
    ["Automatic", false, undefined],
    ["Always on", false, undefined],
  ]);
  assert.doesNotMatch(decode(html), /config-scope-switch-reason/);
  // The project's own line says what it does to its sessions, and that the switch still reaches the others.
  assert.match(text(html),
    /Extension Turned off for this project's sessions by -builtin:codemode in \/work\/app\/\.pi\/settings\.json\. Always on still applies to sessions in other folders\./);
});

test("a failed save is shown with its reason on every platform", () => {
  const info = { sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" };
  const failed = (error) => {
    const html = codemodeView(info, { view: { codemodeSave: { saving: false, error } } });
    return decode(html).match(/<span role="alert" class="mcp-config-line is-error">([\s\S]*?)<\/span>(?=<span|<\/div>)/)?.[1];
  };
  assert.equal(text(failed({ error: "Untrusted API request", reason: "request-denied" })),
    "Could not save the choice: Pi Web refused the request because it did not come from this page.");
  // An internal failure (the settings file no longer parses, its lock is held) shows its diagnostic.
  assert.equal(text(failed({ error: "Unexpected token n in JSON", reason: "internal" })), "Could not save the choice: Unexpected token n in JSON");
  assert.equal(text(failed({ error: "Failed to fetch" })), "Could not save the choice: Failed to fetch");
  assert.equal(text(failed({ error: "PUT /api/tools/settings did not answer within 15000 ms", timedOut: true })),
    "Could not save the choice: Pi Web did not answer in time, so the choice may not have been saved.");
});

test("a trusted project whose defaultTools decides Code mode is named in the pane", () => {
  const settingsPath = "/Users/me/repo/.pi/settings.json";
  const pane = (globalPreference, projectPreference, autoEnableCodemode = true) => text(view({
    cwd: "/Users/me/repo",
    selected: "codemode",
    load: { state: "loaded", data: overview({
      files: [{ ...globalFile, autoEnableCodemode }, projectFile],
      project: { cwd: "/Users/me/repo", trust: trusted },
      codemode: {
        sandbox: { state: "available" },
        builtinDisabled: false,
        preference: globalPreference,
        projectOverride: { settingsPath, preference: projectPreference },
      },
    }) },
  }));
  assert.match(pane("always", "automatic"),
    /This project decides for itself: defaultTools in ~\/repo\/\.pi\/settings\.json starts its sessions without Code mode, as Automatic does, whichever you choose here\./);
  assert.match(pane("automatic", "always"),
    /This project decides for itself: defaultTools in ~\/repo\/\.pi\/settings\.json starts its sessions with Code mode on, whichever you choose here\./);
  // The switch still shows and saves the global choice.
  assert.match(pane("automatic", "always"), /Mode Automatic Always on Turns on when an MCP server that uses code mode connects/);
  // With autoEnableCodemode false, Automatic is what these sessions get, so the warning follows the project.
  assert.match(pane("always", "automatic", false), /autoEnableCodemode is false in ~\/\.pi\/agent\/mcp\.json, so Automatic never turns Code mode on/);
  assert.doesNotMatch(pane("automatic", "always", false), /autoEnableCodemode/);
});

test("the autoEnableCodemode warning names the file whose value sessions read", () => {
  // autoEnableCodemode false (the trusted project's value wins) keeps Automatic from ever turning it on.
  const autoOff = (preference) => text(view({
    cwd: "/Users/me/repo",
    selected: "codemode",
    load: { state: "loaded", data: overview({
      files: [{ ...globalFile, autoEnableCodemode: true }, { ...projectFile, autoEnableCodemode: false }],
      project: { cwd: "/Users/me/repo", trust: trusted },
      codemode: { sandbox: { state: "available" }, builtinDisabled: false, preference },
    }) },
  }));
  assert.match(autoOff("automatic"), /Mode Automatic Always on Turns on when an MCP server .* autoEnableCodemode is false in ~\/repo\/\.pi\/mcp\.json, so Automatic never turns Code mode on/);
  assert.doesNotMatch(autoOff("always"), /autoEnableCodemode/);
});

test("the container shows that it is loading before the first answer", () => {
  assert.match(text(render(h(McpConfig, { cwd: null, onClose() {}, embedded: true }))), /Loading\.\.\./);
});

test("the Code mode pane's budget field saves a whole number, or empty for pi's default", () => {
  const budget = { settingsPath: "/Users/me/.pi/agent/settings.json", default: 3000, max: 1_000_000 };
  const info = (inlineBudget, extra = {}) => ({ sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic", inlineBudget, ...extra });
  const field = (html) => decode(html).match(/<form class="mcp-codemode-budget">([\s\S]*?)<\/form>/)?.[1];
  const input = (html) => field(html).match(/<input[^>]*>/)[0];
  const save = (html) => field(html).match(/<button type="submit"[^>]*>/)[0];

  const unset = codemodeView(info(budget));
  assert.match(input(unset), /aria-label="Tool list budget"/);
  assert.match(input(unset), /value=""/);
  assert.match(input(unset), /placeholder="3000"/);
  assert.match(input(unset), /inputMode="numeric"/);
  // Nothing typed yet: nothing to save.
  assert.match(save(unset), /disabled=""/);
  assert.match(text(unset), /Turns on when an MCP server that uses code mode connects\. Tool list budget tokens Save Tokens the code mode description may spend listing tools; scripts find the rest with searchTools\(\)\. Leave empty for pi's default, 3000\. Sandbox/);
  // The hint describes the field.
  const hintId = input(unset).match(/aria-describedby="([^"]+)"/)[1];
  assert.match(decode(unset), new RegExp(`<span id="${hintId}" class="mcp-config-line">Tokens the code mode description`));
  assert.match(input(codemodeView(info({ ...budget, value: 1000 }))), /value="1000"/);

  // While a budget save is on its way, the field keeps focus (read-only, not disabled), Save waits, and the
  // choice waits too; the Saving… line is the budget's, not the choice's.
  const saving = codemodeView(info({ ...budget, value: 1000 }), { view: { codemodeSave: { saving: true, error: null, target: "inlineBudget" } } });
  assert.match(input(saving), /readOnly=""/);
  assert.doesNotMatch(input(saving), /disabled/);
  assert.match(save(saving), /disabled=""/);
  assert.match(field(saving), /<span role="status" class="mcp-config-line is-dim">Saving…<\/span>/);
  assert.deepEqual(codemodeOptions(saving).map(({ disabled }) => disabled), [true, true]);
  assert.equal(decode(saving).match(/role="status"/g).length, 1);
  // A server change on its way makes the field wait as well.
  assert.match(input(codemodeView(info(budget), { view: { busy: "switch:global\0docs" } })), /readOnly=""/);

  // Each failure shows in the row its save was made from.
  const failure = { error: "Invalid settings.json: codemode must be an object", reason: "internal" };
  const budgetFailed = text(codemodeView(info(budget), { view: { codemodeSave: { saving: false, error: failure, target: "inlineBudget" } } }));
  assert.match(budgetFailed, /Could not save the budget: Invalid settings\.json: codemode must be an object Sandbox/);
  assert.doesNotMatch(budgetFailed, /Could not save the choice/);
  const choiceFailed = text(codemodeView(info(budget), { view: { codemodeSave: { saving: false, error: failure, target: "preference" } } }));
  assert.match(choiceFailed, /Could not save the choice:/);
  assert.doesNotMatch(choiceFailed, /Could not save the budget/);

  // A stored value pi ignores and a project that decides for itself are said under the field.
  const notices = text(codemodeView(info({
    ...budget,
    invalid: '"lots"',
    projectOverride: { settingsPath: "/Users/me/repo/.pi/settings.json", value: 800 },
  })));
  assert.match(notices, /codemode\.inlineBudget in ~\/\.pi\/agent\/settings\.json is "lots", which pi ignores, so sessions use 3000\. Saving replaces it\./);
  assert.match(notices, /This project decides for itself: codemode\.inlineBudget in ~\/repo\/\.pi\/settings\.json gives its sessions 800, whatever you save here\./);

  // An unreadable settings file offers no field to save into it; an overview without a budget shows no row.
  const unreadable = text(codemodeView(info(undefined, { inlineBudgetError: "Unexpected token" })));
  assert.match(unreadable, /Tool list budget Cannot read the global settings file: Unexpected token/);
  assert.doesNotMatch(codemodeView(info(undefined)), /Tool list budget/);
});

/** The Built-in tools switch's buttons, by label, with whether each is pressed and disabled. */
function modeOptions(html) {
  const group = decode(html).match(/<div role="group" aria-label="Built-in tools"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(group, "the mode switch is rendered");
  return [...group.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attributes, label]) => [
    label,
    /aria-pressed="true"/.test(attributes),
    /disabled=""/.test(attributes),
  ]);
}

test("the Code mode pane's Built-in tools switch keeps tools declared or leaves them to scripts", () => {
  const settingsPath = "/Users/me/.pi/agent/settings.json";
  const info = (mode, extra = {}) => ({ sandbox: { state: "available" }, builtinDisabled: false, preference: "always", mode, ...extra });

  const on = codemodeView(info({ settingsPath, value: "on" }));
  assert.deepEqual(modeOptions(on), [["Direct", true, false], ["In scripts", false, false]]);
  // Between the choice and the budget, with what it does.
  assert.match(text(on), /Sessions start with Code mode on\. Built-in tools Direct In scripts The model calls read, bash and the other tools directly\. Sandbox/);
  // The Code mode choice keeps its own switch.
  assert.deepEqual(codemodeOptions(on).map(({ label }) => label), ["Automatic", "Always on"]);

  const only = text(codemodeView(info({ settingsPath, value: "only" })));
  assert.match(only, /Built-in tools Direct In scripts While Code mode is on, the model calls read, bash and the other tools only from scripts\. Sandbox/);
  assert.doesNotMatch(only, /Under Automatic/);
  // Under Automatic, Code mode and so "only" wait for an MCP server.
  assert.match(text(codemodeView(info({ settingsPath, value: "only" }, { preference: "automatic" }))),
    /only from scripts\. Under Automatic, this waits until Code mode turns on\. Sandbox/);

  // While a mode save is on its way, both switches wait, and the Saving… line is the mode's.
  const saving = codemodeView(info({ settingsPath, value: "on" }), { view: { codemodeSave: { saving: true, error: null, target: "mode" } } });
  assert.deepEqual(modeOptions(saving).map(([, , disabled]) => disabled), [true, true]);
  assert.deepEqual(codemodeOptions(saving).map(({ disabled }) => disabled), [true, true]);
  assert.equal(decode(saving).match(/role="status"/g).length, 1);
  assert.match(text(saving), /Built-in tools Direct In scripts Saving…/);
  // Another write on its way makes the switch wait as well.
  assert.deepEqual(modeOptions(codemodeView(info({ settingsPath, value: "on" }), { view: { busy: "switch:global\0docs" } })).map(([, , disabled]) => disabled), [true, true]);

  // Each failure shows in the row its save was made from.
  const failure = { error: "Invalid settings.json: codemode must be an object", reason: "internal" };
  const modeFailed = text(codemodeView(info({ settingsPath, value: "on" }), { view: { codemodeSave: { saving: false, error: failure, target: "mode" } } }));
  assert.match(modeFailed, /Could not save the setting: Invalid settings\.json: codemode must be an object Sandbox/);
  assert.doesNotMatch(modeFailed, /Could not save the choice/);
  const choiceFailed = text(codemodeView(info({ settingsPath, value: "on" }), { view: { codemodeSave: { saving: false, error: failure, target: "preference" } } }));
  assert.doesNotMatch(choiceFailed, /Could not save the setting/);

  // A stored value that is not a mode and a project that decides for itself are said under the switch.
  const notices = text(codemodeView(info({
    settingsPath,
    value: "on",
    invalid: '"never"',
    projectOverride: { settingsPath: "/Users/me/repo/.pi/settings.json", value: "only" },
  })));
  assert.match(notices, /codemode\.mode in ~\/\.pi\/agent\/settings\.json is "never", which pi reads as "on"\. Choosing either option replaces it\./);
  assert.match(notices, /This project decides for itself: codemode\.mode in ~\/repo\/\.pi\/settings\.json has its sessions call these tools from scripts only, whatever you choose here\./);

  // An unreadable settings file offers no switch to save into it; an overview without a mode shows no row.
  const unreadable = codemodeView(info(undefined, { modeError: "Unexpected token" }));
  assert.match(text(unreadable), /Built-in tools Cannot read the global settings file: Unexpected token/);
  assert.doesNotMatch(unreadable, /aria-label="Built-in tools"/);
  assert.doesNotMatch(codemodeView(info(undefined)), /Built-in tools/);
});

test("every string the panel shows is translated", () => {
  const literal = (text) => [...text.matchAll(/\bt\("([^"]+)"/g)].map((match) => match[1]);
  const quoted = (text) => [...text.matchAll(/"((?:mcp|i18n|skills|settings)\.[\w.-]+)"/g)].map((match) => match[1]);
  const problemReasons = [...apiTypesSource.slice(
    apiTypesSource.indexOf("export type McpConfigFileProblemReason"),
    apiTypesSource.indexOf("export interface McpConfigFileProblem "),
  ).matchAll(/\| "([a-z-]+)"/g)].map((match) => match[1]);
  const reasonCodes = [...apiTypesSource.slice(
    apiTypesSource.indexOf("export type McpRefusalReason"),
    apiTypesSource.indexOf("export interface McpErrorResponse"),
  ).matchAll(/\| "([a-z-]+)"/g)].map((match) => match[1]).filter((code) => code !== "internal");
  const keys = [
    ...literal(source),
    ...quoted(source),
    ...quoted(helperSource),
    ...quoted(displaySource),
    ...problemReasons.map((reason) => `mcp.fileProblem.${reason}`),
    ...reasonCodes.map((code) => `mcp.reason.${code}`),
    "mcp.transport.stdio",
    "mcp.transport.http",
  ];
  assert.ok(literal(source).length >= 40);
  for (const key of keys) assert.equal(typeof messages[key], "string", `${key} is missing from en.ts`);
  // No English sentence is written into the markup itself.
  assert.doesNotMatch(source, />\s*[A-Z][a-z]+(?: [a-z]+){2,}[.:]?\s*</);
});

/** The selected server's exposure dropdown: its opening tag, and each option with whether it is selected. */
function exposureSelect(html) {
  const markup = decode(html);
  const match = markup.match(/(<select[^>]*class="mcp-add-input mcp-exposure-select"[^>]*>)([\s\S]*?)<\/select>/);
  assert.ok(match, "the Tools row holds the exposure dropdown");
  return {
    tag: match[1],
    options: [...match[2].matchAll(/<option value="([^"]+)"( selected="")?>([^<]*)<\/option>/g)].map(([, value, selected, label]) => ({ value, selected: Boolean(selected), label })),
  };
}

test("a server's Tools row chooses its exposure, saying in one line what each costs", () => {
  const select = exposureSelect(view({ selected: "global\0github" }));
  assert.match(select.tag, /aria-label="How github's tools reach the model"/);
  assert.doesNotMatch(select.tag, /disabled/);
  assert.deepEqual(select.options, [
    { value: "codemode", selected: true, label: "Code mode (default)" },
    { value: "deferred", selected: false, label: "tool search" },
    { value: "direct", selected: false, label: "direct" },
    { value: "hidden", selected: false, label: "hidden" },
  ]);
  // The description of the chosen exposure describes the dropdown.
  const describedBy = select.tag.match(/aria-describedby="([^"]+)"/)[1];
  assert.match(decode(view({ selected: "global\0github" })), new RegExp(`<span id="${describedBy}" class="mcp-config-line">Only the server's name and summary are listed`));
  const shown = text(view({ selected: "global\0github" }));
  assert.match(shown, /Tools Code mode \(default\) .*? Only the server's name and summary are listed; Code mode scripts search for its tools\. File/);
  assert.doesNotMatch(shown, /toolExposure/);

  // toolExposure rules are named and kept.
  const off = text(view({
    selected: "global\0github",
    load: { state: "loaded", data: overview({ servers: [{ ...httpServer, enabled: false, exposure: "deferred", toolExposureCount: 2 }] }) },
  }));
  assert.match(off, /needs no Code mode\. Rules in toolExposure \(2\) keep their own exposure\./);

  // Behind tool search, while -builtin:tool-search turns it off, only Code mode scripts reach the tools.
  const noSearch = (toolSearchDisabled) => text(view({
    selected: "global\0github",
    load: { state: "loaded", data: overview({ servers: [{ ...httpServer, exposure: "deferred" }], toolSearchDisabled }) },
  }));
  assert.match(noSearch({ settingsPath: "/Users/me/.pi/agent/settings.json" }),
    /needs no Code mode\. -builtin:tool-search in ~\/\.pi\/agent\/settings\.json turns tool search off, so these tools can be called only from Code mode scripts while Code mode is on\./);
  assert.match(noSearch({}), /-builtin:tool-search turns tool search off/);
  assert.doesNotMatch(noSearch(undefined), /tool-search/);

  // A refused entry has no exposure to choose.
  const refused = view({ selected: "global\0bad", load: { state: "loaded", data: overview({ servers: [server({ name: "bad", invalidError: "x" })] }) } });
  assert.doesNotMatch(refused, /mcp-exposure-select/);
});

test("the exposure dropdown waits like a switch, and points at why it cannot be changed", () => {
  // The group fixture's servers, validated, so each has an exposure.
  const validated = (props = {}) => writeView({
    ...props,
    data: { servers: groupOverview().servers.map((item) => ({ ...item, exposure: "codemode" })), ...props.data },
  });
  // While any change is on its way it waits; the one for this server says it is saving.
  const saving = validated({ view: { busy: "exposure:global\0docs" } });
  assert.match(exposureSelect(saving).tag, /disabled=""/);
  assert.match(decode(saving), /<span class="mcp-exposure-choice"><select[^>]*>[\s\S]*?<\/select><span role="status" class="mcp-config-line is-dim">Saving…<\/span><\/span>/);
  assert.match(exposureSelect(validated({ view: { busy: "switch:global\0pw" } })).tag, /disabled=""/);
  assert.doesNotMatch(exposureSelect(validated()).tag, /disabled/);
  // Where no change may be written, it points at the notice that says why.
  const html = validated({ data: { mcp: { available: false, reason: "operator-disabled", error: "x" } } });
  const select = exposureSelect(html);
  assert.match(select.tag, /disabled=""/);
  assert.equal(detailControls(html).note, undefined, "the notice above the list says it");
  assert.match(select.tag, new RegExp(`aria-describedby="[^"]* ${noticeIdOf(html, "MCP is off")}"`));
});

/** The id of the notice above the list that starts with `start`. */
function noticeIdOf(html, start) {
  const id = decode(html).match(new RegExp(`<div id="([^"]+)" role="status" class="config-notice[^"]*">(?:<[^>]+>)*${start}`))?.[1];
  assert.ok(id, `a notice starts with ${start}`);
  return id;
}

/** The opening tags of the selected server's Remove button and switch, and the note under them. */
function detailControls(html) {
  const markup = decode(html);
  // The note is there only when the controls cannot be used, or under -builtin:mcp.
  const actions = markup.match(/<div class="config-detail-actions">([\s\S]*?)<\/div><\/div>(?:<div id="([^"]+)" class="config-detail-heading-note">([^<]*)<\/div>)?/);
  assert.ok(actions, "the detail header holds Remove and the switch");
  const [, buttons, noteId, note] = actions;
  return {
    remove: buttons.match(/<button[^>]*class="config-button config-button-danger[^"]*"[^>]*>([^<]*)<\/button>/),
    toggle: buttons.match(/<button type="button" role="switch"[^>]*>/)?.[0],
    noteId,
    note,
  };
}

const groupOverview = (overrides = {}) => overview({
  files: [globalFile, projectFile],
  servers: [
    server({ name: "docs", transport: "http", url: "https://docs/mcp" }),
    server({ name: "pw", transport: "http", url: "https://pw/mcp", enabled: false, webPasswordField: { kind: "header", name: "Authorization" } }),
    server({ name: "repo", scope: "project", sourcePath: projectFile.path, transport: "stdio", command: "node" }),
  ],
  project: { cwd: "/Users/me/repo", trust: trusted },
  ...overrides,
});

function writeView(props = {}) {
  return view({ cwd: "/Users/me/repo", load: { state: "loaded", data: groupOverview(props.data) }, selected: "global\0docs", ...props.view });
}

test("a server's detail switches it and removes it, with no note while both work", () => {
  const { remove, toggle, note } = detailControls(writeView());
  assert.equal(remove[1], "Remove");
  assert.doesNotMatch(remove[0], /disabled/);
  assert.match(toggle, /aria-checked="true" aria-label="Turn docs off"/);
  assert.doesNotMatch(toggle, /disabled|aria-describedby/);
  assert.equal(note, undefined, "nothing to say while the controls simply work");
  // A server that is off offers to turn it on.
  const off = detailControls(writeView({ data: { servers: [server({ name: "docs", enabled: false, transport: "http", url: "https://docs/mcp" })] } }));
  assert.match(off.toggle, /aria-checked="false" aria-label="Turn docs on"/);
});

test("why a server cannot be changed is visible text its controls point at, said once", () => {
  // An untrusted project: neither control works; the trust notice above the list says why, and no note repeats it.
  const untrustedHtml = writeView({
    data: { project: { cwd: "/Users/me/repo", trust: untrusted } },
    view: { selected: "project\0repo" },
  });
  const untrustedProject = detailControls(untrustedHtml);
  assert.equal(untrustedProject.note, undefined);
  assert.match(text(untrustedHtml), /Pi Web does not change them until the project is trusted\./);
  const trustId = noticeIdOf(untrustedHtml, "This project is not trusted");
  assert.match(untrustedProject.toggle, /disabled=""/);
  assert.match(untrustedProject.toggle, new RegExp(`aria-describedby="${trustId}"`));
  assert.match(untrustedProject.remove[0], new RegExp(`disabled="" aria-describedby="${trustId}"`));
  // ...while the global servers beside it can still be changed.
  assert.doesNotMatch(detailControls(writeView({ data: { project: { cwd: "/Users/me/repo", trust: untrusted } } })).toggle, /disabled/);
  // An unreadable trust store blocks the project the same way, its own reason said above the list.
  const unreadable = writeView({ data: { project: { cwd: "/Users/me/repo", trustError: "locked" } }, view: { selected: "project\0repo" } });
  assert.equal(detailControls(unreadable).note, undefined);
  assert.match(text(unreadable), /Pi Web does not change them until it can read the trust store\./);

  // MCP off on the server: everything is read-only, and the banner says so too.
  const offHtml = writeView({ data: { mcp: { available: false, reason: "operator-disabled", error: "x" } } });
  const mcpOff = detailControls(offHtml);
  assert.equal(mcpOff.note, undefined);
  assert.match(mcpOff.toggle, /disabled=""/);
  assert.match(mcpOff.toggle, new RegExp(`aria-describedby="${noticeIdOf(offHtml, "MCP is off")}"`));
  assert.match(text(offHtml), /MCP is off: PI_WEB_DISABLE_MCP is set where Pi Web runs\. The servers are listed, but no session connects them\. Servers cannot be changed here while MCP is off\./);
  const offSwitch = decode(offHtml).match(/<span class="config-sidebar-group-count">1\/2<\/span>(<button[^>]*>)/)[1];
  const bannerId = offSwitch.match(/aria-describedby="([^"]+)"/)?.[1];
  assert.ok(bannerId, "the disabled group switch points at the banner");
  assert.match(decode(offHtml), new RegExp(`<div id="${bannerId}" role="status" class="config-notice">MCP is off`));
  // -builtin:mcp leaves the files writable: a project can turn MCP back on.
  const builtin = writeView({ data: { mcp: { available: false, reason: "builtin-disabled", error: "x", settingsPath: "/s.json" } } });
  assert.doesNotMatch(detailControls(builtin).toggle, /disabled/);
  assert.doesNotMatch(text(builtin), /cannot be changed here/);

  // An entry that references PI_WEB_PASSWORD is never turned on, but can be removed.
  const password = detailControls(writeView({ view: { selected: "global\0pw" } }));
  assert.equal(password.note, "It references PI_WEB_PASSWORD, so Pi Web does not turn it on.");
  assert.match(password.toggle, /aria-checked="false"[^>]*disabled=""/);
  assert.doesNotMatch(password.remove[0], /disabled/);
});

test("while a change is on its way every control waits, and the one in use says so", () => {
  const removing = writeView({ view: { busy: "remove:global\0docs" } });
  const controls = detailControls(removing);
  assert.equal(controls.remove[1], "Removing…");
  assert.match(controls.remove[0], /disabled=""/);
  assert.match(controls.toggle, /disabled=""/);
  assert.match(decode(removing), /<button type="button" disabled="" class="config-button config-button-secondary config-button-default">Refresh<\/button>/);
  for (const match of decode(removing).matchAll(/<button type="button" role="switch"[^>]*>/g)) assert.match(match[0], /disabled=""/);

  const switching = detailControls(writeView({ view: { busy: "switch:global\0docs" } }));
  assert.match(switching.toggle, /aria-busy="true"/);
  assert.equal(switching.remove[1], "Remove");
  // A load on its way holds the controls too, so a click acts on the listing shown.
  assert.match(detailControls(writeView({ view: { refreshing: true } })).toggle, /disabled=""/);
  // The group switch shows its own wait (on: the one server off references PI_WEB_PASSWORD).
  assert.match(decode(writeView({ view: { busy: "group:global" } })), /<span class="config-sidebar-group-count">1\/2<\/span><button type="button" role="switch" aria-checked="true" aria-busy="true"/);
});

test("a failed change is said in the server's pane with its reason, and a timeout as possibly landed", () => {
  const failed = (failure, key = "global\0docs") => decode(writeView({ view: { actionError: { key, failure } } }))
    .match(/<p role="alert" class="mcp-config-line is-error">([^<]*)<\/p>/)?.[1];
  assert.equal(failed({ error: "/x: Unexpected token", reason: "unparsable", path: "/x" }), "Could not change the server: The file is not valid JSON, so Pi Web left it unchanged.");
  assert.equal(failed({ error: "EACCES: permission denied", reason: "internal" }), "Could not change the server: EACCES: permission denied");
  assert.equal(failed({ error: "POST /api/mcp did not answer within 15000 ms", timedOut: true }),
    "Could not change the server: Pi Web did not answer in time, so the change may not have been made.");
  // Another server's failure is not shown on this one.
  assert.equal(failed({ error: "x", reason: "server-missing" }, "global\0pw"), undefined);
});

test("the group switch names what it left undone under the heading", () => {
  const html = decode(writeView({ view: { groupStatus: {
    scope: "global",
    keptOff: 1,
    failures: [{ name: "gone", failure: { error: "x", reason: "server-missing" } }, { name: "odd", failure: { error: "EIO", reason: "internal" } }],
    total: 3,
  } } }));
  const status = html.match(/<div class="config-sidebar-group-status">([\s\S]*?)<\/div><\/div>/)?.[1];
  assert.ok(status, "the status sits under the Global heading");
  assert.ok(html.indexOf("config-sidebar-group-status") > html.indexOf(">global<"));
  assert.match(status, /<div role="status" class="config-sidebar-group-note">1 server\(s\) that reference PI_WEB_PASSWORD stayed off\.<\/div>/);
  assert.match(status, /<div role="alert" class="config-sidebar-group-error">Could not change 2 of 3 servers:\ngone: The file no longer defines this server\.\nodd: EIO/);
  const whole = decode(writeView({ view: { groupStatus: { scope: "project", keptOff: 0, failures: [], total: 1, error: { error: "x", reason: "project-untrusted" } } } }));
  assert.match(whole, /<div role="alert" class="config-sidebar-group-error">Could not change the server: This project is not trusted, so Pi Web does not change its \.pi\/mcp\.json\.<\/div>/);
  assert.ok(whole.indexOf("config-sidebar-group-error") < whole.indexOf(">global<"), "under the Project heading");
});

test("a removal offers Undo until the route lets it go, and says why an undo failed", () => {
  const notice = (undo) => decode(writeView({ view: { undo: { token: "t", scope: "global", name: "lint", path: "/Users/me/.pi/agent/mcp.json", expiresInMs: 60_000, undoing: false, ...undo } } }))
    .match(/<div role="status" class="config-notice[^"]*">([\s\S]*?)<\/div>/)?.[1];
  assert.match(notice({}), /^<span class="config-notice-text">Removed lint from ~\/\.pi\/agent\/mcp\.json\.<\/span><button type="button" class="config-button config-button-secondary config-button-small">Undo<\/button>$/);
  assert.match(notice({ undoing: true }), /<button type="button" disabled="" [^>]*>Undoing…<\/button>/);
  // A name added again since keeps Undo for when it is gone; an undo that is no longer possible drops it.
  assert.match(notice({ error: { error: "x", reason: "undo-name-taken", name: "lint" } }),
    /Removed lint from ~\/\.pi\/agent\/mcp\.json\. Could not undo: The file defines a server of the same name again, so the removal was not undone\.<\/span><button[^>]*>Undo</);
  const gone = notice({ error: { error: "x", reason: "undo-unavailable" } });
  assert.match(gone, /Could not undo: The removal can no longer be undone\.$/);
  assert.doesNotMatch(gone, /<button/);
});

/** The opening tag of a group's switch, found by the n/m count in front of it. */
function groupSwitch(html, count) {
  return decode(html).match(new RegExp(`<span class="config-sidebar-group-count">${count.replace("/", "\\/")}</span>(<button[^>]*>)`))?.[1];
}

test("a group holding a server the switch never turns on can still be switched off from its heading", () => {
  // docs is on and pw, the only server off, references PI_WEB_PASSWORD: the switch reads on and
  // offers to turn the group off. Reading "every row on" kept it off for good, and each click
  // asked to turn on again and sent nothing.
  assert.match(groupSwitch(writeView(), "1/2"), /aria-checked="true" aria-label="Turn off every global server"/);
  // The count still says what the file says.
  const pwOff = server({ name: "pw", transport: "http", url: "https://pw/mcp", enabled: false, webPasswordField: { kind: "header", name: "Authorization" } });
  assert.match(
    groupSwitch(writeView({ data: { servers: [server({ name: "docs", enabled: false, transport: "http", url: "https://docs/mcp" }), pwOff] } }), "0/2"),
    /aria-checked="false" aria-label="Turn on every global server"/,
  );
  // The shared switch's click asks for the opposite of what it shows.
  const asked = [];
  const heading = ConfigSidebarGroupSwitch({ enabled: 1, total: 2, checked: true, label: "x", onChange: (next) => asked.push(next) });
  const toggle = heading.props.children[1];
  assert.equal(toggle.props.checked, true);
  toggle.type(toggle.props).props.onClick();
  assert.deepEqual(asked, [false]);
  // Without `checked` it keeps the Skills and Plugins rule.
  assert.equal(ConfigSidebarGroupSwitch({ enabled: 1, total: 2, label: "x", onChange() {} }).props.children[1].props.checked, false);
});

test("an entry that is not an object can be removed but not switched, and says so", () => {
  const junk = server({ name: "junk", notAnObject: true, invalidError: 'server "junk" must be an object' });
  const html = writeView({ data: { servers: [junk, server({ name: "docs", transport: "http", url: "https://docs/mcp" })] }, view: { selected: "global\0junk" } });
  const controls = detailControls(html);
  assert.equal(controls.note, "This entry is not an object, so it cannot be turned on or off. Remove it, or fix it in the file.");
  assert.match(controls.toggle, new RegExp(`aria-describedby="${controls.noteId}"[^>]*disabled=""`));
  assert.doesNotMatch(controls.remove[0], /disabled/);
  // It reads as on in the count, but does not hold the group switch off.
  assert.match(groupSwitch(html, "2/2"), /aria-checked="true"/);
});

test("a Code mode save and a server change never overlap", () => {
  // While the Code mode choice saves, no server control starts a change whose answer would carry
  // the choice as read before the save.
  const saving = writeView({ view: { codemodeSave: { saving: true, error: null } } });
  const controls = detailControls(saving);
  assert.match(controls.toggle, /disabled=""/);
  assert.match(controls.remove[0], /disabled=""/);
  assert.match(groupSwitch(saving, "1/2"), /disabled=""/);
  assert.match(decode(saving), /<button type="button" disabled="" class="config-button config-button-secondary config-button-default">Refresh<\/button>/);
  // While a server change runs, neither Code mode option can be chosen.
  const info = { sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" };
  assert.deepEqual(codemodeOptions(codemodeView(info, { view: { busy: "switch:global\0docs" } })).map(({ disabled }) => disabled), [true, true]);
  assert.deepEqual(codemodeOptions(codemodeView(info)).map(({ disabled }) => disabled), [false, false]);
});

test("under -builtin:mcp a change is saved, and the note says no session connects it", () => {
  const builtin = detailControls(writeView({ data: { mcp: { available: false, reason: "builtin-disabled", error: "x", settingsPath: "/s.json" } } }));
  assert.equal(builtin.note, "Changes are saved to the file, but no session connects these servers while builtin:mcp is off.");
  assert.doesNotMatch(builtin.toggle, /disabled/);
  // MCP on: no note.
  assert.equal(detailControls(writeView()).note, undefined);
});

// ---------------------------------------------------------------------------
// Test connection
// ---------------------------------------------------------------------------

/**
 * The Status row: its state label, the lines under it (what a test or a
 * session saw, why Test cannot be used) as `value` and `text`, and the Test
 * button, which sits in the detail header beside Remove.
 */
function statusRow(html) {
  const markup = decode(html);
  const row = markup.match(/<div class="config-detail-grid-label">Status<\/div><div class="config-detail-grid-value">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(row, "the detail pane has a Status row");
  const head = row.match(/^<span class="mcp-config-lines"><span class="mcp-config-state is-[a-z]+">([^<]*)<\/span>/);
  assert.ok(head, "the Status row starts with the state label");
  const value = row.slice(head[0].length);
  const actions = markup.match(/<div class="config-detail-actions">([\s\S]*?)<\/div><\/div>/)?.[1] ?? "";
  const button = actions.match(/<button([^>]*)>(Test connection|Testing…)<\/button>/);
  assert.ok(button, "the detail header holds Test");
  return { label: head[1], value, text: text(value), button: { attributes: button[1], label: button[2] } };
}

/** The span with this id, nested spans and all. */
function spanById(markup, id) {
  const start = markup.indexOf(`<span id="${id}"`);
  assert.ok(start >= 0, `a span with id ${id}`);
  let depth = 0;
  for (const match of markup.slice(start).matchAll(/<span\b|<\/span>/g)) {
    depth += match[0] === "</span>" ? -1 : 1;
    if (depth === 0) return markup.slice(start, start + match.index + match[0].length);
  }
  assert.fail(`the span with id ${id} is never closed`);
}

// The Status row shows a time alone only when it falls on the day the row
// renders (a date otherwise), so the clock stands still at 18:00 for the rest of
// the file: a run that crossed midnight would otherwise print a date. Only Date
// is mocked; timers run as usual.
mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 2, 18, 0).getTime() });

/** Today at 10:42, local time: the Status row then shows the time alone (a date only when it is not today). */
const TODAY_10_42 = new Date(Date.now()).setHours(10, 42, 0, 0);

function testedStatus(state, extra = {}) {
  return { origin: "test", state, tools: [], toolCount: 0, durationMs: 420, testedAt: TODAY_10_42, ...extra };
}

function testView(serverOverrides = {}, props = {}) {
  const tested = server({ name: "docs", transport: "http", url: "https://docs/mcp", exposure: "codemode", ...serverOverrides });
  return view({
    load: { state: "loaded", data: overview({ servers: [tested], ...(props.data ?? {}) }) },
    selected: mcpServerKey(tested),
    ...props.view,
  });
}

const { mcpServerKey } = await jiti.import("./mcp-config-helpers.ts");

test("an untested server offers Test in its header, beside Remove", () => {
  const html = testView();
  const { text: shown, button } = statusRow(html);
  assert.equal(button.label, "Test connection");
  assert.doesNotMatch(button.attributes, /disabled|aria-describedby/);
  assert.match(decode(html), /<div class="config-detail-actions"><button type="button" class="config-button config-button-secondary config-button-small">Test connection<\/button><button[^>]*class="config-button config-button-danger/);
  assert.equal(shown, "Not tested yet.");
  assert.equal(statusRow(html).label, "On");
  // A server that runs a shell command on every connection is labelled: its tests run one at a time.
  const serial = statusRow(testView({ transport: "stdio", url: undefined, command: "node", commandFields: [{ kind: "env", name: "TOKEN" }] }));
  assert.equal(serial.text, "Not tested yet. It runs a shell command, so its test waits for other such tests.");
  // An HTTP server's header command is such a command too.
  const header = statusRow(testView({ commandFields: [{ kind: "header", name: "Authorization" }] }));
  assert.match(header.text, /It runs a shell command, so its test waits/);
  // No listed tools before a test connected.
  assert.doesNotMatch(decode(testView()), /mcp-test-tools/);
});

test("a connected test shows what it listed, and the row reads connected", () => {
  const status = testedStatus("connected", {
    toolCount: 3,
    tools: [
      { name: "search", description: "Search the docs.", readOnly: true, exposure: "codemode" },
      { name: "publish", readOnly: false, exposure: "direct" },
      { name: "bidi‮tool", readOnly: false, exposure: "codemode" },
    ],
    serverInfo: { name: "docs-server", version: "2.1.0" },
    resources: true,
  });
  const html = testView({ status });
  const markup = decode(html);
  // The dot and the accessible name follow the test; connected needs no badge, as on needs none.
  assert.match(row(html, "docs"), /aria-label="docs: Connected when tested"/);
  assert.match(markup, /<button type="button" aria-label="docs: Connected when tested"[^>]*><span aria-hidden="true" class="config-status-dot is-active"><\/span><span class="config-sidebar-text is-grow">docs<\/span><\/button>/);
  const { label, value, text: shown } = statusRow(html);
  // The state is said once: what the test found follows it without its own "Connected".
  assert.equal(label, "Connected when tested");
  assert.match(value, /^<span class="mcp-config-line">3 tool\(s\) listed in 0\.4 s, tested at [^.]+\.<\/span>/);
  assert.match(shown, /Server: docs-server 2\.1\.0/);
  assert.match(shown, /Offers resources\./);
  assert.doesNotMatch(shown, /Ran in/, "an HTTP server runs in no folder");
  assert.match(text(markup), /Status Connected when tested 3 tool\(s\) listed/);
  // A server that offers no resources does not say so.
  assert.doesNotMatch(statusRow(testView({ status: { ...status, resources: undefined } })).text, /resource/);
  // The tools it listed go under the Tools row's choice, in the same row.
  const tools = markup.match(/<div class="config-detail-grid-label">Tools<\/div><div class="config-detail-grid-value">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(tools, "a Tools row");
  assert.match(tools, /<select[\s\S]*<\/select>[\s\S]*<ul class="mcp-test-tools">/);
  assert.match(tools, /<li class="mcp-test-tool"><span class="mcp-config-chips"><code class="mcp-config-chip">search<\/code><span class="mcp-test-tool-tag">read-only<\/span><\/span><span class="mcp-config-line is-dim">Search the docs\.<\/span><\/li>/);
  // A tool whose exposure differs from its server's says so; one like its server's does not.
  assert.match(tools, /<code class="mcp-config-chip">publish<\/code><span class="mcp-test-tool-tag">direct<\/span>/);
  assert.doesNotMatch(tools, /<span class="mcp-test-tool-tag">Code mode<\/span>/);
  // A tool name is the server's text: hidden characters are shown as codes.
  assert.match(tools, /bidi\\u\{202E\}tool/);
  // More tools than listed say how many are not shown.
  assert.match(text(decode(testView({ status: { ...status, toolCount: 10 } }))), /7 more not shown\./);
});

test("a stdio server's test names the folder it ran in", () => {
  const html = testView({ transport: "stdio", url: undefined, command: "node", status: testedStatus("connected", { cwd: "/srv/repo" }) });
  assert.match(statusRow(html).text, /Ran in \/srv\/repo\./);
  // Not when the Working directory row names that very folder; a relative one still gets the folder it resolved to.
  const own = testView({ transport: "stdio", url: undefined, command: "node", cwd: "/srv/repo", status: testedStatus("connected", { cwd: "/srv/repo" }) });
  assert.doesNotMatch(statusRow(own).text, /Ran in/);
  assert.match(text(decode(own)), /Working directory \/srv\/repo/);
  const relative = testView({ transport: "stdio", url: undefined, command: "node", cwd: "repo", status: testedStatus("connected", { cwd: "/srv/repo" }) });
  assert.match(statusRow(relative).text, /Ran in \/srv\/repo\./);
});

test("a failed test shows the error and stderr, a sign-in, and no answer, each with visible text", () => {
  const failed = testView({ status: testedStatus("failed", { error: "spawn lint-mcp ENOENT", stderr: "line one\nline\u0007two", durationMs: 1_250 }) });
  assert.match(row(failed, "docs"), /aria-label="docs: Did not connect when tested"/);
  assert.match(decode(failed), /<span class="mcp-sidebar-badge is-error">failed<\/span>/);
  const { label, value } = statusRow(failed);
  assert.equal(label, "Did not connect when tested");
  assert.match(value, /^<span class="mcp-config-line">Gave up after 1\.3 s, tested at/);
  assert.match(value, /<span class="mcp-config-line is-error">Error: <code class="mcp-config-chip">spawn lint-mcp ENOENT<\/code><\/span>/);
  // The stderr tail keeps its lines, and its control characters are shown as codes.
  assert.match(value, /<span class="mcp-config-line is-dim">The last lines it wrote to stderr:<\/span><pre class="mcp-test-output">line one\nline\\u\{0007\}two<\/pre>/);

  const signIn = testView({ status: testedStatus("needs-auth") });
  assert.match(row(signIn, "docs"), /aria-label="docs: Needs sign-in"/);
  assert.match(decode(signIn), /<span class="mcp-sidebar-badge is-warning">sign-in<\/span>/);
  assert.match(statusRow(signIn).value, /^<span class="mcp-config-line">The server asked for an OAuth sign-in\. Tested at/);
  // The panel's own Sign in, not a chat command, is where to sign in.
  assert.match(text(decode(signIn)), /Status Needs sign-in The server asked for an OAuth sign-in\./);
  assert.doesNotMatch(text(decode(signIn)), /for example with \/mcp/);

  const silent = statusRow(testView({ status: testedStatus("failed", { timedOut: true, durationMs: 20_000 }) }));
  assert.equal(silent.label, "Did not connect when tested");
  assert.match(silent.value, /^<span class="mcp-config-line">It did not answer within 20\.0 s, so Pi Web stopped the test\. Tested at/);

  // A test of a switched-off server is shown in its pane, but the row says what the file says.
  const off = testView({ enabled: false, status: testedStatus("connected") });
  assert.match(row(off, "docs"), /aria-label="docs: Turned off in the file"/);
  // Its label says it is off, with no sentence repeating it; the test it had keeps its own word.
  assert.equal(statusRow(off).label, "Turned off in the file");
  assert.match(statusRow(off).text, /^Connected 0 tool\(s\) listed/);
  assert.doesNotMatch(statusRow(off).text, /does not connect/);
});

test("Test is disabled where the route would refuse it, and points at the visible reason", () => {
  const reason = (html) => {
    const { value, button } = statusRow(html);
    assert.match(button.attributes, /disabled=""/);
    const id = button.attributes.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(id, "the disabled button points at its reason");
    assert.equal(value.split(`id="${id}"`).length, 2, "exactly one line of the Status row has the id");
    return text(spanById(value, id));
  };
  const untrusted = { cwd: "/Users/me/repo", trust: { requiresTrust: true, trusted: false, decision: null, inherited: false } };
  const projectServer = { scope: "project", sourcePath: "/Users/me/repo/.pi/mcp.json", transport: "stdio", url: undefined, command: "node" };
  // A reason the notice above the list already says: Test points at that notice, and the Status row stays quiet.
  const saidAbove = (html, start) => {
    const { value, button } = statusRow(html);
    assert.match(button.attributes, /disabled=""/);
    assert.match(button.attributes, new RegExp(`aria-describedby="${noticeIdOf(html, start)}"`));
    assert.doesNotMatch(text(value), /does not start|tests no server/);
  };
  saidAbove(testView(projectServer, { data: { files: [globalFile, projectFile], project: untrusted }, view: { cwd: "/Users/me/repo" } }), "This project is not trusted");
  saidAbove(testView({}, { data: { mcp: { available: false, reason: "operator-disabled", error: "x" } } }), "MCP is off");
  // A refused entry's own line says why, so Test points at it rather than a second line saying it again.
  const invalid = testView({ invalidError: "legacy SSE" });
  assert.equal(reason(invalid), "Pi refuses this entry, so it never connects: legacy SSE");
  assert.doesNotMatch(text(decode(invalid)), /nothing to test/);
  const password = testView({ webPasswordField: { kind: "header", name: "Authorization" } });
  assert.match(reason(password), /^References PI_WEB_PASSWORD\. Pi Web refuses to connect it, .* header Authorization$/);
  assert.doesNotMatch(text(decode(password)), /so Pi Web does not connect it/);
  // -builtin:mcp leaves it as an explicit action.
  const builtin = statusRow(testView({}, { data: { mcp: { available: false, reason: "builtin-disabled", error: "x", settingsPath: "/s.json" } } }));
  assert.doesNotMatch(builtin.button.attributes, /disabled/);
});

test("while a test runs its button says so, and every other control keeps working", () => {
  const key = "global\0docs";
  const html = testView({}, { view: { tests: { [key]: { running: true } } } });
  const { button } = statusRow(html);
  assert.equal(button.label, "Testing…");
  assert.match(button.attributes, /disabled="" aria-busy="true"/);
  // A test writes no file: the switch, Remove and Refresh do not wait for it.
  const controls = detailControls(html);
  assert.doesNotMatch(controls.toggle, /disabled/);
  assert.doesNotMatch(controls.remove[0], /disabled/);
  assert.match(decode(html), /<button type="button" class="config-button config-button-secondary config-button-default">Refresh<\/button>/);
  // ...and a change on its way does not hold Test either.
  assert.doesNotMatch(statusRow(testView({}, { view: { busy: "switch:global\0docs" } })).button.attributes, /disabled/);
});

test("a test request that failed says why in a test's words, and keeps the last result", () => {
  const key = "global\0docs";
  const failure = (error, extra = {}) => statusRow(testView({ status: testedStatus("connected") }, { view: { tests: { [key]: { running: false, error, ...extra } } } }));
  const refused = failure({ error: "x", reason: "project-untrusted" });
  assert.match(refused.value, /<span role="alert" class="mcp-config-line is-error">Could not test the server: This project is not trusted, so Pi Web does not start its servers\.<\/span>/);
  assert.equal(refused.label, "Connected when tested", "the last result stays");
  assert.match(refused.text, /^0 tool\(s\) listed in/);
  assert.match(failure({ error: "x", reason: "server-missing" }).text, /Could not test the server: The file no longer defines this server\./);
  assert.match(failure({ error: "EIO: i/o error", reason: "internal" }).text, /Could not test the server: EIO: i\/o error/);
  assert.match(failure({ error: "late", timedOut: true }).text, /Could not test the server: Pi Web did not answer in time\. The test may still finish; press Refresh to see its result\./);
  // A file problem reads as a test's, not as the writer's "left it unchanged".
  assert.match(failure({ error: "x", reason: "unparsable" }).text, /Could not test the server: The file is not valid JSON, so Pi Web cannot read this entry to test it\./);
  assert.match(failure({ error: "x", reason: "entry-not-object" }).text, /Could not test the server: This entry is not an object, so there is nothing to test\. Fix it in the file\./);
  // A failure about the entry before it was edited is not shown for the edited one.
  assert.doesNotMatch(failure({ error: "x", reason: "server-invalid" }, { configKey: "old-key" }).text, /Could not test/);
  assert.match(failure({ error: "x", reason: "server-invalid" }, { configKey: "key" }).text, /Could not test the server: Pi refuses this entry/);
  const queued = statusRow(testView({}, { view: { tests: { [key]: { running: false, queueTimedOut: true, configKey: "key" } } } }));
  assert.match(queued.value, /<span role="alert" class="mcp-config-line is-error">Another test of a server that runs a shell command did not finish in time, so this one did not start\. Try again\.<\/span>/);
  assert.doesNotMatch(statusRow(testView({}, { view: { tests: { [key]: { running: false, queueTimedOut: true, configKey: "old-key" } } } })).text, /did not start/);
});

test("the panel's own answer shows over the listing while it is about the entry shown", () => {
  const key = "global\0docs";
  const response = (configKey) => ({ scope: "global", name: "docs", configKey, result: { state: "failed", error: "boom", tools: [], toolCount: 0, durationMs: 10, testedAt: 5 } });
  const shown = testView({}, { view: { tests: { [key]: { running: false, response: response("key") } } } });
  assert.match(row(shown, "docs"), /aria-label="docs: Did not connect when tested"/);
  assert.equal(statusRow(shown).label, "Did not connect when tested");
  assert.match(statusRow(shown).text, /^Gave up after 0\.0 s.* Error: boom/);
  // An answer about the entry before it was edited is not this entry's.
  const stale = testView({}, { view: { tests: { [key]: { running: false, response: response("old-key") } } } });
  assert.match(statusRow(stale).text, /^Not tested yet\./);
});

// ---------------------------------------------------------------------------
// What open sessions report
// ---------------------------------------------------------------------------

function sessionStatus(state, extra = {}) {
  return { origin: "session", state, sessionId: "s1", cwd: "/Users/me/repo", updatedAt: TODAY_10_42, ...extra };
}

test("a session's report names the state in the row and says which session saw it, and when", () => {
  const connected = testView({ status: sessionStatus("connected") });
  assert.match(row(connected, "docs"), /aria-label="docs: Connected in a session"/);
  const { value, button } = statusRow(connected);
  // The session's folder, shortened as every path in the panel is.
  assert.match(value, /^<span class="mcp-config-line">A session in ~\/repo connected it at [^.]+\.<\/span>/);
  assert.match(text(decode(connected)), /Status Connected in a session A session in ~\/repo connected it/);
  // A session lists no tools for the panel; only a test does.
  assert.doesNotMatch(decode(connected), /mcp-test-tools/);
  assert.equal(button.label, "Test connection", "Test stays offered beside a session's report");

  const failed = testView({ transport: "stdio", url: undefined, command: "node", status: sessionStatus("failed", { error: "spawn lint ENOENT", stderr: "no\nconfig" }) });
  assert.match(row(failed, "docs"), /aria-label="docs: Did not connect in a session"/);
  assert.match(decode(failed), /<span class="mcp-sidebar-badge is-error">failed<\/span>/);
  const failedRow = statusRow(failed).value;
  assert.match(failedRow, /^<span class="mcp-config-line">A session in ~\/repo could not connect it at/);
  assert.match(failedRow, /<span class="mcp-config-line is-error">Error: <code class="mcp-config-chip">spawn lint ENOENT<\/code><\/span>/);
  assert.match(failedRow, /<pre class="mcp-test-output">no\nconfig<\/pre>/);
  assert.match(text(decode(failed)), /Status Did not connect in a session A session in ~\/repo could not connect it/);

  const signIn = testView({ status: sessionStatus("needs-auth") });
  assert.match(row(signIn, "docs"), /aria-label="docs: Needs sign-in"/);
  assert.match(decode(signIn), /<span class="mcp-sidebar-badge is-warning">sign-in<\/span>/);
  assert.match(statusRow(signIn).text, /^The server asked a session in ~\/repo for an OAuth sign-in at/);
  assert.match(text(decode(signIn)), /Status Needs sign-in The server asked a session in ~\/repo for an OAuth sign-in/);
});

test("a connection the session closed since reads like an untested entry, and says when it closed, with the date when not today", () => {
  const time = (ms) => new Date(ms).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
  const closedAt = TODAY_10_42 + 10 * 60_000;
  const closed = testView({ status: sessionStatus("connected", { closedAt }) });
  // No green "connected" for a connection nobody holds: the row reads on, as an untested entry does.
  assert.match(row(closed, "docs"), /aria-label="docs: On"/);
  const { label, value } = statusRow(closed);
  assert.equal(label, "On");
  // The sentence says it closed; no state word of its own repeats it.
  assert.equal(
    value.match(/^<span class="mcp-config-line">([^<]*)<\/span>/)?.[1],
    `A session in ~/repo connected it at ${time(TODAY_10_42)} and closed it at ${time(closedAt)}.`,
  );

  // A report from another day says which day.
  const yesterday = TODAY_10_42 - 24 * 60 * 60_000;
  const old = statusRow(testView({ status: sessionStatus("failed", { updatedAt: yesterday }) })).text;
  assert.ok(old.includes(`could not connect it at ${new Date(yesterday).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}.`), old);
});

test("connecting, a dropped connection and a name another extension holds each have visible words", () => {
  const connecting = testView({ status: sessionStatus("connecting") });
  assert.match(row(connecting, "docs"), /aria-label="docs: Connecting in a session"/);
  assert.match(decode(connecting), /<span class="mcp-sidebar-badge is-off">connecting<\/span>/);
  assert.match(statusRow(connecting).text, /^A session in ~\/repo started connecting it at/);

  const dropped = testView({ transport: "stdio", url: undefined, command: "node", status: sessionStatus("disconnected", { stderr: "panic: out of memory" }) });
  assert.match(row(dropped, "docs"), /aria-label="docs: Connection dropped in a session"/);
  assert.match(decode(dropped), /<span class="mcp-sidebar-badge is-warning">dropped<\/span>/);
  assert.match(statusRow(dropped).value, /^<span class="mcp-config-line">The connection of a session in ~\/repo dropped at [^.]+\.<\/span>/);
  assert.match(statusRow(dropped).value, /<pre class="mcp-test-output">panic: out of memory<\/pre>/);
  // What happens next follows what the session saw, which it does not repeat.
  assert.match(statusRow(dropped).text, /panic: out of memory That session connects it again at the next call to one of its tools\.$/);

  const taken = testView({ status: sessionStatus("conflict", { conflict: "/Users/me/.pi/agent/extensions/jira.ts" }) });
  assert.match(row(taken, "docs"), /aria-label="docs: Name taken by another extension"/);
  assert.match(decode(taken), /<span class="mcp-sidebar-badge is-error">conflict<\/span>/);
  const takenRow = statusRow(taken).value;
  assert.match(takenRow, /^<span class="mcp-config-line">A session in ~\/repo found the name taken at [^,]+, so it did not connect this entry\.<\/span>/);
  // The owner is named, the home folder shortened as everywhere in the panel.
  assert.match(takenRow, /<span class="mcp-config-line is-error">Registered first by: <code class="mcp-config-chip">~\/\.pi\/agent\/extensions\/jira\.ts<\/code><\/span>/);
  assert.match(statusRow(taken).text, /jira\.ts Rename the entry in its file, or turn the other extension off\.$/);
});

test("a session that found the project untrusted is said in the Status row, whatever the listing says now", () => {
  const data = overview({
    files: [globalFile, projectFile],
    project: { cwd: "/Users/me/repo", trust: untrusted },
    servers: [server({ name: "repo", scope: "project", sourcePath: projectFile.path, transport: "stdio", command: "node", status: sessionStatus("not-trusted") })],
  });
  const select = { selected: "project\0repo", cwd: "/Users/me/repo" };
  const still = view({ load: { state: "loaded", data }, ...select });
  assert.match(row(still, "repo"), /aria-label="repo: Project not trusted"/);
  // The state comes from the files, not the report, so the report keeps its own word.
  assert.match(statusRow(still).value, /^<span class="mcp-config-line"><span class="mcp-config-state is-warning">Not read<\/span> A session in ~\/repo did not read it at [^,]+, because no decision trusted the project then\./);
  assert.doesNotMatch(statusRow(still).text, /does not connect/, "the label says the project is not trusted");
  // Trusted since: the row reads on, since sessions read the file at their next message.
  const since = view({ load: { state: "loaded", data: { ...data, project: { cwd: "/Users/me/repo", trust: trusted } } }, ...select });
  assert.match(row(since, "repo"), /aria-label="repo: On"/);
  assert.match(statusRow(since).text, /^A session in ~\/repo did not read it at/);
});

test("a session whose /mcp is another extension's is said above the list, unless MCP is off anyway", () => {
  const hostInactive = { owner: "/Users/me/repo/.pi/extensions/mcp.ts", cwd: "/Users/me/repo", updatedAt: 1 };
  const shown = text(decode(view({ load: { state: "loaded", data: overview({ servers: [httpServer], hostInactive }) } })));
  assert.match(shown, /A session in ~\/repo connects none of these servers through Pi Web: its \/mcp command comes from ~\/repo\/\.pi\/extensions\/mcp\.ts, not from Pi's built-in MCP extension\. That extension may read mcp\.json and connect them its own way\./);
  const off = text(decode(view({
    load: { state: "loaded", data: overview({ servers: [httpServer], hostInactive, mcp: { available: false, reason: "operator-disabled", error: "x" } }) },
  })));
  assert.doesNotMatch(off, /connects none of these servers/);
});

// ---------------------------------------------------------------------------
// Signing in to an OAuth server
// ---------------------------------------------------------------------------

/** The Sign-in row's value. */
function signInRow(html) {
  const markup = decode(html);
  const start = markup.indexOf('<div class="config-detail-grid-label">Sign-in</div>');
  assert.ok(start >= 0, "the detail pane has a Sign-in row");
  const value = markup.slice(start, markup.indexOf('<div class="config-detail-grid-label">', start + 1));
  return { value, text: text(value) };
}

test("an OAuth server's pane signs in from its Sign-in row, under the Status row that asks for it", () => {
  const html = testView({ usesOAuth: true, signedIn: false, status: testedStatus("needs-auth") });
  assert.match(text(decode(html)), /Status Needs sign-in The server asked for an OAuth sign-in\./);
  const { value, text: shown } = signInRow(html);
  assert.match(value, /<button type="button" class="config-button config-button-primary config-button-small">Sign in<\/button>/);
  assert.match(shown, /Not signed in\./);

  // The panel's sign-in for the selected server is the one the row shows.
  const key = mcpServerKey({ scope: "global", name: "docs" });
  const flow = { flowId: "f1", scope: "global", name: "docs", configKey: "key", phase: "authorize", expiresInMs: 100_000, authorizationUrl: "https://auth.example/authorize?state=s" };
  const waiting = signInRow(testView({ usesOAuth: true, signedIn: false }, { view: { signIns: { [key]: { flow } } } }));
  assert.match(waiting.value, /<a href="https:\/\/auth\.example\/authorize\?state=s" target="_blank" rel="noopener noreferrer">/);
  assert.match(waiting.value, /class="oauth-paste-input"/);

  // A project nobody trusted: no sign-in, and Sign in points at the trust notice above the list, which says why.
  const blockedHtml = view({
    cwd: "/Users/me/repo",
    load: { state: "loaded", data: overview({
      files: [globalFile, projectFile],
      servers: [server({ name: "docs", scope: "project", sourcePath: projectFile.path, transport: "http", url: "https://docs/mcp", usesOAuth: true, signedIn: false })],
      project: { cwd: "/Users/me/repo", trust: untrusted },
    }) },
    selected: mcpServerKey({ scope: "project", name: "docs" }),
  });
  const blocked = signInRow(blockedHtml);
  const id = blocked.value.match(/<button type="button" disabled="" aria-describedby="([^"]+)" class="config-button config-button-primary config-button-small">Sign in<\/button>/)?.[1];
  assert.equal(id, noticeIdOf(blockedHtml, "This project is not trusted"), "Sign in is disabled and points at the reason");
  assert.doesNotMatch(blocked.text, /does not sign in/);
});

test("the connection a sign-in made is summed up as a sign-in's in the Status row", () => {
  const status = testedStatus("connected", { toolCount: 2, afterSignIn: true, tools: [{ name: "whoami", readOnly: true, exposure: "codemode" }] });
  const { value } = statusRow(testView({ usesOAuth: true, signedIn: true, status }));
  assert.match(value, /^<span class="mcp-config-line">Signed in, then 2 tool\(s\) listed in 0\.4 s, at [^.]+\.<\/span>/);
  const after = statusRow(testView({ usesOAuth: true, signedIn: true, status: testedStatus("needs-auth", { afterSignIn: true }) }));
  assert.equal(after.label, "Needs sign-in");
  assert.match(after.text, /^Signed in, but the server still asked for a sign-in at /);
});

test("a project override is listed as the global server it changes, which offers a switch for the project alone", () => {
  const cwd = "/Users/me/repo";
  const project = { cwd, trust: trusted };
  const lint = server({ ...stdioServer, exposure: "codemode" });
  const pressed = [];
  const shown = (servers, selected) => view({
    cwd,
    selected,
    load: { state: "loaded", data: overview({ files: [globalFile, projectFile], project, servers }) },
    onServerSwitchInProject: (target, enabled) => pressed.push([target.name, enabled]),
  });

  // No project entry of the name: a switch for the project alone, with one short line under it.
  const follows = text(shown([lint], "global\0lint"));
  assert.match(follows, /This project Turn off in this project Only for this project; saved in its \.pi\/mcp\.json\. File/);
  assert.match(text(shown([{ ...lint, enabled: false }], "global\0lint")), /Turn on in this project/);

  // Overridden: the global row reads as changed here, and links to the override.
  const override = server({
    ...lint,
    scope: "project",
    sourcePath: projectFile.path,
    enabled: false,
    override: { keys: ["enabled"] },
  });
  const globalRow = shown([{ ...lint, overriddenByProject: true }, override], "global\0lint");
  // Both groups list a lint: the project's first, turned off by its override, then the global one it changes.
  assert.deepEqual(
    [...decode(globalRow).matchAll(/aria-label="(lint: [^"]*)"/g)].map((match) => match[1]),
    ["lint: Turned off in the file", "lint: Changed by the project's override"],
  );
  assert.match(text(globalRow), /This project's \.pi\/mcp\.json changes its enabled\. Show/);
  assert.doesNotMatch(text(globalRow), /Turn off in this project/);

  // The override's own row: the global server's command, its own file, and what it changes.
  const overrideRow = text(shown([{ ...lint, overriddenByProject: true }, override], "project\0lint"));
  assert.match(overrideRow, /Command npx -y @acme\/lint-mcp/);
  assert.match(overrideRow, /Changes only enabled of your global server of the same name while this project is trusted\./);
  assert.match(overrideRow, /File ~?\/?.*repo\/\.pi\/mcp\.json/);
  assert.doesNotMatch(overrideRow, /This project/);
  // Untrusted, the global row has no switch for the project.
  const untrustedRow = text(view({
    cwd,
    selected: "global\0lint",
    load: { state: "loaded", data: overview({ files: [globalFile, projectFile], project: { cwd, trust: untrusted }, servers: [lint] }) },
  }));
  assert.doesNotMatch(untrustedRow, /Turn off in this project/);
});
