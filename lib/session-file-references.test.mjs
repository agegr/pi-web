import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./session-file-references-core.ts");
}

test("detects exact external file paths referenced in session entries", async () => {
  const { isFilePathReferencedByEntries } = await loadSubject();
  const entries = [
    {
      type: "message",
      id: "entry-1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "See [/home/me/.codex/config.toml:12](/home/me/.codex/config.toml:12)",
          },
        ],
      },
    },
  ];

  assert.equal(isFilePathReferencedByEntries("/home/me/.codex/config.toml", entries), true);
});

test("does not authorize sibling files by prefix match", async () => {
  const { isFilePathReferencedByEntries } = await loadSubject();
  const entries = [
    {
      type: "message",
      id: "entry-1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "See /home/me/.codex/config.toml.bak",
          },
        ],
      },
    },
  ];

  assert.equal(isFilePathReferencedByEntries("/home/me/.codex/config.toml", entries), false);
});

function messageEntry(message, id = "entry-1") {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message,
  };
}

function toolResult(toolName, text, extra = {}) {
  return messageEntry({
    role: "toolResult",
    toolCallId: "call-1",
    toolName,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 1,
    ...extra,
  });
}

const OUTSIDE_PATH = "/home/me/.ssh/id_ed25519";

test("does not authorize paths from transcript system messages", async () => {
  const { isFilePathReferencedByEntries } = await loadSubject();
  const entries = [
    messageEntry({
      role: "system",
      content: `Context file: ${OUTSIDE_PATH}`,
      sections: { tools: `read accepts a path such as ${OUTSIDE_PATH}` },
      toolsAdded: [{ name: "read", description: `Example: ${OUTSIDE_PATH}` }],
      timestamp: 1,
    }),
  ];

  assert.equal(isFilePathReferencedByEntries(OUTSIDE_PATH, entries), false);
});

test("does not authorize paths from MCP, codemode or extension tool result text", async () => {
  const { isFilePathReferencedByEntries } = await loadSubject();

  for (const toolName of ["mcp__files__list", "codemode", "web_search", "mcp", undefined]) {
    const entries = [toolResult(toolName, `found ${OUTSIDE_PATH}`, {
      details: { server: "files", calls: [{ name: "read", args: { path: OUTSIDE_PATH } }] },
    })];
    assert.equal(isFilePathReferencedByEntries(OUTSIDE_PATH, entries), false, String(toolName));
  }
});

test("authorizes paths from coding tool and subagent tool results", async () => {
  const { isFilePathReferencedByEntries } = await loadSubject();

  const toolNames = [
    "read", "bash", "powershell", "edit", "write", "find", "grep", "ls",
    "Agent", "get_subagent_result", "steer_subagent",
  ];
  for (const toolName of toolNames) {
    const entries = [toolResult(toolName, `found ${OUTSIDE_PATH}`)];
    assert.equal(isFilePathReferencedByEntries(OUTSIDE_PATH, entries), true, toolName);
  }
});

test("authorizes tool call arguments, including calls to MCP tools", async () => {
  const { isFilePathReferencedByEntries } = await loadSubject();
  const entries = [
    messageEntry({
      role: "assistant",
      content: [
        { type: "toolCall", id: "call-1", name: "mcp__files__read", arguments: { path: OUTSIDE_PATH } },
      ],
      model: "m",
      provider: "p",
    }),
    toolResult("mcp__files__read", "file contents"),
  ];

  assert.equal(isFilePathReferencedByEntries(OUTSIDE_PATH, entries), true);
});

test("authorizes the full output path of a non-coding tool result", async () => {
  const { isFilePathReferencedByEntries } = await loadSubject();
  const spillPath = "/tmp/pi-codemode-ab12.txt";
  const entries = [toolResult("codemode", `[Full output: ${spillPath}] and ${OUTSIDE_PATH}`, {
    details: { calls: [], fullOutputPath: spillPath },
  })];

  assert.equal(isFilePathReferencedByEntries(spillPath, entries), true);
  assert.equal(isFilePathReferencedByEntries(OUTSIDE_PATH, entries), false);
});

test("authorizes nested coding tool call arguments but not nested call errors", async () => {
  const { isFilePathReferencedByEntries } = await loadSubject();
  const argumentPath = "/home/me/notes/todo.md";
  const entries = [toolResult("codemode", "Script completed", {
    nestedCalls: {
      complete: true,
      calls: [
        { id: "call-1/1", name: "read", arguments: { path: argumentPath }, status: "ok" },
        { id: "call-1/2", name: "mcp__files__list", arguments: {}, status: "error", error: `denied: ${OUTSIDE_PATH}` },
      ],
    },
  })];

  assert.equal(isFilePathReferencedByEntries(argumentPath, entries), true);
  assert.equal(isFilePathReferencedByEntries(OUTSIDE_PATH, entries), false);
});

test("does not authorize arguments a script passed to a nested MCP call", async () => {
  const { isFilePathReferencedByEntries } = await loadSubject();
  const entries = [toolResult("codemode", "Script completed", {
    nestedCalls: {
      complete: true,
      calls: [
        { id: "call-1/1", name: "mcp__files__list", arguments: {}, status: "ok" },
        { id: "call-1/2", name: "mcp__files__fetch", arguments: { path: OUTSIDE_PATH }, status: "ok" },
      ],
    },
  })];

  assert.equal(isFilePathReferencedByEntries(OUTSIDE_PATH, entries), false);
});

test("keeps authorizing paths from the entries the chat renders", async () => {
  const { isFilePathReferencedByEntries } = await loadSubject();
  const base = { parentId: null, timestamp: "2026-01-01T00:00:00.000Z" };
  const cases = {
    assistantText: messageEntry({ role: "assistant", content: [{ type: "text", text: `See ${OUTSIDE_PATH}` }] }),
    bashExecution: messageEntry({ role: "bashExecution", command: `cat ${OUTSIDE_PATH}`, output: "", timestamp: 1 }),
    customMessage: messageEntry({ role: "custom", customType: "note", content: OUTSIDE_PATH, display: true }),
    customMessageEntry: { ...base, type: "custom_message", id: "e", customType: "note", content: OUTSIDE_PATH, display: true },
    compaction: { ...base, type: "compaction", id: "e", summary: `Edited ${OUTSIDE_PATH}`, firstKeptEntryId: "e", tokensBefore: 1 },
    branchSummary: { ...base, type: "branch_summary", id: "e", fromId: "e", summary: `Edited ${OUTSIDE_PATH}` },
  };

  for (const [name, entry] of Object.entries(cases)) {
    assert.equal(isFilePathReferencedByEntries(OUTSIDE_PATH, [entry]), true, name);
  }
});

test("does not authorize paths from context edit replacements", async () => {
  const { isFilePathReferencedByEntries } = await loadSubject();
  const entries = [
    toolResult("mcp__files__list", `found ${OUTSIDE_PATH}`),
    {
      type: "context_edit",
      id: "entry-2",
      parentId: "entry-1",
      timestamp: "2026-01-01T00:00:01.000Z",
      targetId: "entry-1",
      replacement: { content: [{ type: "text", text: `trimmed: ${OUTSIDE_PATH}` }] },
    },
  ];

  assert.equal(isFilePathReferencedByEntries(OUTSIDE_PATH, entries), false);
});

test("authorizes user message paths but not the codemode script store", async () => {
  const { isFilePathReferencedByEntries } = await loadSubject();
  const userPath = "/home/me/Downloads/report.pdf";
  const entries = [
    messageEntry({ role: "user", content: `Summarize ${userPath}`, timestamp: 1 }),
    {
      type: "custom",
      id: "entry-2",
      parentId: "entry-1",
      timestamp: "2026-01-01T00:00:01.000Z",
      customType: "codemode-store",
      data: { set: { listing: [OUTSIDE_PATH] }, delete: [] },
    },
  ];

  assert.equal(isFilePathReferencedByEntries(userPath, entries), true);
  assert.equal(isFilePathReferencedByEntries(OUTSIDE_PATH, entries), false);
});

test("authorizes full output only from a bash execution message", async () => {
  const { isBashOutputPathReferencedByEntries } = await loadSubject();
  const outputPath = "/tmp/pi-bash-ab12.log";
  const bashEntry = {
    type: "message",
    id: "entry-1",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "bashExecution",
      command: "printf test",
      output: "test",
      fullOutputPath: outputPath,
    },
  };
  const assistantEntry = {
    type: "message",
    id: "entry-2",
    parentId: "entry-1",
    timestamp: "2026-01-01T00:00:01.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: `mentioned ${outputPath}` }],
    },
  };

  assert.equal(isBashOutputPathReferencedByEntries(outputPath, [bashEntry]), true);
  assert.equal(isBashOutputPathReferencedByEntries(outputPath, [assistantEntry]), false);
  assert.equal(isBashOutputPathReferencedByEntries("/tmp/pi-bash-other.log", [bashEntry]), false);
});

test("validates session ids before resolving session paths", async () => {
  const { isValidSessionId } = await loadSubject();

  assert.equal(isValidSessionId("not-a-session-id"), false);
  assert.equal(isValidSessionId("../../sessions/foo"), false);
  assert.equal(isValidSessionId("550e8400-e29b-41d4-a716-446655440000"), true);
});
