import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { sessionPathKey } = await jiti.import("./session-path.ts");
const {
  listAllSessions,
  mergeSessionLists,
  buildSessionContext,
  cacheSessionPath,
  invalidateSessionListCache,
  getSessionListVersion,
  invalidateSessionPathCache,
  readSessionHeader,
  resolveSessionIdByPath,
  resolveSessionPath,
} = await jiti.import("./session-reader.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const scanner = await jiti.import("./session-list-scanner.ts");
// Jiti caches imported bindings, so keep one dispatch function for all mocks.
let listSessions = scanner.listSessionsIncremental;
scanner.listSessionsIncremental = (...args) => listSessions(...args);

function resetSessionListState() {
  globalThis.__piSessionListCache = undefined;
  globalThis.__piSessionListPromise = undefined;
  globalThis.__piSessionListPromiseGeneration = undefined;
  globalThis.__piSessionListGeneration = 0;
}

function resetSessionPathState() {
  globalThis.__piSessionPathCache = undefined;
  globalThis.__piPathToSessionIdCache = undefined;
}

function setTestAgentDir(t, agentDir) {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  resetSessionListState();
  resetSessionPathState();
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    resetSessionListState();
    resetSessionPathState();
    rmSync(agentDir, { recursive: true, force: true });
  });
}

function userEntry(id, parentId, content, timestamp = "2026-01-01T00:00:00.000Z") {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "user",
      content,
    },
  };
}

function assistantEntry(id, parentId, text, timestamp = "2026-01-01T00:00:00.000Z") {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "assistant",
      provider: "test",
      model: "test-model",
      content: [{ type: "text", text }],
    },
  };
}

test("renders history and compaction in chronological order with aligned entry IDs", () => {
  const entries = [
    userEntry("u1", null, "old user request"),
    assistantEntry("a1", "u1", "old assistant answer"),
    userEntry("u2", "a1", "kept user request"),
    {
      type: "compaction",
      id: "cmp",
      parentId: "u2",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "old exchange summary",
      firstKeptEntryId: "u2",
      tokensBefore: 123,
    },
    userEntry("u3", "cmp", "after compaction"),
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.entryIds, ["u1", "a1", "u2", "cmp", "u3"]);
  assert.deepEqual(
    context.messages.map((message) => [message.role, message.customType, message.content]),
    [
      ["user", undefined, "old user request"],
      ["assistant", undefined, [{ type: "text", text: "old assistant answer" }]],
      ["user", undefined, "kept user request"],
      ["custom", "compaction", "old exchange summary"],
      ["user", undefined, "after compaction"],
    ],
  );
});

test("preserves earlier history and every compaction on the active path", () => {
  const entries = [
    userEntry("u1", null, "old request"),
    assistantEntry("a1", "u1", "old answer"),
    userEntry("u2", "a1", "first kept request"),
    {
      type: "compaction",
      id: "cmp1",
      parentId: "u2",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "first summary",
      firstKeptEntryId: "u2",
      tokensBefore: 100,
    },
    assistantEntry("a2", "cmp1", "second kept answer"),
    userEntry("u3", "a2", "second kept request"),
    {
      type: "compaction",
      id: "cmp2",
      parentId: "u3",
      timestamp: "2026-01-01T00:00:06.000Z",
      summary: "latest summary",
      firstKeptEntryId: "a2",
      tokensBefore: 200,
    },
    assistantEntry("a3", "cmp2", "latest answer"),
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.entryIds, ["u1", "a1", "u2", "cmp1", "a2", "u3", "cmp2", "a3"]);
  assert.deepEqual(context.messages.filter((message) => message.role === "custom").map((message) => message.content), ["first summary", "latest summary"]);
  assert.equal(context.messages.length, context.entryIds.length);
});

test("uses the selected leaf's path before a later compaction", () => {
  const entries = [
    userEntry("u1", null, "root request"),
    assistantEntry("a1", "u1", "root answer"),
    userEntry("u2", "a1", "main branch"),
    {
      type: "compaction",
      id: "cmp",
      parentId: "u2",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "main branch summary",
      firstKeptEntryId: "u2",
      tokensBefore: 100,
    },
    userEntry("alt", "a1", "alternate branch"),
  ];

  for (const options of [{}, { tail: 50 }]) {
    const context = buildSessionContext(entries, "alt", options);
    assert.deepEqual(context.entryIds, ["u1", "a1", "alt"]);
    assert.equal(context.messages.some((message) => message.role === "custom"), false);
  }
});

test("returns an empty context for a null leaf", () => {
  for (const options of [{}, { tail: 50 }]) {
    const context = buildSessionContext([
      userEntry("u1", null, "not active"),
    ], null, options);

    assert.deepEqual(context.messages, []);
    assert.deepEqual(context.entryIds, []);
    assert.equal(context.oldestEntryId, null);
    assert.equal(context.hasMore, false);
  }
});

test("defers historical thinking without changing live-session content", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      ...assistantEntry("a1", "u1", "answer"),
      message: {
        role: "assistant",
        provider: "test",
        model: "test-model",
        content: [
          { type: "thinking", thinking: "large reasoning\nFull reasoning remains deferred." },
          { type: "text", text: "answer" },
        ],
      },
    },
  ];

  const deferred = buildSessionContext(entries, undefined, { deferThinking: true });
  assert.deepEqual(deferred.messages[1].content[0], {
    type: "thinking",
    thinking: "large reasoning",
    deferred: true,
  });

  const full = buildSessionContext(entries);
  assert.equal(full.messages[1].content[0].thinking, "large reasoning\nFull reasoning remains deferred.");
});

test("does not defer empty historical thinking blocks", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      ...assistantEntry("a1", "u1", "answer"),
      message: {
        role: "assistant",
        provider: "test",
        model: "test-model",
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: "answer" },
        ],
      },
    },
  ];

  const context = buildSessionContext(entries, undefined, { deferThinking: true });
  assert.deepEqual(context.messages[1].content[0], { type: "thinking", thinking: "" });
});

test("defers only base64 images from historical tool results", () => {
  const userImage = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QUJDRA==" },
  };
  const toolImage = {
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: "QUJDRA==" },
  };
  const toolUrlImage = {
    type: "image",
    source: { type: "url", url: "https://example.com/result.png" },
  };
  const flatToolImage = {
    type: "image",
    data: "QUJDRA==",
    mimeType: "image/png",
  };
  const unsupportedToolImage = {
    type: "image",
    data: "QQ==",
    mimeType: "image/tiff",
  };
  const entries = [
    userEntry("u1", null, [{ type: "text", text: "inspect this" }, userImage]),
    assistantEntry("a1", "u1", "reading"),
    {
      type: "message",
      id: "tr1",
      parentId: "a1",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call1",
        content: [
          { type: "text", text: "Read image file" },
          toolImage,
          flatToolImage,
          toolUrlImage,
          unsupportedToolImage,
        ],
      },
    },
  ];

  const deferred = buildSessionContext(entries, undefined, {
    deferToolResultImages: true,
    sessionId: "session-1",
  });
  assert.deepEqual(deferred.messages[0].content[1], userImage);
  assert.deepEqual(deferred.messages[2].content[0], { type: "text", text: "Read image file" });
  assert.deepEqual(deferred.messages[2].content[1], {
    type: "image",
    source: {
      type: "url",
      media_type: "image/jpeg",
      url: "/api/sessions/session-1/entries/tr1/tool-result-image?blockIndex=1",
    },
  });
  assert.deepEqual(deferred.messages[2].content[2], {
    type: "image",
    source: {
      type: "url",
      media_type: "image/png",
      url: "/api/sessions/session-1/entries/tr1/tool-result-image?blockIndex=2",
    },
  });
  assert.deepEqual(deferred.messages[2].content[3], toolUrlImage);
  assert.match(deferred.messages[2].content[4].text, /1 tool result image omitted.*image\/tiff.*~1 bytes/);

  const boundedFallback = buildSessionContext(entries, undefined, { deferToolResultImages: true });
  assert.deepEqual(boundedFallback.messages[2].content[1], toolUrlImage);
  assert.match(boundedFallback.messages[2].content[2].text, /3 tool result images omitted.*image\/jpeg, image\/png, image\/tiff.*~9 bytes/);

  const full = buildSessionContext(entries);
  assert.deepEqual(full.messages[2].content[1], toolImage);
  assert.deepEqual(full.messages[2].content[2], flatToolImage);
  assert.deepEqual(full.messages[2].content[3], toolUrlImage);
  assert.deepEqual(full.messages[2].content[4], unsupportedToolImage);
});

test("preserves hidden custom messages so the UI can render them collapsed", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      type: "custom_message",
      id: "c1",
      parentId: "u1",
      timestamp: "2026-01-01T00:00:01.000Z",
      customType: "extension_debug",
      content: "hidden extension payload",
      display: false,
      details: { source: "test" },
    },
    assistantEntry("a1", "c1", "done"),
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.entryIds, ["u1", "c1", "a1"]);
  assert.equal(context.messages[1].role, "custom");
  assert.equal(context.messages[1].customType, "extension_debug");
  assert.equal(context.messages[1].display, false);
  assert.equal(context.messages[1].content, "hidden extension payload");
});

test("preserves valid epoch timestamps on synthetic UI messages", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      type: "compaction",
      id: "cmp",
      parentId: "u1",
      timestamp: "1970-01-01T00:00:00.000Z",
      summary: "epoch summary",
      firstKeptEntryId: "u1",
      tokensBefore: 10,
    },
  ];

  const context = buildSessionContext(entries);

  assert.equal(context.messages[1].role, "custom");
  assert.equal(context.messages[1].customType, "compaction");
  assert.equal(context.messages[1].timestamp, 0);
});

test("reads only a bounded session header, including headers larger than 4 KiB", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-header-"));
  const filePath = join(dir, "session.jsonl");
  const parentSession = `/tmp/${"p".repeat(5_000)}.jsonl`;
  writeFileSync(filePath, `${JSON.stringify({
    type: "session",
    version: 3,
    id: "session",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: dir,
    parentSession,
  })}\n${JSON.stringify(userEntry("u1", null, "message"))}\n`);

  try {
    assert.equal(readSessionHeader(filePath)?.parentSession, parentSession);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns null for malformed or unbounded session headers", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-header-invalid-"));
  const malformedPath = join(dir, "malformed.jsonl");
  const oversizedPath = join(dir, "oversized.jsonl");
  writeFileSync(malformedPath, "{not-json}\n");
  writeFileSync(oversizedPath, "x".repeat(64 * 1024));

  try {
    assert.equal(readSessionHeader(malformedPath), null);
    assert.equal(readSessionHeader(oversizedPath), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("session listing reads subagent relations and terminal status without reopening full session files", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-relation-prefix-"));
  const filePath = join(dir, "child.jsonl");
  const childId = "bounded-relation-child";
  const parentPath = join(dir, "parent.jsonl");
  writeFileSync(filePath, [
    JSON.stringify({
      type: "session",
      version: 3,
      id: childId,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: dir,
      parentSession: parentPath,
    }),
    JSON.stringify({
      type: "custom",
      customType: "pi-web:subagent",
      id: "meta",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        version: 1,
        parentSessionId: "parent-id",
        parentSessionPath: parentPath,
        profile: "Explore",
        description: "Inspect parser",
      },
    }),
    "x".repeat(512 * 1024),
    JSON.stringify({
      type: "custom",
      customType: "pi-web:subagent-result",
      id: "result",
      parentId: "meta",
      timestamp: "2026-01-01T00:00:01.000Z",
      data: {
        version: 1,
        status: "completed",
        completedAt: "2026-01-01T00:00:01.000Z",
        result: "Parser inspected.",
      },
    }),
  ].join("\n"));

  const originalListSessions = listSessions;
  const originalOpen = SessionManager.open;
  let fullOpens = 0;
  listSessions = async () => [{
    path: filePath,
    id: childId,
    cwd: dir,
    created: new Date("2026-01-01T00:00:00.000Z"),
    modified: new Date("2026-01-01T00:00:01.000Z"),
    messageCount: 0,
    firstMessage: "(no messages)",
    allMessagesText: "",
    parentSessionPath: parentPath,
  }];
  SessionManager.open = () => {
    fullOpens += 1;
    throw new Error("full session open is not allowed while listing");
  };
  resetSessionListState();
  t.after(() => {
    listSessions = originalListSessions;
    SessionManager.open = originalOpen;
    invalidateSessionPathCache(childId);
    resetSessionListState();
    rmSync(dir, { recursive: true, force: true });
  });

  const sessions = await listAllSessions({ force: true });

  assert.equal(fullOpens, 0);
  assert.deepEqual(sessions[0].relation, {
    kind: "subagent",
    parentSessionId: "parent-id",
    profile: "Explore",
    description: "Inspect parser",
    status: "completed",
  });
});

test("keeps forward and reverse session path caches in sync", async () => {
  const sessionId = "cache-test-session";
  const filePath = join(tmpdir(), "pi-web-cache-test", "..", "cache-test", "session.jsonl");

  cacheSessionPath(sessionId, filePath);
  try {
    assert.equal(
      await resolveSessionIdByPath(filePath),
      sessionId,
    );
  } finally {
    invalidateSessionPathCache(sessionId);
  }

  assert.equal(globalThis.__piSessionPathCache?.has(sessionId), false);
  assert.equal(globalThis.__piPathToSessionIdCache?.has(sessionPathKey(filePath)), false);
});

test("resolves a matching session header without a catalogue scan", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-targeted-session-"));
  const sessionId = "target-session";
  const projectDir = join(agentDir, "sessions", "project");
  const filePath = join(projectDir, `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/tmp/project",
  })}\n${JSON.stringify(userEntry("u1", null, "not scanned"))}\n`);

  const originalListSessions = listSessions;
  let scans = 0;
  listSessions = async () => {
    scans += 1;
    return [];
  };
  setTestAgentDir(t, agentDir);
  t.after(() => {
    listSessions = originalListSessions;
  });

  assert.equal(await resolveSessionPath(sessionId), filePath);
  assert.equal(scans, 0);
  assert.equal(globalThis.__piPathToSessionIdCache?.get(sessionPathKey(filePath)), sessionId);

  resetSessionPathState();
  assert.equal(await resolveSessionIdByPath(filePath), sessionId);
  assert.equal(scans, 0);
  assert.equal(globalThis.__piSessionPathCache?.get(sessionId), filePath);
});

test("does not resolve a parent path outside the default session storage", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-targeted-outside-"));
  const externalDir = mkdtempSync(join(tmpdir(), "pi-web-targeted-external-"));
  const externalPath = join(externalDir, "outside.jsonl");
  writeFileSync(externalPath, `${JSON.stringify({
    type: "session",
    version: 3,
    id: "outside-session",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/tmp/project",
  })}\n`);

  const originalListSessions = listSessions;
  let scans = 0;
  listSessions = async () => {
    scans += 1;
    return [];
  };
  setTestAgentDir(t, agentDir);
  t.after(() => {
    listSessions = originalListSessions;
    rmSync(externalDir, { recursive: true, force: true });
  });

  assert.equal(await resolveSessionIdByPath(externalPath), undefined);
  assert.equal(scans, 1);
});

test(
  "preserves project symlinks exposed by the session catalogue",
  { skip: process.platform === "win32" },
  async (t) => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-web-targeted-symlink-"));
    const externalDir = mkdtempSync(join(tmpdir(), "pi-web-targeted-symlink-external-"));
    const sessionId = "symlink-session";
    const sessionFile = `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`;
    const externalPath = join(externalDir, sessionFile);
    const linkedPath = join(agentDir, "sessions", "linked-project", sessionFile);
    writeFileSync(externalPath, `${JSON.stringify({
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: "/tmp/project",
    })}\n`);
    mkdirSync(join(agentDir, "sessions"), { recursive: true });
    symlinkSync(externalDir, join(agentDir, "sessions", "linked-project"), "dir");

    const originalListSessions = listSessions;
    let scans = 0;
    listSessions = async () => {
      scans += 1;
      return [
        {
          path: linkedPath,
          id: sessionId,
          cwd: "/tmp/project",
          created: new Date("2026-01-01T00:00:00.000Z"),
          modified: new Date("2026-01-01T00:00:00.000Z"),
          messageCount: 0,
          firstMessage: "(no messages)",
          allMessagesText: "",
        },
      ];
    };
    setTestAgentDir(t, agentDir);
    t.after(() => {
      listSessions = originalListSessions;
      rmSync(externalDir, { recursive: true, force: true });
    });

    const listed = await listAllSessions({ force: true });
    assert.equal(listed[0]?.path, linkedPath);
    assert.equal(scans, 1);

    resetSessionListState();
    resetSessionPathState();
    scans = 0;
    assert.equal(await resolveSessionPath(sessionId), linkedPath);
    assert.equal(scans, 0);

    resetSessionPathState();
    assert.equal(await resolveSessionIdByPath(linkedPath), sessionId);
    assert.equal(scans, 0);
  },
);

test("falls back to the catalogue when a targeted candidate header is invalid", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-targeted-fallback-"));
  const sessionId = "target-session";
  const projectDir = join(agentDir, "sessions", "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`), `${JSON.stringify({
    type: "session",
    version: 3,
    id: "different-session",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/tmp/project",
  })}\n`);

  const originalListSessions = listSessions;
  let scans = 0;
  listSessions = async () => {
    scans += 1;
    return [];
  };
  setTestAgentDir(t, agentDir);
  t.after(() => {
    listSessions = originalListSessions;
  });

  assert.equal(await resolveSessionPath(sessionId), null);
  assert.equal(scans, 1);
});

test("falls back to the catalogue when a targeted lookup finds duplicate IDs", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-targeted-duplicate-"));
  const sessionId = "target-session";
  for (const projectName of ["project-a", "project-b"]) {
    const projectDir = join(agentDir, "sessions", projectName);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`), `${JSON.stringify({
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: "/tmp/project",
    })}\n`);
  }

  const originalListSessions = listSessions;
  const fallbackDir = join(agentDir, "sessions", "catalogue");
  const fallbackPath = join(fallbackDir, "fallback.jsonl");
  mkdirSync(fallbackDir, { recursive: true });
  writeFileSync(fallbackPath, `${JSON.stringify({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/tmp/project",
  })}\n`);
  let scans = 0;
  listSessions = async () => {
    scans += 1;
    return [{
      path: fallbackPath,
      id: sessionId,
      cwd: "",
      created: new Date("2026-01-01T00:00:00.000Z"),
      modified: new Date("2026-01-01T00:00:00.000Z"),
      messageCount: 0,
      firstMessage: "(no messages)",
      allMessagesText: "",
    }];
  };
  setTestAgentDir(t, agentDir);
  t.after(() => {
    listSessions = originalListSessions;
  });

  assert.equal(await resolveSessionPath(sessionId), fallbackPath);
  assert.equal(scans, 1);
});

test("forced session listing bypasses the fresh server cache", async (t) => {
  const originalListSessions = listSessions;
  let scans = 0;
  listSessions = async () => {
    scans += 1;
    return [];
  };
  resetSessionListState();
  t.after(() => {
    listSessions = originalListSessions;
    resetSessionListState();
  });

  await listAllSessions({ force: true });
  const version = getSessionListVersion();
  await listAllSessions();
  assert.equal(scans, 1);
  assert.equal(getSessionListVersion(), version, "cached sync reads must not notify other windows again");

  await listAllSessions({ force: true });
  assert.equal(scans, 2);
  assert.ok(getSessionListVersion() > version);
  const refreshedVersion = getSessionListVersion();
  invalidateSessionListCache();
  assert.ok(getSessionListVersion() > refreshedVersion);
});

test("a scan invalidated in flight retries before returning to its caller", async (t) => {
  const originalListSessions = listSessions;
  let scans = 0;
  let releaseFirstScan;
  let markFirstScanStarted;
  const firstScanStarted = new Promise((resolve) => {
    markFirstScanStarted = resolve;
  });
  const firstScanGate = new Promise((resolve) => {
    releaseFirstScan = resolve;
  });
  listSessions = async () => {
    scans += 1;
    if (scans === 1) {
      markFirstScanStarted();
      await firstScanGate;
    }
    return [];
  };
  resetSessionListState();
  t.after(() => {
    listSessions = originalListSessions;
    resetSessionListState();
  });

  const listing = listAllSessions({ force: true });
  await firstScanStarted;
  invalidateSessionListCache();
  releaseFirstScan();
  await listing;

  assert.equal(scans, 2);
});

test("disk sessions replace runtime snapshots with the same id", () => {
  const base = {
    path: "/tmp/session.jsonl",
    id: "same-id",
    cwd: "/tmp",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:01.000Z",
    messageCount: 2,
    firstMessage: "persisted",
  };
  const persisted = { ...base };
  const runtime = {
    ...base,
    path: "/tmp/not-written-yet.jsonl",
    modified: "2026-01-01T00:00:02.000Z",
    firstMessage: "runtime",
    transient: true,
  };
  const runtimeOnly = {
    ...runtime,
    id: "runtime-only",
    modified: "2026-01-01T00:00:03.000Z",
  };

  const merged = mergeSessionLists([persisted], [runtime, runtimeOnly]);

  assert.deepEqual(merged.map((session) => session.id), ["runtime-only", "same-id"]);
  assert.equal(merged[1], persisted);
  assert.equal(merged[1].transient, undefined);
});
