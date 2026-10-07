// A minimal MCP server for tests: newline-delimited JSON-RPC over stdio with
// `initialize`, `tools/list` and `tools/call`. Its tools report what the server
// process sees, so tests can check the environment pi-web starts it with.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

// The names in the environment it started with, for tests that check it without calling a tool.
if (process.env.PI_WEB_FIXTURE_ENV_FILE) {
  writeFileSync(process.env.PI_WEB_FIXTURE_ENV_FILE, JSON.stringify(Object.keys(process.env)));
}
// Its pid, for tests that check it exits once the client closes.
if (process.env.PI_WEB_FIXTURE_PID_FILE) writeFileSync(process.env.PI_WEB_FIXTURE_PID_FILE, String(process.pid));

// A server that cannot start: it says why on stderr and exits before answering.
if (process.env.PI_WEB_FIXTURE_FAIL) {
  process.stderr.write(`${process.env.PI_WEB_FIXTURE_FAIL}\n`);
  process.exit(1);
}

const STANDARD_TOOLS = [
  {
    name: "env_has",
    description: "Whether the server's environment defines a variable.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "env_get",
    description: "The value of a variable in the server's environment, or null.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "spawn_child",
    description: "Start a long-running child process and return its pid.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    // No annotations: a tool its server does not mark read-only, without side effects.
    name: "record",
    description: "Return the note it was given.",
    inputSchema: { type: "object", properties: { note: { type: "string" } } },
  },
];

// With PI_WEB_FIXTURE_ODD_TOOLS, tools whose fields other than `name` and
// `inputSchema` are not what the spec says (pi-mcp checks only those two), and
// names that are Object.prototype members.
const ODD_TOOLS = [
  { name: "numbered", description: 42, title: { text: "no" }, inputSchema: { type: "object" }, annotations: "read-only" },
  { name: "constructor", title: "Builds things\nsecond line", inputSchema: { type: "object" }, annotations: { title: 7, readOnlyHint: "yes" } },
  { name: "toString", description: null, inputSchema: { type: "object" }, annotations: null },
];
const TOOLS = process.env.PI_WEB_FIXTURE_ODD_TOOLS ? ODD_TOOLS : STANDARD_TOOLS;

// With PI_WEB_FIXTURE_INIT_ERROR, `initialize` fails with that text repeated
// until the message is over 100,000 characters, as a server's oversized error.
const INIT_ERROR = process.env.PI_WEB_FIXTURE_INIT_ERROR;

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function toolResult(structuredContent) {
  return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
}

function callTool(name, args = {}) {
  switch (name) {
    case "env_has":
      return toolResult({ has: Object.hasOwn(process.env, args.name) });
    case "env_get":
      return toolResult({ value: process.env[args.name] ?? null });
    case "record":
      return toolResult({ recorded: args.note ?? null });
    case "spawn_child": {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      child.unref();
      return toolResult({ pid: child.pid });
    }
    default:
      return undefined;
  }
}

function answer(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "pi-web-env-fixture", version: "1.0.0" },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return callTool(params.name, params.arguments);
    default:
      return undefined;
  }
}

function handle({ id, method, params = {} }) {
  if (id === undefined) return; // notifications need no answer
  if (INIT_ERROR && method === "initialize") {
    send({ id, error: { code: -32603, message: INIT_ERROR.repeat(Math.ceil(100_000 / INIT_ERROR.length)) } });
    return;
  }
  const result = answer(method, params);
  if (result) send({ id, result });
  else send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  if (line.trim()) handle(JSON.parse(line));
});
// MCP stdio shutdown: the client closes stdin and the server exits.
input.on("close", () => process.exit(0));
