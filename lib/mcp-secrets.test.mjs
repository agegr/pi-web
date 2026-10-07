import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  SECRET_MASK,
  argSecretParts,
  commandSecretParts,
  isReferenceOnly,
  isSecretName,
  literalSecretFields,
  looksLikeSecretValue,
  maskArgs,
  maskCommand,
  maskUrl,
  urlSecretParts,
} = await jiti.import("./mcp-secrets.ts");

const M = SECRET_MASK;

test("names that hold a credential, however they are spelled", () => {
  for (const name of [
    "OPENAI_API_KEY",
    "apiKey",
    "x-api-key",
    "X-API-Key",
    "GITHUB_PERSONAL_ACCESS_TOKEN",
    "accessToken",
    "GITHUBTOKEN",
    "client_secret",
    "DB_PASSWORD",
    "Authorization",
    "Cookie",
    "GITHUB_PAT",
    "token",
  ]) {
    assert.equal(isSecretName(name), true, name);
  }
  for (const name of [
    "API_KEY_FILE",
    "TOKEN_URL",
    "AWS_ACCESS_KEY_ID",
    "PRIVATE_KEY_PATH",
    "keyboard",
    "monkey",
    "TOKENIZER_PATH",
    "PORT",
    "DEBUG",
    "OAUTH_CLIENT_ID",
    "Content-Type",
    "path",
  ]) {
    assert.equal(isSecretName(name), false, name);
  }
});

test("values that look like keys or tokens, and the ones that do not", () => {
  for (const value of [
    "sk-proj-abcdefghijklmnopqrstuvwx",
    "sk-ant-api03-abcdefghijklmnop",
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "github_pat_11ABCDEFG0123456789_abcdefghijk",
    "xoxb-1234567890-abcdefghij",
    "AKIAIOSFODNN7EXAMPLE",
    "glpat-abcdefghijklmnopqrst",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk",
    "a8F3kL9qZx2Vb7Nm4Pw6Ry1Tc5Hd0Gs",
    "4f9d2c7e8b1a6f3d0c5e9b2a7d4f1c8e6b3a0d9f",
  ]) {
    assert.equal(looksLikeSecretValue(value), true, value);
  }
  for (const value of [
    "-y",
    "@modelcontextprotocol/server-filesystem",
    "/Users/me/projects/my-project-2024",
    "./dist/index.js",
    "~/servers/mcp-server-12345678.js",
    "server-filesystem",
    "mcp-server-postgres-2024-10-01",
    "1.2.3",
    "${GITHUB_TOKEN}",
    "postgresql://localhost/db",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
    "a long sentence with spaces in it 12345",
  ]) {
    assert.equal(looksLikeSecretValue(value), false, value);
  }
});

test("a value made only of references names where the secret lives", () => {
  for (const value of ["${TOKEN}", "$TOKEN", "Bearer ${TOKEN}", "${USER}:${PASS}"]) {
    assert.equal(isReferenceOnly(value), true, value);
  }
  for (const value of ["", "Bearer ", "Bearer abc", "abc${TOKEN}", "$$TOKEN", "plain"]) {
    assert.equal(isReferenceOnly(value), false, value);
  }
});

test("URLs keep everything but their credentials, character for character", () => {
  assert.deepEqual(maskUrl("https://mcp.example.com/mcp"), { value: "https://mcp.example.com/mcp", masked: false });
  assert.deepEqual(
    maskUrl("https://user:hunter2@mcp.example.com/mcp"),
    { value: `https://${M}@mcp.example.com/mcp`, masked: true },
  );
  assert.deepEqual(
    maskUrl("https://ghp_abcdefghijklmnopqrstuvwxyz0123@mcp.example.com/"),
    { value: `https://${M}@mcp.example.com/`, masked: true },
    "a token used as the user name",
  );
  assert.deepEqual(
    maskUrl("https://mcp.example.com/mcp?api_key=abc&region=eu&token=xyz#frag"),
    { value: `https://mcp.example.com/mcp?api_key=${M}&region=eu&token=${M}#frag`, masked: true },
  );
  assert.deepEqual(
    maskUrl("https://store.example.com/x?X-Amz-Signature=abc123&X-Amz-Credential=AKID%2F2024&sig=s&code=k&auth=a"),
    {
      value: `https://store.example.com/x?X-Amz-Signature=${M}&X-Amz-Credential=${M}&sig=${M}&code=${M}&auth=${M}`,
      masked: true,
    },
  );
  assert.deepEqual(
    maskUrl("https://mcp.example.com/mcp?id=a8F3kL9qZx2Vb7Nm4Pw6Ry1Tc5Hd0Gs"),
    { value: `https://mcp.example.com/mcp?id=${M}`, masked: true },
    "a value that looks like a token, whatever its name",
  );
  assert.deepEqual(
    maskUrl("https://actions.example.com/mcp/sk-ak-abcdefghijklmnopqrstuvwx/sse"),
    { value: `https://actions.example.com/mcp/${M}/sse`, masked: true },
    "a key in the path",
  );
  assert.deepEqual(
    maskUrl("https://mcp.example.com/mcp?KEY=${MCP_KEY}"),
    { value: "https://mcp.example.com/mcp?KEY=${MCP_KEY}", masked: false },
    "a reference is not a secret",
  );
  assert.equal(maskUrl("not a url?token=abc").value, `not a url?token=${M}`, "a string that is not a URL is masked too");
  assert.deepEqual(
    maskUrl("https://mcp.example.com/mcp?ghp_abcdefghijklmnopqrstuvwxyz0123456789&debug"),
    { value: `https://mcp.example.com/mcp?${M}&debug`, masked: true },
    "a bare key in the query string",
  );
  assert.deepEqual(maskUrl("https://mcp.example.com/mcp?debug&verbose#/route/x"), {
    value: "https://mcp.example.com/mcp?debug&verbose#/route/x",
    masked: false,
  });
  assert.equal(maskUrl("https://mcp.example.com/mcp?pw=hunter2").value, `https://mcp.example.com/mcp?pw=${M}`);
  assert.deepEqual(
    maskUrl("https://${USER}:${PASS}@mcp.example.com/mcp"),
    { value: "https://${USER}:${PASS}@mcp.example.com/mcp", masked: false },
    "placeholders as the userinfo",
  );
});

test("a value of several words is masked word by word, its whitespace kept", () => {
  assert.deepEqual(
    maskCommand("npx -y @acme/server --api-key sk-proj-abcdefghijklmnopqrstuvwxyz0123"),
    { value: `npx -y @acme/server --api-key ${M}`, masked: true },
    "a whole command line in command",
  );
  assert.deepEqual(maskCommand("  npx   -y  server "), { value: "  npx   -y  server ", masked: false });
  assert.deepEqual(maskCommand("C:\\Program Files\\nodejs\\node.exe"), { value: "C:\\Program Files\\nodejs\\node.exe", masked: false });
  assert.deepEqual(maskArgs(["--auth-header", "Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789"]), {
    args: ["--auth-header", `Bearer ${M}`],
    masked: true,
  });
  assert.deepEqual(maskArgs(["--header", "Authorization", "Bearer hunter2"]), {
    args: ["--header", "Authorization", `Bearer ${M}`],
    masked: true,
  });
  assert.deepEqual(maskArgs(["-c", "curl -H Authorization: Basic dXNlcjpwYXNz https://x.example"]), {
    args: ["-c", `curl -H Authorization: Basic ${M} https://x.example`],
    masked: true,
  });
  assert.deepEqual(maskArgs(["-c", "exec server --token ghp_abcdefghijklmnopqrstuvwxyz0123456789 --port 80"]), {
    args: ["-c", `exec server --token ${M} --port 80`],
    masked: true,
  });
  assert.deepEqual(maskArgs(["--header", "Authorization: Bearer ${AUTH_TOKEN}", "-c", "exec server --token $GITHUB_TOKEN"]), {
    args: ["--header", "Authorization: Bearer ${AUTH_TOKEN}", "-c", "exec server --token $GITHUB_TOKEN"],
    masked: false,
  });
});

test("command, args and url are used as written, so only placeholder-shaped values name a secret", () => {
  // The SDK expands nothing there: `$Passw0rd` is a password that starts with `$`.
  assert.deepEqual(maskArgs(["--password", "$Passw0rd", "--token", "${TOKEN}", "--key", "$API_KEY"]), {
    args: ["--password", M, "--token", "${TOKEN}", "--key", "$API_KEY"],
    masked: true,
  });
  assert.deepEqual(maskArgs(["--api-key=$hunter2"]), { args: [`--api-key=${M}`], masked: true });
  // Where the SDK resolves a value, `$name` is a reference whatever its case.
  assert.equal(isReferenceOnly("$token"), true);
});

test("connection strings and --auth values are masked", () => {
  assert.deepEqual(maskArgs(["--connection-string", "Server=db;User ID=sa;Password=hunter2;Database=app"]), {
    args: ["--connection-string", `Server=db;User ID=sa;Password=${M};Database=app`],
    masked: true,
  });
  assert.deepEqual(
    maskArgs(["DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=abc==;EndpointSuffix=core.windows.net"]),
    { args: [`DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=${M};EndpointSuffix=core.windows.net`], masked: true },
  );
  assert.deepEqual(maskArgs(["a;b", "x=1;y=2"]), { args: ["a;b", "x=1;y=2"], masked: false });
  assert.deepEqual(maskArgs(["--auth", "user:hunter2", "--basic-auth=user:hunter2"]), {
    args: ["--auth", M, `--basic-auth=${M}`],
    masked: true,
  });
  assert.deepEqual(maskArgs(["--header", "Cookie: a=b; session=hunter2"]), { args: ["--header", `Cookie: ${M}`], masked: true });
});

test("arguments mask flag values, headers, pairs, URLs and bare tokens", () => {
  assert.deepEqual(maskArgs(["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/src"]), {
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/src"],
    masked: false,
  });
  assert.deepEqual(maskArgs(["--api-key=abc123", "--token", "xyz", "-k", "secret-value", "--port", "8080"]), {
    args: [`--api-key=${M}`, "--token", M, "-k", M, "--port", "8080"],
    masked: true,
  });
  assert.deepEqual(maskArgs(["--token", "--verbose"]), { args: ["--token", "--verbose"], masked: false });
  assert.deepEqual(maskArgs(["--token", "${TOKEN}", "--api-key=${KEY}"]), {
    args: ["--token", "${TOKEN}", "--api-key=${KEY}"],
    masked: false,
  });
  assert.deepEqual(
    maskArgs(["mcp-remote", "https://mcp.example.com/sse?token=abc", "--header", "Authorization: Bearer abc", "--header", "Authorization:${AUTH}"]),
    {
      args: ["mcp-remote", `https://mcp.example.com/sse?token=${M}`, "--header", `Authorization: ${M}`, "--header", "Authorization:${AUTH}"],
      masked: true,
    },
  );
  assert.deepEqual(maskArgs(["GITHUB_TOKEN=ghp_x", "DEBUG=1", "--url=https://u:p@h/"]), {
    args: [`GITHUB_TOKEN=${M}`, "DEBUG=1", `--url=https://${M}@h/`],
    masked: true,
  });
  assert.deepEqual(maskArgs(["serve", "a8F3kL9qZx2Vb7Nm4Pw6Ry1Tc5Hd0Gs"]), { args: ["serve", M], masked: true });
  assert.deepEqual(maskArgs(["C:\\Program Files\\server.exe"]), { args: ["C:\\Program Files\\server.exe"], masked: false });
  assert.deepEqual(maskCommand("npx"), { value: "npx", masked: false });
});

test("what a mask hides can be listed, raw and percent-decoded, to find it again in other text", () => {
  assert.deepEqual(urlSecretParts("https://mcp.example.com/mcp"), []);
  assert.deepEqual(urlSecretParts("https://user:hunter2@mcp.example.com/mcp?api_key=a%2Bb&region=eu"), [
    "user:hunter2",
    "hunter2",
    "a%2Bb",
    "a+b",
  ]);
  assert.deepEqual(urlSecretParts("https://actions.example.com/mcp/sk-ak-abcdefghijklmnopqrstuvwx/sse?ghp_abcdefghijklmnopqrstuvwxyz0123456789"), [
    "sk-ak-abcdefghijklmnopqrstuvwx",
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  ]);
  // A reference names where the secret lives and is not hidden.
  assert.deepEqual(urlSecretParts("https://mcp.example.com/mcp?KEY=${MCP_KEY}"), []);
  assert.deepEqual(argSecretParts(["--api-key=abc123", "--token", "xyz", "--header", "Authorization: Bearer abc", "--url=https://u:p@h/", "--port", "8080"]), [
    "abc123",
    "xyz",
    "Bearer abc",
    "u:p",
    "p",
  ]);
  assert.deepEqual(argSecretParts(["--token", "${TOKEN}"]), []);
  assert.deepEqual(commandSecretParts("server --token=abc123 --verbose"), ["abc123"]);
  assert.deepEqual(commandSecretParts("GITHUB_TOKEN=ghp_x"), ["ghp_x"]);
  assert.deepEqual(commandSecretParts("npx"), []);
});

test("literal secrets are the credentials written into the entry itself", () => {
  assert.deepEqual(literalSecretFields({ command: "npx", args: ["-y", "server"], env: { DEBUG: "1", PORT: "80" } }), []);
  assert.deepEqual(
    literalSecretFields({
      command: "npx",
      env: { GITHUB_TOKEN: "ghp_literal", FROM_ENV: "${GITHUB_TOKEN}", COMPUTED: "!op read x", DEBUG: "a8F3kL9qZx2Vb7Nm4Pw6Ry1Tc5Hd0Gs" },
    }),
    [{ kind: "env", name: "GITHUB_TOKEN" }, { kind: "env", name: "DEBUG" }],
  );
  assert.deepEqual(
    literalSecretFields({
      url: "https://mcp.example.com/mcp?key=abc",
      headers: { Authorization: "Bearer abc", "X-Ref": "Bearer ${TOKEN}", Accept: "application/json", "X-Custom": "Token xyz" },
      oauth: { clientSecret: "literal" },
    }),
    [
      { kind: "header", name: "Authorization" },
      { kind: "header", name: "X-Custom" },
      { kind: "oauth-client-secret" },
      { kind: "url" },
    ],
  );
  assert.deepEqual(literalSecretFields({ url: "https://x.example/", oauth: { clientSecret: "${SECRET}" } }), []);
  assert.deepEqual(literalSecretFields({ command: "server", args: ["--api-key", "abc"] }), [{ kind: "args" }]);
  assert.deepEqual(literalSecretFields({ command: "server", env: "not an object", args: [1, "--token=x"] }), [{ kind: "args" }]);
  assert.deepEqual(
    literalSecretFields({ command: "npx", args: ["--auth-header", "Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789"] }),
    [{ kind: "args" }],
  );
  assert.deepEqual(
    literalSecretFields({ command: "npx -y server --api-key sk-proj-abcdefghijklmnopqrstuvwxyz0123" }),
    [{ kind: "command" }],
  );
  assert.deepEqual(
    literalSecretFields({
      command: "server",
      env: { OPTIONS: "--token ghp_abcdefghijklmnopqrstuvwxyz0123456789", FROM_ENV: "--token ${TOKEN}", LOWER: "--token $tok" },
    }),
    [{ kind: "env", name: "OPTIONS" }],
    "a token inside a value of several words; resolved references of either spelling are not",
  );
  assert.deepEqual(literalSecretFields(null), []);
});
