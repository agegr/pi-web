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
const { I18nProvider } = await jiti.import("@/hooks/useI18n.tsx");
const { McpConfig, McpConfigView } = await jiti.import("./McpConfig.tsx");
const { ConfigSidebarGroupSwitch } = await jiti.import("./SettingsUi.tsx");
const { enLocale } = await jiti.import("@/lib/i18n/messages/en.ts");
const source = await readFile(new URL("./McpConfig.tsx", import.meta.url), "utf8");
const helperSource = await readFile(new URL("./mcp-config-helpers.ts", import.meta.url), "utf8");
const displaySource = await readFile(new URL("../lib/mcp-server-display.ts", import.meta.url), "utf8");
const apiTypesSource = await readFile(new URL("../lib/api-types.ts", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const settingsUiSource = await readFile(new URL("./SettingsUi.tsx", import.meta.url), "utf8");

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
  assert.match(shown, /Transport stdio/);
  assert.match(shown, /Command npx -y @acme\/lint-mcp --api-key=••••/);
  assert.match(shown, /Working directory tools/);
  assert.match(markup, /<code class="mcp-config-chip">NODE_ENV<\/code><code class="mcp-config-chip">LINT_TOKEN<\/code>/);
  assert.match(shown, /Values are not shown here\./);
  assert.match(shown, /Shell commands Runs a shell command on every connection: env LINT_TOKEN/);
  assert.match(shown, /Tools Declared to the model directly/);
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
  assert.match(shown, /Headers Authorization Values are not shown here\./);
  assert.match(shown, /Host variables Sends environment variables of the computer running Pi Web to this server on every connection: GITHUB_TOKEN in header Authorization/);
  assert.match(shown, /Sign-in Uses its Authorization header instead of OAuth\./);
  assert.match(shown, /Tools Called from Code mode scripts, not declared to the model/);
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
  assert.match(builtinOff, /Tools Called from Code mode scripts, not declared to the model -builtin:codemode turns Code mode off, so these tools can be called only while tool search is active\./);

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
  for (const key of ["mcp.trust.trustButton", "trust.trustProject"]) assert.equal(typeof messages[key], "string", key);
});

test("the container passes Trust to the notice and reloads in place when the page's trust changes", () => {
  assert.match(source, /<ConfigTrustNotice id=\{trustNoticeId\} message=\{trustMessage\} trustLabel=\{t\("mcp\.trust\.trustButton"\)\} onTrust=\{onTrust\} \/>/);
  assert.match(source, /const onTrust = onTrustProject && mcpProjectTrustable\(data\?\.project\) \? onTrustProject : undefined;/);
  assert.match(source, /onTrustProject=\{onTrustProject\}/);
  // A new decision loads the panel again without remounting it, so the selection stays.
  assert.match(source, /const trustKey = projectTrustReloadKey\(trust\);\n\s*useEffect\(\(\) => \{\n\s*void refresh\(\);[\s\S]*?\}, \[refresh, trustKey\]\);/);
  assert.match(source, /import \{ projectTrustReloadKey \} from "\.\/settings-ui-helpers";/);
  // The container renders with the page's status and handler without fetching anything itself.
  assert.match(text(render(h(McpConfig, { cwd: "/Users/me/repo", trust: untrusted, onTrustProject() {}, onClose() {}, embedded: true }))), /Loading\.\.\./);
});

test("the notices above the list scroll in their own box, so on a phone they never squeeze the pane to nothing", () => {
  const html = decode(view({
    load: { state: "loaded", data: overview({ servers: [httpServer], hostInactive: { owner: "/ext/other-mcp.ts", cwd: "/Users/me/repo", updatedAt: 1 } }) },
    undo: { scope: "global", name: "lint", path: globalFile.path, token: "t", expiresInMs: 60_000, undoing: false },
  }));
  const notices = html.match(/<div class="mcp-config-notices">([\s\S]*?)<\/div><div class="config-split-view">/);
  assert.ok(notices, "the notices sit in one box right before the split view");
  assert.equal((notices[1].match(/role="status" class="config-notice/g) ?? []).length, 2);
  // The box shrinks and scrolls; a notice alone never shrinks below its text.
  assert.match(cssSource, /\.mcp-config-notices \{\n\s*flex: 0 1 auto;\n\s*min-height: 0;\n\s*max-height: 40vh;\n\s*overflow-y: auto;\n\}/);
  const phone = cssSource.slice(cssSource.indexOf(".mcp-config-notices {"));
  assert.match(phone, /@media \(max-width: 640px\) \{\n\s*\.mcp-config-notices \{\n\s*max-height: 30vh;\n\s*max-height: 30dvh;\n\s*\}/);
  // Short of height, the 190px phone sidebar gives way before the detail pane is clipped.
  assert.match(phone, /\.mcp-config-notices \+ \.config-split-view > \.config-sidebar \{\n\s*flex-shrink: 1;\n\s*min-height: 96px;\n\s*\}/);
  assert.match(phone, /\.mcp-config-notices \+ \.config-split-view > \.config-detail \{\n\s*min-height: 120px;\n\s*\}/);
});

test("when trusting removes Trust… under the keyboard, focus goes to the selected row", () => {
  // The dialog hands focus back to Trust… on close; the reload then removes the notice and
  // its button, and the browser drops focus to body. Only that transition moves focus, and
  // only when it fell to the page (lib/stacked-dialog.test.mjs pins focusIfLost()).
  assert.match(source, /const offersTrust = trustNotice\?\.kind === "untrusted" && onTrust !== undefined;/);
  assert.match(source, /const offeredTrustRef = useRef\(offersTrust\);\n\s*useEffect\(\(\) => \{\n\s*const offeredTrust = offeredTrustRef\.current;\n\s*offeredTrustRef\.current = offersTrust;\n\s*if \(offeredTrust && !offersTrust\) focusIfLost\(document, focusFallback\(\)\);\n\s*\}, \[offersTrust\]\);/);
  // With no row selected (the add pane is open, or the list is empty), the fallback is the Add action,
  // on screen whenever the overview has loaded.
  assert.match(source, /const focusFallback = \(\) => selectedRowRef\.current \?\? addActionRef\.current;/);
  assert.match(source, /<ConfigListAction ref=\{addActionRef\} active=\{adding\} onClick=\{onAddOpen\}>/);
  assert.match(settingsUiSource, /export function ConfigListAction\(\{ active = false, children, className, \.\.\.props \}: ButtonHTMLAttributes<HTMLButtonElement> & \{ active\?: boolean; ref\?: Ref<HTMLButtonElement> \}\) \{\n\s*return \(\n\s*<div className="config-list-action">\n\s*<button\n\s*type="button"\n\s*\{\.\.\.props\}/);
  assert.match(source, /import \{ focusAfterChange, focusIfLost \} from "@\/lib\/stacked-dialog";/);
  // The ref follows the selection: the Code mode row or a server row, whichever is selected.
  assert.match(source, /<ConfigSidebarItem\n\s*ref=\{active \? rowRef : undefined\}\n\s*active=\{active\}/);
  assert.match(source, /<ConfigSidebarItem\n\s*key=\{key\}\n\s*ref=\{selected === key \? selectedRowRef : undefined\}\n\s*active=\{selected === key\}/);
  assert.match(source, /rowRef=\{selectedRowRef\}/);
  assert.match(source, /selectedRowRef=\{selectedRowRef\}/);
  // The shared row passes the ref on to its button (a prop since React 19).
  assert.match(settingsUiSource, /export function ConfigSidebarItem\(\{[\s\S]*?\.\.\.props\n\}: ButtonHTMLAttributes<HTMLButtonElement> & \{ active\?: boolean; ref\?: Ref<HTMLButtonElement> \}\) \{\n\s*return \(\n\s*<button\n\s*type="button"\n\s*\{\.\.\.props\}/);
  // A selected row with the ref attached renders as before: the ref is not an attribute.
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

test("the Code mode pane offers Automatic and Always on, and says when a choice applies", () => {
  const automatic = codemodeView({ sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" });
  assert.deepEqual(codemodeOptions(automatic), [
    { label: "Automatic", pressed: true, disabled: false, describedBy: undefined },
    { label: "Always on", pressed: false, disabled: false, describedBy: undefined },
  ]);
  assert.match(text(automatic),
    /Mode Automatic Always on Turns on when an MCP server that uses code mode connects\. Applies only to sessions started afterwards\. Sandbox Available\./);
  assert.doesNotMatch(automatic, /role="alert"/);

  // A self-test nobody has run yet leaves Always on available and has its own wording.
  const always = codemodeView({ sandbox: { state: "not-checked" }, builtinDisabled: false, preference: "always" });
  assert.deepEqual(codemodeOptions(always).map(({ label, pressed, disabled }) => [label, pressed, disabled]), [
    ["Automatic", false, false],
    ["Always on", true, false],
  ]);
  assert.match(text(always),
    /Sessions start with Code mode on .* Sandbox Not checked yet: the self-test runs when the first session starts after Pi Web does\./);

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
  assert.doesNotMatch(down, /Applies only to sessions started/);
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
  // Unlike the PowerShell switch in General, nothing here waits for the platform.
  assert.doesNotMatch(source, /isWindows/);
  // The error line has its own color.
  assert.match(cssSource, /\.mcp-config-line\.is-error \{[\s\S]*?color: #ef4444;/);
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

test("the container starts loading and remembers the selection per project", () => {
  // Before the first answer the panel shows that it is loading.
  assert.match(text(render(h(McpConfig, { cwd: null, onClose() {}, embedded: true }))), /Loading\.\.\./);
  assert.match(source, /useState<string \| null>\(\(\) => getLastSettingsSelection\("mcp", cwd\)\)/);
  assert.match(source, /if \(selected\) setLastSettingsSelection\("mcp", selected, cwd\);/);
  assert.match(source, /setSelected\(\(current\) => pickMcpSelection\(mcpServerGroups\(result\.data, Boolean\(cwd\)\), current\)\);/);
  // A late answer from an earlier load never replaces a newer one.
  assert.match(source, /if \(request !== requestRef\.current\) return;/);
  // Two writes, both in the helpers: the Code mode choice through the tools settings route, and
  // the servers' changes through the MCP route; and the Test request, which writes no file.
  assert.doesNotMatch(source, /method:/);
  assert.deepEqual([...helperSource.matchAll(/method: "([A-Z]+)"/g)].map((match) => match[1]), ["PUT", "POST", "POST"]);
  assert.match(helperSource, /fetchImpl\("\/api\/tools\/settings", \{\n\s*method: "PUT",/);
  assert.match(helperSource, /fetchImpl\("\/api\/mcp", \{\n\s*method: "POST",/);
  assert.match(helperSource, /fetchImpl\("\/api\/mcp\/test", \{\n\s*method: "POST",/);
  assert.doesNotMatch(source, /style=\{/);
});

test("the container saves the Code mode choice, then reads back what is stored", () => {
  // Only a change is saved; the pressed option does nothing.
  assert.match(source, /onChange=\{\(value\) => \{\n\s*if \(value !== preference\) onChange\(value\);/);
  assert.match(source, /const result = await saveMcpCodemodePreference\(preference, undefined, controller\.signal\);/);
  // A save answered after the panel closed changes nothing.
  assert.match(source, /if \(saveControllerRef\.current !== controller\) return;/);
  // The stored preference is shown at once, and the overview is read again whatever the outcome:
  // a timed-out save may still land, and a refused one may mean the file changed.
  const save = source.slice(source.indexOf("const saveCodemode = useCallback"), source.indexOf("}, [refresh]);", source.indexOf("const saveCodemode")));
  assert.match(save, /withMcpCodemodePreference\(current\.data, result\.preference\)/);
  assert.match(save, /\n    void refresh\(\);\n {2}$/);
  // Nothing reloads an open session: pi applies defaultTools when it creates one.
  assert.doesNotMatch(source, /sendAgentCommand|type: "reload"/);
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

test("why a server cannot be changed is the visible note its controls point at", () => {
  // An untrusted project: neither control works, and the note says why.
  const untrustedProject = detailControls(writeView({
    data: { project: { cwd: "/Users/me/repo", trust: untrusted } },
    view: { selected: "project\0repo" },
  }));
  assert.equal(untrustedProject.note, "This project is not trusted, so Pi Web does not change its .pi/mcp.json.");
  assert.match(untrustedProject.toggle, /disabled=""/);
  assert.match(untrustedProject.remove[0], new RegExp(`disabled="" aria-describedby="${untrustedProject.noteId}"`));
  // ...while the global servers beside it can still be changed.
  assert.doesNotMatch(detailControls(writeView({ data: { project: { cwd: "/Users/me/repo", trust: untrusted } } })).toggle, /disabled/);
  // An unreadable trust store blocks the project the same way, with its own reason.
  assert.equal(
    detailControls(writeView({ data: { project: { cwd: "/Users/me/repo", trustError: "locked" } }, view: { selected: "project\0repo" } })).note,
    "Pi Web cannot read the trust store (trust.json), or another program has it locked.",
  );

  // MCP off on the server: everything is read-only, and the banner says so too.
  const offHtml = writeView({ data: { mcp: { available: false, reason: "operator-disabled", error: "x" } } });
  const mcpOff = detailControls(offHtml);
  assert.equal(mcpOff.note, "MCP is off on this Pi Web server, so it changes no server.");
  assert.match(mcpOff.toggle, /disabled=""/);
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

test("the container posts each change and shows the overview it answers with", () => {
  // One change at a time, through the helper; its answer replaces the listing.
  const run = source.slice(source.indexOf("const runAction = useCallback"), source.indexOf("const switchServer = useCallback"));
  assert.match(run, /const result = await postMcpAction\(request, writeCwd, undefined, controller\.signal\);/);
  assert.match(run, /if \(actionControllerRef\.current !== controller\) return undefined;/);
  assert.match(run, /if \(result\.ok\) applyOverview\(result\.data, select\?\.\(result\.data\)\);\n\s*else void refresh\(\);/);
  // The project is sent only when the listing covers it; a refused folder would refuse the change.
  assert.match(run, /const writeCwd = current\.state === "loaded" && current\.data\.project \? cwd : null;/);
  // A load still on its way predates the change, so its answer is dropped.
  const apply = source.slice(source.indexOf("const applyOverview = useCallback"), source.indexOf("const runAction = useCallback"));
  assert.match(apply, /requestRef\.current \+= 1;\n\s*controllerRef\.current\?\.abort\(\);\n\s*setRefreshing\(false\);/);
  // Undo selects what it put back, and its notice goes when the route lets the removal go.
  assert.match(source, /\(data\) => \(data\.restored \? mcpServerKey\(data\.restored\) : undefined\)/);
  assert.match(source, /const timer = setTimeout\(\(\) => setUndo\(\(current\) => \(current\?\.token === undoToken \? null : current\)\), undoExpiresInMs\);/);
  // The group switch leaves PI_WEB_PASSWORD entries off and reports what the route refused.
  assert.match(source, /const \{ targets, keptOff \} = mcpGroupSwitchTargets\(servers, enabled\);/);
  assert.match(source, /\{ action: "set-enabled", enabled, servers: targets\.map\(/);
  // When Remove takes the focused pane with it, focus goes to Undo; when the notice goes, to the
  // selected row; only when it fell to the page (lib/stacked-dialog.test.mjs pins focusIfLost()).
  assert.match(source, /if \(undoToken !== undefined && undoToken !== shown\) focusIfLost\(document, undoButtonRef\.current\);\n\s*else if \(shown !== undefined && undoToken === undefined\) focusIfLost\(document, focusFallback\(\)\);/);
  assert.match(source, /<ConfigButton ref=\{undoButtonRef\} size="small" onClick=\{onUndo\}/);
  assert.match(settingsUiSource, /export function ConfigButton\(\{[\s\S]*?ref\?: Ref<HTMLButtonElement> \}\) \{\n\s*return \(\n\s*<button\n\s*type="button"\n\s*\{\.\.\.props\}/);
  // Picking another server clears the last failure, which belongs to the one it was about.
  assert.match(source, /onSelect=\{\(key\) => \{\n\s*setSelected\(key\);\n\s*setActionError\(null\);/);
  // Nothing about a removed entry but its token, name and file reaches the panel's state.
  assert.match(source, /if \(removed\) setUndo\(\{ \.\.\.removed, undoing: false \}\);/);
  assert.match(apiTypesSource, /export interface McpUndoInfo extends McpServerRef \{\n\s*token: string;\n[\s\S]*?path: string;\n[\s\S]*?expiresInMs: number;\n\}/);
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
  // The panel passes its own rule to the shared switch, whose click asks for the opposite.
  assert.match(source, /const checked = mcpGroupSwitchChecked\(group\.servers\);/);
  assert.match(source, /<ConfigSidebarGroupSwitch\n\s*enabled=\{enabled\}\n\s*total=\{total\}\n\s*checked=\{checked\}/);
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
  assert.match(source, /const controlsBusy = busy !== null \|\| refreshing \|\| codemodeSave\.saving;/);
  // While a server change runs, neither Code mode option can be chosen.
  const info = { sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" };
  assert.deepEqual(codemodeOptions(codemodeView(info, { view: { busy: "switch:global\0docs" } })).map(({ disabled }) => disabled), [true, true]);
  assert.deepEqual(codemodeOptions(codemodeView(info)).map(({ disabled }) => disabled), [false, false]);
  assert.match(source, /serverBusy=\{busy !== null\}/);
});

test("under -builtin:mcp a change is saved, and the note says no session connects it", () => {
  const builtin = detailControls(writeView({ data: { mcp: { available: false, reason: "builtin-disabled", error: "x", settingsPath: "/s.json" } } }));
  assert.equal(builtin.note, "Changes are saved to the file, but no session connects these servers while builtin:mcp is off.");
  assert.doesNotMatch(builtin.toggle, /disabled/);
  // MCP on: no note.
  assert.equal(detailControls(writeView()).note, undefined);
  assert.match(source, /savedWhileOff=\{!data\.mcp\.available && !writesOff\}/);
});

test("focus goes back to the control a change was started from once nothing waits", () => {
  // Each handler notes the focused button before the change disables it, and hands it back once
  // answered; a removal or an undo that worked leaves focus to Undo and to the restored row.
  const handler = (name, next) => source.slice(source.indexOf(`const ${name} = useCallback`), source.indexOf(`const ${next} = useCallback`));
  for (const [name, next] of [["switchServer", "removeServer"], ["removeServer", "undoRemoval"], ["switchGroup", "McpConfigView"]]) {
    const body = next === "McpConfigView" ? source.slice(source.indexOf(`const ${name} = useCallback`), source.indexOf("useEffect(() => {\n    if (selected)")) : handler(name, next);
    assert.match(body, /const pressed = pressedButton\(\);/, name);
    assert.match(body, /setFocusBack\(\{ control: pressed \}\);/, name);
  }
  const remove = handler("removeServer", "undoRemoval");
  assert.match(remove, /if \(!result\.ok\) \{\n\s*setActionError\(\{ key, failure: result\.error \}\);\n\s*setFocusBack\(\{ control: pressed \}\);\n\s*return;\n\s*\}/);
  const undo = source.slice(source.indexOf("const undoRemoval = useCallback"), source.indexOf("// The notice goes when the route lets the removal go."));
  assert.match(undo, /const pressed = pressedButton\(\);/);
  assert.match(undo, /if \(!result\.ok\) setFocusBack\(\{ control: pressed \}\);/);
  // The view waits until no change, save or load holds the controls, handles each request once, and
  // falls back to the selected row (lib/stacked-dialog.test.mjs pins focusAfterChange()). It comes
  // after the Undo effects, so a fallback never takes focus from Undo.
  // A change that took its control away with its pane (an Add that worked) goes straight to the row.
  assert.match(source, /useEffect\(\(\) => \{\n\s*if \(!focusBack \|\| controlsBusy \|\| handledFocusBackRef\.current === focusBack\) return;\n\s*handledFocusBackRef\.current = focusBack;\n\s*if \(focusBack\.toSelectedRow\) focusIfLost\(document, focusFallback\(\)\);\n\s*else focusAfterChange\(document, focusBack\.control, focusFallback\(\)\);\n\s*\}, \[focusBack, controlsBusy\]\);/);
  assert.ok(source.indexOf("focusAfterChange(document") > source.indexOf("focusIfLost(document, undoButtonRef.current)"));
  assert.match(source, /focusBack=\{focusBack\}/);
});

// ---------------------------------------------------------------------------
// Test connection
// ---------------------------------------------------------------------------

/** The Connection row's value, and the Test button, which sits in the detail header beside Remove. */
function connection(html) {
  const markup = decode(html);
  const value = markup.match(/<div class="config-detail-grid-label">Connection<\/div><div class="config-detail-grid-value">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(value, "the detail pane has a Connection row");
  const actions = markup.match(/<div class="config-detail-actions">([\s\S]*?)<\/div><\/div>/)?.[1] ?? "";
  const button = actions.match(/<button([^>]*)>(Test connection|Testing…)<\/button>/);
  assert.ok(button, "the detail header holds Test");
  return { value, text: text(value), button: { attributes: button[1], label: button[2] } };
}

// The Connection row shows a time alone only when it falls on the day the row
// renders (a date otherwise), so the clock stands still at 18:00 for the rest of
// the file: a run that crossed midnight would otherwise print a date. Only Date
// is mocked; timers run as usual.
mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 2, 18, 0).getTime() });

/** Today at 10:42, local time: the Connection row then shows the time alone (a date only when it is not today). */
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
  const { text: shown, button } = connection(html);
  assert.equal(button.label, "Test connection");
  assert.doesNotMatch(button.attributes, /disabled|aria-describedby/);
  assert.match(decode(html), /<div class="config-detail-actions"><button type="button" class="config-button config-button-secondary config-button-small">Test connection<\/button><button[^>]*class="config-button config-button-danger/);
  assert.equal(shown, "Not tested yet.");
  // A server that runs a shell command on every connection is labelled: its tests run one at a time.
  const serial = connection(testView({ transport: "stdio", url: undefined, command: "node", commandFields: [{ kind: "env", name: "TOKEN" }] }));
  assert.equal(serial.text, "Not tested yet. It runs a shell command, so its test waits for other such tests.");
  // An HTTP server's header command is such a command too.
  const header = connection(testView({ commandFields: [{ kind: "header", name: "Authorization" }] }));
  assert.match(header.text, /It runs a shell command, so its test waits/);
  // No listed tools before a test connected.
  assert.doesNotMatch(decode(testView()), />Listed tools</);
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
    resources: 4,
    resourceTemplates: 1,
  });
  const html = testView({ status });
  const markup = decode(html);
  // The dot and the accessible name follow the test; connected needs no badge, as on needs none.
  assert.match(row(html, "docs"), /aria-label="docs: Connected when tested"/);
  assert.match(markup, /<button type="button" aria-label="docs: Connected when tested"[^>]*><span aria-hidden="true" class="config-status-dot is-active"><\/span><span class="config-sidebar-text is-grow">docs<\/span><\/button>/);
  const { value, text: shown } = connection(html);
  assert.match(value, /<span class="mcp-config-state is-on">Connected<\/span> 3 tool\(s\) listed in 0\.4 s, tested at [^.]+\./);
  assert.match(shown, /Server: docs-server 2\.1\.0/);
  assert.match(shown, /4 resource\(s\) and 1 resource template\(s\)\./);
  assert.doesNotMatch(shown, /Ran in/, "an HTTP server runs in no folder");
  // The Connection row right under it says what the test found; the Status row adds no sentence.
  assert.match(text(markup), /Status Connected when tested Connection Connected/);
  const tools = markup.match(/<div class="config-detail-grid-label">Listed tools<\/div><div class="config-detail-grid-value">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(tools, "a Listed tools row");
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
  assert.match(connection(html).text, /Ran in \/srv\/repo\./);
});

test("a failed test shows the error and stderr, a sign-in, and no answer, each with visible text", () => {
  const failed = testView({ status: testedStatus("failed", { error: "spawn lint-mcp ENOENT", stderr: "line one\nline\u0007two", durationMs: 1_250 }) });
  assert.match(row(failed, "docs"), /aria-label="docs: Did not connect when tested"/);
  assert.match(decode(failed), /<span class="mcp-sidebar-badge is-error">failed<\/span>/);
  const { value } = connection(failed);
  assert.match(value, /<span class="mcp-config-state is-error">Did not connect<\/span> Gave up after 1\.3 s, tested at/);
  assert.match(value, /<span class="mcp-config-line is-error">Error: <code class="mcp-config-chip">spawn lint-mcp ENOENT<\/code><\/span>/);
  // The stderr tail keeps its lines, and its control characters are shown as codes.
  assert.match(value, /<span class="mcp-config-line is-dim">The last lines it wrote to stderr:<\/span><pre class="mcp-test-output">line one\nline\\u\{0007\}two<\/pre>/);

  const signIn = testView({ status: testedStatus("needs-auth") });
  assert.match(row(signIn, "docs"), /aria-label="docs: Needs sign-in"/);
  assert.match(decode(signIn), /<span class="mcp-sidebar-badge is-warning">sign-in<\/span>/);
  assert.match(connection(signIn).value, /<span class="mcp-config-state is-warning">Needs sign-in<\/span> The server asked for an OAuth sign-in\. Tested at/);
  // The panel's own Sign in, not a chat command, is where to sign in.
  assert.match(text(decode(signIn)), /Status Needs sign-in Connection Needs sign-in The server asked for an OAuth sign-in\./);
  assert.doesNotMatch(text(decode(signIn)), /for example with \/mcp/);

  const silent = connection(testView({ status: testedStatus("failed", { timedOut: true, durationMs: 20_000 }) }));
  assert.match(silent.value, /<span class="mcp-config-state is-error">No answer<\/span> It did not answer within 20\.0 s, so Pi Web stopped the test\. Tested at/);

  // A test of a switched-off server is shown in its pane, but the row says what the file says.
  const off = testView({ enabled: false, status: testedStatus("connected") });
  assert.match(row(off, "docs"), /aria-label="docs: Turned off in the file"/);
  assert.match(connection(off).text, /^Connected/);
});

test("Test is disabled where the route would refuse it, and points at the visible reason", () => {
  const reason = (html) => {
    const { value, button } = connection(html);
    assert.match(button.attributes, /disabled=""/);
    const id = button.attributes.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(id, "the disabled button points at its reason");
    return value.match(new RegExp(`<span id="${id}" class="mcp-config-line is-dim">([^<]*)</span>`))?.[1];
  };
  const untrusted = { cwd: "/Users/me/repo", trust: { requiresTrust: true, trusted: false, decision: null, inherited: false } };
  const projectServer = { scope: "project", sourcePath: "/Users/me/repo/.pi/mcp.json", transport: "stdio", url: undefined, command: "node" };
  assert.equal(
    reason(testView(projectServer, { data: { files: [globalFile, projectFile], project: untrusted }, view: { cwd: "/Users/me/repo" } })),
    "This project is not trusted, so Pi Web does not start its servers.",
  );
  assert.equal(
    reason(testView({}, { data: { mcp: { available: false, reason: "operator-disabled", error: "x" } } })),
    "MCP is off on this Pi Web server, so it tests no server.",
  );
  assert.equal(reason(testView({ invalidError: "legacy SSE" })), "Pi refuses this entry, so there is nothing to test.");
  assert.equal(
    reason(testView({ webPasswordField: { kind: "header", name: "Authorization" } })),
    "It references PI_WEB_PASSWORD, so Pi Web does not connect it.",
  );
  // -builtin:mcp leaves it as an explicit action.
  const builtin = connection(testView({}, { data: { mcp: { available: false, reason: "builtin-disabled", error: "x", settingsPath: "/s.json" } } }));
  assert.doesNotMatch(builtin.button.attributes, /disabled/);
});

test("while a test runs its button says so, and every other control keeps working", () => {
  const key = "global\0docs";
  const html = testView({}, { view: { tests: { [key]: { running: true } } } });
  const { button } = connection(html);
  assert.equal(button.label, "Testing…");
  assert.match(button.attributes, /disabled="" aria-busy="true"/);
  // A test writes no file: the switch, Remove and Refresh do not wait for it.
  const controls = detailControls(html);
  assert.doesNotMatch(controls.toggle, /disabled/);
  assert.doesNotMatch(controls.remove[0], /disabled/);
  assert.match(decode(html), /<button type="button" class="config-button config-button-secondary config-button-default">Refresh<\/button>/);
  // ...and a change on its way does not hold Test either.
  assert.doesNotMatch(connection(testView({}, { view: { busy: "switch:global\0docs" } })).button.attributes, /disabled/);
});

test("a test request that failed says why in a test's words, and keeps the last result", () => {
  const key = "global\0docs";
  const failure = (error, extra = {}) => connection(testView({ status: testedStatus("connected") }, { view: { tests: { [key]: { running: false, error, ...extra } } } }));
  const refused = failure({ error: "x", reason: "project-untrusted" });
  assert.match(refused.value, /<span role="alert" class="mcp-config-line is-error">Could not test the server: This project is not trusted, so Pi Web does not start its servers\.<\/span>/);
  assert.match(refused.text, /^Connected/, "the last result stays");
  assert.match(failure({ error: "x", reason: "server-missing" }).text, /Could not test the server: The file no longer defines this server\./);
  assert.match(failure({ error: "EIO: i/o error", reason: "internal" }).text, /Could not test the server: EIO: i\/o error/);
  assert.match(failure({ error: "late", timedOut: true }).text, /Could not test the server: Pi Web did not answer in time\. The test may still finish; press Refresh to see its result\./);
  // A file problem reads as a test's, not as the writer's "left it unchanged".
  assert.match(failure({ error: "x", reason: "unparsable" }).text, /Could not test the server: The file is not valid JSON, so Pi Web cannot read this entry to test it\./);
  assert.match(failure({ error: "x", reason: "entry-not-object" }).text, /Could not test the server: This entry is not an object, so there is nothing to test\. Fix it in the file\./);
  // A failure about the entry before it was edited is not shown for the edited one.
  assert.doesNotMatch(failure({ error: "x", reason: "server-invalid" }, { configKey: "old-key" }).text, /Could not test/);
  assert.match(failure({ error: "x", reason: "server-invalid" }, { configKey: "key" }).text, /Could not test the server: Pi refuses this entry/);
  const queued = connection(testView({}, { view: { tests: { [key]: { running: false, queueTimedOut: true, configKey: "key" } } } }));
  assert.match(queued.value, /<span role="alert" class="mcp-config-line is-error">Another test of a server that runs a shell command did not finish in time, so this one did not start\. Try again\.<\/span>/);
  assert.doesNotMatch(connection(testView({}, { view: { tests: { [key]: { running: false, queueTimedOut: true, configKey: "old-key" } } } })).text, /did not start/);
});

test("the panel's own answer shows over the listing while it is about the entry shown", () => {
  const key = "global\0docs";
  const response = (configKey) => ({ scope: "global", name: "docs", configKey, result: { state: "failed", error: "boom", tools: [], toolCount: 0, durationMs: 10, testedAt: 5 } });
  const shown = testView({}, { view: { tests: { [key]: { running: false, response: response("key") } } } });
  assert.match(row(shown, "docs"), /aria-label="docs: Did not connect when tested"/);
  assert.match(connection(shown).text, /^Did not connect/);
  // An answer about the entry before it was edited is not this entry's.
  const stale = testView({}, { view: { tests: { [key]: { running: false, response: response("old-key") } } } });
  assert.match(connection(stale).text, /^Not tested yet\./);
});

test("the container tests one server at a time each, beside any change, and gives focus back", () => {
  const body = source.slice(source.indexOf("const testServer = useCallback"), source.indexOf("// A change answers with the overview read after it"));
  assert.match(body, /if \(testRequestsRef\.current\.has\(key\)\) return;/);
  assert.match(body, /const testCwd = current\.state === "loaded" && current\.data\.project \? cwd : null;/);
  // No signal: neither the panel closing nor its deadline aborts a test, since the route stops a
  // test nobody waits for and records nothing.
  assert.match(body, /const result = await postMcpTest\(\{ scope: server\.scope, name: server\.name \}, testCwd\);/);
  assert.doesNotMatch(body, /abort/);
  assert.match(source, /testRequests\.clear\(\);/);
  assert.doesNotMatch(source, /testControllers/);
  assert.match(body, /if \(testRequestsRef\.current\.get\(key\) !== request\) return;/);
  assert.match(body, /setTests\(\(runs\) => \(\{ \.\.\.runs, \[key\]: mcpTestRunAfter\(runs\[key\], result, server\.configKey\) \}\)\);/);
  // A refusal, or a test of other content than the listing shows, loads the listing again.
  assert.match(body, /if \(mcpTestAnswerOutdates\(result, listed\)\) void refresh\(\);/);
  // A test sets no `busy`, so no other control waits for it.
  assert.doesNotMatch(body, /setBusy/);
  // The view shows the panel's own answers over the listing, and a failure only for the entry it was about.
  assert.match(source, /const data = load\.state === "loaded" \? mcpWithTestResults\(load\.data, tests\) : undefined;/);
  assert.match(source, /test=\{mcpTestRunFor\(tests\[mcpServerKey\(selectedServer\)\], selectedServer\)\}/);
  // Test is disabled while it runs, which drops focus to the page; it gets it back from there only.
  assert.match(source, /if \(wasRunning && !running\) focusIfLost\(document, buttonRef\.current\);/);
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
  const { value, button } = connection(connected);
  // The session's folder, shortened as every path in the panel is.
  assert.match(value, /<span class="mcp-config-state is-on">Connected<\/span> A session in ~\/repo connected it at [^.]+\./);
  assert.match(text(decode(connected)), /Status Connected in a session Connection Connected A session in ~\/repo connected it/);
  // A session lists no tools for the panel; only a test does.
  assert.doesNotMatch(decode(connected), />Listed tools</);
  assert.equal(button.label, "Test connection", "Test stays offered beside a session's report");

  const failed = testView({ transport: "stdio", url: undefined, command: "node", status: sessionStatus("failed", { error: "spawn lint ENOENT", stderr: "no\nconfig" }) });
  assert.match(row(failed, "docs"), /aria-label="docs: Did not connect in a session"/);
  assert.match(decode(failed), /<span class="mcp-sidebar-badge is-error">failed<\/span>/);
  const failedRow = connection(failed).value;
  assert.match(failedRow, /<span class="mcp-config-state is-error">Did not connect<\/span> A session in ~\/repo could not connect it at/);
  assert.match(failedRow, /<span class="mcp-config-line is-error">Error: <code class="mcp-config-chip">spawn lint ENOENT<\/code><\/span>/);
  assert.match(failedRow, /<pre class="mcp-test-output">no\nconfig<\/pre>/);
  assert.match(text(decode(failed)), /Status Did not connect in a session Connection Did not connect/);

  const signIn = testView({ status: sessionStatus("needs-auth") });
  assert.match(row(signIn, "docs"), /aria-label="docs: Needs sign-in"/);
  assert.match(decode(signIn), /<span class="mcp-sidebar-badge is-warning">sign-in<\/span>/);
  assert.match(connection(signIn).text, /^Needs sign-in The server asked a session in ~\/repo for an OAuth sign-in at/);
  assert.match(text(decode(signIn)), /Status Needs sign-in Connection Needs sign-in The server asked a session in ~\/repo for an OAuth sign-in/);
});

test("a connection the session closed since reads like an untested entry, and says when it closed, with the date when not today", () => {
  const time = (ms) => new Date(ms).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
  const closedAt = TODAY_10_42 + 10 * 60_000;
  const closed = testView({ status: sessionStatus("connected", { closedAt }) });
  // No green "connected" for a connection nobody holds: the row reads on, as an untested entry does.
  assert.match(row(closed, "docs"), /aria-label="docs: On"/);
  assert.match(text(decode(closed)), /Status On Sessions connect it before their next message\./);
  const { value } = connection(closed);
  assert.equal(
    value.match(/<span class="mcp-config-line"><span class="mcp-config-state is-off">Closed<\/span> ([^<]*)<\/span>/)?.[1],
    `A session in ~/repo connected it at ${time(TODAY_10_42)}, and closed that connection at ${time(closedAt)}, when the session went idle, ended or reloaded.`,
  );

  // A report from another day says which day.
  const yesterday = TODAY_10_42 - 24 * 60 * 60_000;
  const old = connection(testView({ status: sessionStatus("failed", { updatedAt: yesterday }) })).text;
  assert.ok(old.includes(`could not connect it at ${new Date(yesterday).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}.`), old);
});

test("connecting, a dropped connection and a name another extension holds each have visible words", () => {
  const connecting = testView({ status: sessionStatus("connecting") });
  assert.match(row(connecting, "docs"), /aria-label="docs: Connecting in a session"/);
  assert.match(decode(connecting), /<span class="mcp-sidebar-badge is-off">connecting<\/span>/);
  assert.match(connection(connecting).text, /^Connecting A session in ~\/repo started connecting it at/);

  const dropped = testView({ transport: "stdio", url: undefined, command: "node", status: sessionStatus("disconnected", { stderr: "panic: out of memory" }) });
  assert.match(row(dropped, "docs"), /aria-label="docs: Connection dropped in a session"/);
  assert.match(decode(dropped), /<span class="mcp-sidebar-badge is-warning">dropped<\/span>/);
  assert.match(connection(dropped).value, /<span class="mcp-config-state is-warning">Dropped<\/span> The connection of a session in ~\/repo dropped at [^.]+\./);
  assert.match(connection(dropped).value, /<pre class="mcp-test-output">panic: out of memory<\/pre>/);
  assert.match(text(decode(dropped)), /That session connects it again at the next call to one of its tools\./);

  const taken = testView({ status: sessionStatus("conflict", { conflict: "/Users/me/.pi/agent/extensions/jira.ts" }) });
  assert.match(row(taken, "docs"), /aria-label="docs: Name taken by another extension"/);
  assert.match(decode(taken), /<span class="mcp-sidebar-badge is-error">conflict<\/span>/);
  const takenRow = connection(taken).value;
  assert.match(takenRow, /<span class="mcp-config-state is-error">Name taken<\/span> A session in ~\/repo found the name taken at [^,]+, so it did not connect this entry\./);
  // The owner is named, the home folder shortened as everywhere in the panel.
  assert.match(takenRow, /<span class="mcp-config-line is-error">Registered first by: <code class="mcp-config-chip">~\/\.pi\/agent\/extensions\/jira\.ts<\/code><\/span>/);
  assert.match(text(decode(taken)), /Rename the entry in its file, or turn the other extension off\./);
});

test("a session that found the project untrusted is said in the Connection row, whatever the listing says now", () => {
  const data = overview({
    files: [globalFile, projectFile],
    project: { cwd: "/Users/me/repo", trust: untrusted },
    servers: [server({ name: "repo", scope: "project", sourcePath: projectFile.path, transport: "stdio", command: "node", status: sessionStatus("not-trusted") })],
  });
  const select = { selected: "project\0repo", cwd: "/Users/me/repo" };
  const still = view({ load: { state: "loaded", data }, ...select });
  assert.match(row(still, "repo"), /aria-label="repo: Project not trusted"/);
  assert.match(connection(still).value, /<span class="mcp-config-state is-warning">Not read<\/span> A session in ~\/repo did not read it at [^,]+, because no decision trusted the project then\./);
  // Trusted since: the row reads on, since sessions read the file at their next message.
  const since = view({ load: { state: "loaded", data: { ...data, project: { cwd: "/Users/me/repo", trust: trusted } } }, ...select });
  assert.match(row(since, "repo"), /aria-label="repo: On"/);
  assert.match(connection(since).text, /^Not read A session in/);
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

test("an OAuth server's pane signs in from its Sign-in row, under the Connection row that asks for it", () => {
  const html = testView({ usesOAuth: true, signedIn: false, status: testedStatus("needs-auth") });
  assert.match(text(decode(html)), /Connection Needs sign-in The server asked for an OAuth sign-in\./);
  const { value, text: shown } = signInRow(html);
  assert.match(value, /<button type="button" class="config-button config-button-primary config-button-small">Sign in<\/button>/);
  assert.match(shown, /Not signed in\./);

  // The panel's sign-in for the selected server is the one the row shows.
  const key = mcpServerKey({ scope: "global", name: "docs" });
  const flow = { flowId: "f1", scope: "global", name: "docs", configKey: "key", phase: "authorize", expiresInMs: 100_000, authorizationUrl: "https://auth.example/authorize?state=s" };
  const waiting = signInRow(testView({ usesOAuth: true, signedIn: false }, { view: { signIns: { [key]: { flow } } } }));
  assert.match(waiting.value, /<a href="https:\/\/auth\.example\/authorize\?state=s" target="_blank" rel="noopener noreferrer">/);
  assert.match(waiting.value, /class="oauth-paste-input"/);

  // A project nobody trusted: no sign-in, and the reason is visible.
  const blocked = signInRow(view({
    cwd: "/Users/me/repo",
    load: { state: "loaded", data: overview({
      files: [globalFile, projectFile],
      servers: [server({ name: "docs", scope: "project", sourcePath: projectFile.path, transport: "http", url: "https://docs/mcp", usesOAuth: true, signedIn: false })],
      project: { cwd: "/Users/me/repo", trust: untrusted },
    }) },
    selected: mcpServerKey({ scope: "project", name: "docs" }),
  }));
  const id = blocked.value.match(/<button type="button" disabled="" aria-describedby="([^"]+)" class="config-button config-button-primary config-button-small">Sign in<\/button>/)?.[1];
  assert.ok(id, "Sign in is disabled and points at the reason");
  assert.match(blocked.value, new RegExp(`<span id="${id}" class="mcp-config-line is-dim">This project is not trusted`));
  assert.match(blocked.text, /This project is not trusted, so Pi Web does not sign in to or out of its servers\./);
});

test("the connection a sign-in made is summed up as a sign-in's in the Connection row", () => {
  const status = testedStatus("connected", { toolCount: 2, afterSignIn: true, tools: [{ name: "whoami", readOnly: true, exposure: "codemode" }] });
  const { value } = connection(testView({ usesOAuth: true, signedIn: true, status }));
  assert.match(value, /<span class="mcp-config-state is-on">Connected<\/span> Signed in, then 2 tool\(s\) listed in 0\.4 s, at [^.]+\./);
  const after = connection(testView({ usesOAuth: true, signedIn: true, status: testedStatus("needs-auth", { afterSignIn: true }) }));
  assert.match(after.text, /^Needs sign-in Signed in, but the server still asked for a sign-in at /);
});

test("the container starts, polls, pastes into and cancels a sign-in, and signs out as a change", () => {
  const body = (name, end) => source.slice(source.indexOf(`const ${name} = useCallback`), source.indexOf(end, source.indexOf(`const ${name} = useCallback`)));
  const start = body("startSignIn", "}, [cwd, refresh]);");
  // As for Test: the project only when the listing covers it, and no signal, since the flow lives on the server.
  assert.match(start, /const signInCwd = listing\.state === "loaded" && listing\.data\.project \? cwd : null;/);
  assert.match(start, /const result = await postMcpSignIn\(\{ scope: server\.scope, name: server\.name \}, signInCwd\);/);
  assert.doesNotMatch(start, /abort|signal/);
  // A press while one starts or runs does nothing: the route would only join it.
  assert.match(start, /if \(current\?\.starting \|\| mcpSignInActive\(current\)\) return;/);
  // A refusal may mean the listing is out of date.
  assert.match(start, /if \(!result\.ok && result\.error\.reason !== undefined && !result\.error\.timedOut\) void refresh\(\);/);
  // Polling: about once a second while a flow runs, aborted only as the panel goes; a flow that ended reloads the overview.
  assert.match(source, /const result = await getMcpSignIn\(flowId, undefined, controller\.signal\);/);
  assert.match(source, /\}, MCP_SIGN_IN_POLL_MS\);/);
  assert.match(source, /if \(Object\.keys\(signIns\)\.some\(\(key\) => mcpSignInJustEnded\(previous\[key\], signIns\[key\]\)\)\) void refresh\(\);/);
  assert.match(body("pasteSignIn", "}, []);"), /const result = await pasteMcpSignIn\(flowId, value\);/);
  assert.match(body("cancelSignIn", "}, []);"), /const result = await cancelMcpSignInFlow\(flowId\);/);
  // Sign out writes mcp-auth.json through POST /api/mcp, as one more change the controls wait for.
  const signOut = body("signOut", "}, [runAction]);");
  assert.match(signOut, /await runAction\(\{ action: "sign-out", scope: server\.scope, name: server\.name \}, `sign-out:\$\{key\}`\);/);
  assert.match(signOut, /setFocusBack\(\{ control: pressed \}\);/);
  // One that worked drops this panel's own test answers, kept and on their way, which would read
  // Connected over the entry the route just forgot (components/mcp-config-helpers.test.mjs).
  assert.match(signOut, /if \(result\.ok\) \{\n\s*const now = Date\.now\(\);\n\s*setTests\(\(runs\) => \{\n\s*const next = mcpTestRunAfterSignOut\(runs\[key\], now\);/);
  assert.match(source, /\[key\]: \{ \.\.\.runs\[key\], running: true, startedAt: Date\.now\(\),/);
  assert.match(source, /signingOut=\{busy === `sign-out:\$\{key\}`\}/);
  // Closing the panel lets sign-ins go, never cancels them: Sign in joins one again.
  const unmount = source.slice(source.indexOf("const testRequests = testRequestsRef.current;"), source.indexOf("}, []);", source.indexOf("const testRequests = testRequestsRef.current;")));
  assert.match(unmount, /mountedRef\.current = false;/);
  assert.doesNotMatch(unmount, /SignIn|signIns/);
});
