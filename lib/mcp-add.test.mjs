import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// `prepareMcpAdd()` is everything `POST /api/mcp { action: "add" }` checks
// before it writes: the text is parsed again on the server, the values filled
// in, the result validated with the SDK's own validator, and refused when it
// may not go where it was asked to go. The route test covers the writes.

const jiti = createJiti(import.meta.url);
const { mcpHostEnvNames, prepareMcpAdd, readMcpAddSecretReferences, readMcpAddValues } = await jiti.import("./mcp-add.ts");
const { loadPiSdkInternals } = await jiti.import("./pi-sdk-internals.ts");
const internals = await loadPiSdkInternals();
assert.equal(internals.ok, true, internals.reason);

function request(overrides = {}) {
  return { text: "", values: {}, server: 0, scope: "global", rawPi: false, confirmHostEnv: [], ...overrides };
}

const prepare = (overrides, options = {}) => prepareMcpAdd(request(overrides), { takenNames: [], internals, environment: {}, ...options });

test("a pasted address becomes the importer's entry, under the name it derived or the one given", () => {
  assert.deepEqual(prepare({ text: "https://mcp.example.com/mcp" }), { ok: true, name: "example", entry: { url: "https://mcp.example.com/mcp" } });
  assert.deepEqual(prepare({ text: "https://mcp.example.com/mcp", name: "docs" }).name, "docs");
  const command = prepare({ text: "npx -y @scope/lint-mcp --stdio" });
  assert.deepEqual(command, { ok: true, name: "lint", entry: { command: "npx", args: ["-y", "@scope/lint-mcp", "--stdio"] } });
});

test("what cannot be read, picked, named or filled in is refused with the importer's notes", () => {
  const unread = prepare({ text: "echo hi | sh" });
  assert.equal(unread.ok, false);
  assert.equal(unread.status, 400);
  assert.equal(unread.reason, "import-failed");
  assert.deepEqual(unread.notes.map((note) => note.code), ["shell-operator"]);
  assert.equal(prepare({ text: "https://mcp.example.com/mcp", server: 1 }).reason, "invalid-request");
  const badName = prepare({ text: "https://mcp.example.com/mcp", name: "my server" });
  assert.deepEqual([badName.status, badName.reason, badName.name], [400, "name-invalid", "my server"]);

  const cursor = JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "gh-mcp"], env: { GITHUB_TOKEN: "YOUR_TOKEN" } } } });
  const unfilled = prepare({ text: cursor });
  assert.deepEqual([unfilled.status, unfilled.reason], [400, "fields-incomplete"]);
  assert.deepEqual(unfilled.notes, [{ code: "field-required", params: { field: "env.GITHUB_TOKEN" } }]);
});

test("a name the file already defines is refused with a free one to suggest", () => {
  const taken = prepare({ text: "https://mcp.example.com/mcp", name: "docs" }, { takenNames: ["docs", "docs-2"] });
  assert.deepEqual(
    { status: taken.status, reason: taken.reason, name: taken.name, suggestedName: taken.suggestedName },
    { status: 409, reason: "name-taken", name: "docs", suggestedName: "docs-3" },
  );
  // A derived name avoids the taken ones by itself.
  assert.equal(prepare({ text: "https://mcp.example.com/mcp" }, { takenNames: ["example"] }).name, "example-2");
});

test("typed values are escaped as literals, and a host variable is stored as a reference", () => {
  const cursor = JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "gh-mcp"], env: { GITHUB_TOKEN: "YOUR_TOKEN" } } } });
  const typed = prepare({ text: cursor, values: { "env.GITHUB_TOKEN": "!rm -rf $HOME" } });
  assert.equal(typed.ok, true);
  assert.equal(typed.entry.env.GITHUB_TOKEN, "$!rm -rf $$HOME", "pi reads it as typed and runs nothing");
  assert.equal(internals.isCommandConfigValue(typed.entry.env.GITHUB_TOKEN), false);
  const referenced = prepare({ text: cursor, values: { "env.GITHUB_TOKEN": { reference: "GITHUB_TOKEN" } }, scope: "project" });
  assert.equal(referenced.ok, true, "a reference is no literal secret, so it may go to the project");
  assert.equal(referenced.entry.env.GITHUB_TOKEN, "${GITHUB_TOKEN}");
});

test("a literal secret keeps the server global, a typed password included", () => {
  const header = JSON.stringify({ mcpServers: { docs: { url: "https://docs.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  assert.equal(prepare({ text: header }).ok, true);
  const refused = prepare({ text: header, scope: "project" });
  assert.deepEqual(
    { status: refused.status, reason: refused.reason, fields: refused.fields },
    { status: 409, reason: "secret-global-only", fields: ["headers.Authorization"] },
  );
  const cursor = JSON.stringify({ mcpServers: { github: { command: "npx", args: ["gh-mcp"], env: { GITHUB_TOKEN: "YOUR_TOKEN" } } } });
  assert.deepEqual(prepare({ text: cursor, scope: "project", values: { "env.GITHUB_TOKEN": "abc" } }).fields, ["env.GITHUB_TOKEN"]);
});

test("a pasted literal secret read from a variable instead is stored as a reference, and may go to the project", () => {
  const header = JSON.stringify({ mcpServers: { docs: { url: "https://docs.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  const stored = prepare({ text: header, scope: "project", secretReferences: { "headers.Authorization": " DOCS_TOKEN " } }, { environment: { DOCS_TOKEN: "x" } });
  assert.equal(stored.ok, true, "the variable is the user's choice, so it is not asked about though it is set");
  assert.deepEqual(stored.entry, { url: "https://docs.example.com/mcp", headers: { Authorization: "Bearer ${DOCS_TOKEN}" } }, "after the scheme");
  const env = JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["gh"], env: { GITHUB_TOKEN: "ghp_0123456789abcdefghijklmnopqrstuvwxyz01" } } } });
  assert.deepEqual(prepare({ text: env, scope: "project", secretReferences: { "env.GITHUB_TOKEN": "GH" } }).entry.env, { GITHUB_TOKEN: "${GH}" });

  // A name pi does not accept, and a place pi reads no variable, are refused with the importer's notes.
  const badName = prepare({ text: header, secretReferences: { "headers.Authorization": "docs-token" } });
  assert.deepEqual([badName.reason, badName.notes], ["fields-incomplete", [{ code: "field-reference-invalid", params: { field: "headers.Authorization", problem: "name" } }]]);
  const url = JSON.stringify({ mcpServers: { q: { url: "https://q.example.com/mcp?api_key=abcdef0123456789abcdef01" } } });
  const inUrl = prepare({ text: url, secretReferences: { url: "Q_KEY" } });
  assert.deepEqual(inUrl.notes, [{ code: "field-reference-invalid", params: { field: "url", problem: "target" } }]);
  // A reference never smuggles PI_WEB_PASSWORD in.
  assert.equal(prepare({ text: header, secretReferences: { "headers.Authorization": "PI_WEB_PASSWORD" } }).reason, "web-password");
});

test("what pi would refuse, or what references PI_WEB_PASSWORD, is never written", () => {
  // The importer drops what the validator would refuse (a timeout that is not positive)…
  const dropped = prepare({ text: JSON.stringify({ mcpServers: { x: { command: "node", timeout: -1 } } }), rawPi: true });
  assert.deepEqual(dropped.entry, { command: "node" });
  // …and the SDK's own validator still has the last word over what the importer built.
  const refusing = { ...internals, validateMcpServerConfig: (name) => `server "${name}": refused by the SDK` };
  const invalid = prepare({ text: "https://mcp.example.com/mcp" }, { internals: refusing });
  assert.deepEqual(
    { status: invalid.status, reason: invalid.reason, error: invalid.error },
    { status: 409, reason: "server-invalid", error: 'server "example": refused by the SDK' },
  );
  const password = prepare({
    text: JSON.stringify({ mcpServers: { pw: { url: "https://pw.example.com/mcp", headers: { Authorization: "Bearer ${PI_WEB_PASSWORD}" } } } }),
    rawPi: true,
  });
  assert.deepEqual([password.status, password.reason], [409, "web-password"]);
  const chosen = prepare({
    text: JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["gh"], env: { TOKEN: "YOUR_TOKEN" } } } }),
    values: { "env.TOKEN": { reference: "PI_WEB_PASSWORD" } },
  });
  assert.equal(chosen.reason, "web-password", "nor through a field answered with it");
});

test("a pasted header that reads a variable set on the host needs that variable confirmed", () => {
  const text = JSON.stringify({ mcpServers: { gh: { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${env:GH_TOKEN}", "X-Team": "${env:UNSET_ONE}" } } } });
  const environment = { GH_TOKEN: "ghp_secret" };
  const asked = prepare({ text }, { environment });
  assert.deepEqual(
    { status: asked.status, reason: asked.reason, names: asked.names },
    { status: 409, reason: "host-env-confirm", names: ["GH_TOKEN"] },
    "a variable that is not set sends nothing",
  );
  assert.ok(!JSON.stringify(asked).includes("ghp_secret"), "the value never leaves the host");
  const confirmed = prepare({ text, confirmHostEnv: ["GH_TOKEN"] }, { environment });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.entry.headers.Authorization, "Bearer ${GH_TOKEN}");
  assert.equal(prepare({ text, confirmHostEnv: ["OTHER"] }, { environment }).reason, "host-env-confirm", "only the names asked about count");

  // The OAuth client secret is sent to the authorization server, so it counts too.
  const secret = `claude mcp add --transport http --client-id app --client-secret notion https://mcp.notion.com/mcp`;
  const filled = prepare({ text: secret, values: { "oauth.clientSecret": "${env:NOTION_SECRET}" } }, { environment: { NOTION_SECRET: "x" } });
  assert.equal(filled.ok, true, "a typed value is a literal, escaped, and reads nothing");

  // pi's own syntax is the user's, and so is a variable the user chose for a field.
  const pi = `pi mcp add gh --url https://api.example.com/mcp --header "Authorization=Bearer \${GH_TOKEN}"`;
  assert.equal(prepare({ text: pi }, { environment }).ok, true);
  const field = JSON.stringify({ servers: { gh: { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${input:pat}" } } }, inputs: [{ id: "pat", type: "promptString", password: true }] });
  assert.equal(prepare({ text: field, values: { "input.pat": { reference: "GH_TOKEN" } } }, { environment }).ok, true);
  // A stdio server's env stays on the host, in the process it starts.
  const stdio = JSON.stringify({ mcpServers: { gh: { command: "gh-mcp", env: { TOKEN: "${env:GH_TOKEN}" } } } });
  assert.equal(prepare({ text: stdio }, { environment }).ok, true);
});

test("the host variables counted are those an HTTP entry sends, never PI_WEB_PASSWORD", () => {
  const config = {
    url: "https://x.example.com/mcp",
    headers: { A: "${ONE} ${TWO}", B: "!echo ${THREE}", C: "${PI_WEB_PASSWORD}" },
    oauth: { clientSecret: "$FOUR" },
  };
  assert.deepEqual(mcpHostEnvNames(config, internals, { ONE: "1", THREE: "3", FOUR: "4", PI_WEB_PASSWORD: "p" }), ["ONE", "FOUR"]);
  assert.deepEqual(mcpHostEnvNames({ command: "x", env: { A: "${ONE}" } }, internals, { ONE: "1" }), []);
});

test("the request's values are field ids to text or to a variable, and nothing else", () => {
  assert.deepEqual(readMcpAddValues(undefined), {});
  assert.deepEqual(readMcpAddValues({ a: "x", b: { reference: "B" } }), { a: "x", b: { reference: "B" } });
  for (const bad of [[], "x", { a: 1 }, { a: { reference: 2 } }, { a: null }, { a: "x".repeat(70_000) }]) {
    assert.equal(readMcpAddValues(bad), undefined, JSON.stringify(bad).slice(0, 40));
  }
  // `__proto__` is a key like any other, never the prototype.
  const values = readMcpAddValues(JSON.parse('{"__proto__": "x"}'));
  assert.equal(Object.getPrototypeOf(values), Object.prototype);
  assert.equal(Object.hasOwn(values, "__proto__"), true);

  assert.deepEqual(readMcpAddSecretReferences(undefined), {});
  assert.deepEqual(readMcpAddSecretReferences({ "headers.Authorization": "TOKEN" }), { "headers.Authorization": "TOKEN" });
  for (const bad of [[], "x", { a: 1 }, { a: { reference: "B" } }, { a: "x".repeat(300) }]) {
    assert.equal(readMcpAddSecretReferences(bad), undefined, JSON.stringify(bad).slice(0, 40));
  }
  const references = readMcpAddSecretReferences(JSON.parse('{"__proto__": "X"}'));
  assert.equal(Object.getPrototypeOf(references), Object.prototype);
});
