import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  MCP_SIGN_IN_BLOCK_KEYS,
  MCP_SIGN_IN_FAILURE_KEYS,
  MCP_SIGN_IN_GONE_AFTER_MS,
  MCP_SIGN_IN_PHASE_KEYS,
  MCP_SIGN_IN_REFUSAL_KEYS,
  cancelMcpSignInFlow,
  getMcpSignIn,
  mcpSignInActive,
  mcpSignInBlock,
  mcpSignInJustEnded,
  mcpSignInLink,
  mcpSignInOutcomeKey,
  mcpSignInOutcomeTone,
  mcpSignInRunAfterCancel,
  mcpSignInRunAfterPaste,
  mcpSignInRunAfterPoll,
  mcpSignInRunAfterStart,
  mcpSignInShared,
  mcpSignOutBlock,
  pasteMcpSignIn,
  postMcpSignIn,
} = await jiti.import("./mcp-sign-in-helpers.ts");
const { MCP_SIGN_IN_SUMMARY_KEYS, MCP_TEST_SUMMARY_KEYS, mcpTestSummaryKey } = await jiti.import("./mcp-config-helpers.ts");
const { enLocale } = await jiti.import("@/lib/i18n/messages/en.ts");
const messages = enLocale.messages;
const source = await readFile(new URL("./mcp-sign-in-helpers.ts", import.meta.url), "utf8");
const apiTypesSource = await readFile(new URL("../lib/api-types.ts", import.meta.url), "utf8");

const flow = (phase, extra = {}) => ({ flowId: "f1", scope: "global", name: "docs", configKey: "k", phase, expiresInMs: 60_000, ...extra });
const connected = { state: "connected", tools: [], toolCount: 1, durationMs: 3, testedAt: 1 };

test("every key the sign-in helpers pick at run time exists in the locale files", () => {
  const keys = [
    ...Object.values(MCP_SIGN_IN_BLOCK_KEYS),
    ...Object.values(MCP_SIGN_IN_REFUSAL_KEYS),
    ...Object.values(MCP_SIGN_IN_PHASE_KEYS),
    ...Object.values(MCP_SIGN_IN_FAILURE_KEYS),
    ...Object.values(MCP_SIGN_IN_SUMMARY_KEYS),
    ...[...source.matchAll(/"(mcp\.[A-Za-z.-]+)"/g)].map((match) => match[1]),
  ];
  assert.ok(keys.length >= 30);
  for (const key of keys) assert.equal(typeof messages[key], "string", `${key} is missing from en.ts`);
  // Every failure the route can report has its sentence.
  const failures = [...apiTypesSource.slice(
    apiTypesSource.indexOf("export type McpSignInFailure"),
    apiTypesSource.indexOf("export interface McpSignInFlowInfo"),
  ).matchAll(/\| "([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(Object.keys(MCP_SIGN_IN_FAILURE_KEYS).sort(), failures.sort());
  // The summary of the connection after a sign-in takes the same parameters as a test's.
  for (const state of Object.keys(MCP_TEST_SUMMARY_KEYS)) {
    const params = (key) => [...messages[key].matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
    for (const param of params(MCP_SIGN_IN_SUMMARY_KEYS[state])) assert.ok(["count", "seconds", "time"].includes(param), param);
  }
});

test("a sign-in's connection is summed up in sign-in words, a test's in a test's", () => {
  assert.equal(mcpTestSummaryKey({ state: "connected" }), "mcp.test.summary.connected");
  assert.equal(mcpTestSummaryKey({ state: "connected", afterSignIn: true }), "mcp.signIn.summary.connected");
  assert.equal(mcpTestSummaryKey({ state: "failed", timedOut: true, afterSignIn: true }), "mcp.signIn.summary.timedOut");
});

test("Sign in has the Test route's blocks; Sign out only the write blocks and a refused entry", () => {
  const data = (overrides = {}) => ({ mcp: { available: true }, ...overrides });
  const server = (overrides = {}) => ({ scope: "global", validated: true, ...overrides });
  assert.equal(mcpSignInBlock(server(), data()), undefined);
  assert.equal(mcpSignInBlock(server({ webPasswordField: { kind: "header", name: "X" } }), data()), "web-password");
  assert.equal(mcpSignOutBlock(server({ webPasswordField: { kind: "header", name: "X" } }), data()), undefined, "its tokens can still go");
  assert.equal(mcpSignInBlock(server({ invalidError: "bad" }), data()), "invalid");
  assert.equal(mcpSignOutBlock(server({ invalidError: "bad" }), data()), "invalid");
  const off = data({ mcp: { available: false, reason: "operator-disabled", error: "x" } });
  assert.equal(mcpSignInBlock(server(), off), "mcp-off");
  assert.equal(mcpSignOutBlock(server(), off), "mcp-off");
  // -builtin:mcp keeps both, as an explicit action.
  const builtin = data({ mcp: { available: false, reason: "builtin-disabled", error: "x" } });
  assert.equal(mcpSignInBlock(server(), builtin), undefined);
  assert.equal(mcpSignOutBlock(server(), builtin), undefined);
  const untrusted = data({ project: { cwd: "/repo", trust: { requiresTrust: true, trusted: false, decision: null, inherited: false } } });
  assert.equal(mcpSignInBlock(server({ scope: "project" }), untrusted), "project-untrusted");
  assert.equal(mcpSignOutBlock(server({ scope: "project" }), untrusted), "project-untrusted");
  assert.equal(mcpSignInBlock(server({ scope: "project" }), data({ project: { cwd: "/repo" } })), "trust-unreadable");
});

test("the sign-in page is a link only when it is an http(s) address", () => {
  assert.equal(mcpSignInLink("https://auth.example/authorize?state=s"), "https://auth.example/authorize?state=s");
  assert.equal(mcpSignInLink("http://127.0.0.1:5000/authorize"), "http://127.0.0.1:5000/authorize");
  assert.equal(mcpSignInLink("javascript:alert(1)"), undefined);
  assert.equal(mcpSignInLink("file:///etc/passwd"), undefined);
  assert.equal(mcpSignInLink("not a url"), undefined);
  assert.equal(mcpSignInLink(undefined), undefined);
});

test("how a sign-in ended is one sentence, in a tone", () => {
  assert.equal(mcpSignInOutcomeKey(flow("done", { alreadySignedIn: true, result: connected })), "mcp.signIn.done.already");
  assert.equal(mcpSignInOutcomeKey(flow("done", { result: { ...connected, afterSignIn: true } })), "mcp.signIn.done.signedIn");
  assert.equal(mcpSignInOutcomeKey(flow("done", { refreshed: true, result: connected })), "mcp.signIn.done.refreshed");
  assert.equal(mcpSignInOutcomeKey(flow("done", { result: { ...connected, state: "failed" } })), "mcp.signIn.done.failedAfter");
  assert.equal(mcpSignInOutcomeKey(flow("done", { result: { ...connected, state: "needs-auth" } })), "mcp.signIn.done.needsAuthAfter");
  assert.equal(mcpSignInOutcomeKey(flow("done")), "mcp.signIn.done.notConnected");
  assert.equal(mcpSignInOutcomeKey(flow("failed", { failure: "sign-in-failed" })), "mcp.signIn.failed.sign-in-failed");
  assert.equal(mcpSignInOutcomeKey(flow("failed")), "mcp.signIn.failed.internal");
  assert.equal(mcpSignInOutcomeKey(flow("cancelled")), "mcp.signIn.cancelled");
  assert.equal(mcpSignInOutcomeKey(flow("expired")), "mcp.signIn.expired");
  assert.equal(mcpSignInOutcomeKey(flow("authorize")), undefined);
  assert.equal(mcpSignInOutcomeTone(flow("done", { result: connected })), "on");
  assert.equal(mcpSignInOutcomeTone(flow("done", { result: { ...connected, state: "failed" } })), "warning");
  assert.equal(mcpSignInOutcomeTone(flow("failed")), "error");
  assert.equal(mcpSignInOutcomeTone(flow("expired")), "warning");
  assert.equal(mcpSignInOutcomeTone(flow("cancelled")), "off");
});

test("a sign-in joined from another entry of the URL never points at this entry's Connection row", () => {
  const server = { scope: "global", name: "docs" };
  assert.equal(mcpSignInShared(flow("done"), server), false);
  assert.equal(mcpSignInShared(flow("done", { name: "docs-alias" }), server), true);
  assert.equal(mcpSignInShared(flow("done", { scope: "project" }), server), true);
  // Its connections were recorded for the entry that started it, so the ending names that one.
  assert.equal(mcpSignInOutcomeKey(flow("done", { result: { ...connected, afterSignIn: true } }), true), "mcp.signIn.shared.done");
  assert.equal(mcpSignInOutcomeKey(flow("done", { refreshed: true, result: connected }), true), "mcp.signIn.shared.done");
  assert.equal(mcpSignInOutcomeKey(flow("done"), true), "mcp.signIn.shared.done");
  assert.equal(mcpSignInOutcomeKey(flow("done", { result: { ...connected, state: "failed" } }), true), "mcp.signIn.shared.done");
  assert.equal(mcpSignInOutcomeKey(flow("done", { alreadySignedIn: true, result: connected }), true), "mcp.signIn.shared.already");
  assert.equal(mcpSignInOutcomeKey(flow("failed", { failure: "connect-failed" }), true), "mcp.signIn.shared.connect-failed");
  // Endings that say nothing about a connection read the same for both entries.
  assert.equal(mcpSignInOutcomeKey(flow("failed", { failure: "sign-in-failed" }), true), "mcp.signIn.failed.sign-in-failed");
  assert.equal(mcpSignInOutcomeKey(flow("cancelled"), true), "mcp.signIn.cancelled");
  assert.equal(mcpSignInOutcomeKey(flow("expired"), true), "mcp.signIn.expired");
  // Signing in is what counts for the joining entry; the other entry's connection is its own.
  assert.equal(mcpSignInOutcomeTone(flow("done", { result: { ...connected, state: "failed" } }), true), "on");
  for (const key of ["mcp.signIn.shared.done", "mcp.signIn.shared.already", "mcp.signIn.shared.connect-failed"]) {
    assert.match(messages[key], /\{name\}/, key);
    assert.doesNotMatch(messages[key], /Connection above/, key);
  }
});

test("what a failed cancel or a refused paste left behind goes once the flow has ended", () => {
  const waiting = mcpSignInRunAfterStart({ ok: true, data: flow("authorize") }, 1_000);
  const failedCancel = mcpSignInRunAfterCancel({ ...waiting, cancelling: true }, "f1", { ok: false, error: { error: "DELETE timed out", timedOut: true } });
  assert.equal(failedCancel.cancelError.timedOut, true);
  // Still waiting: the error stays, since the sign-in may still be under way.
  const stillWaiting = mcpSignInRunAfterPoll(failedCancel, "f1", { ok: true, data: flow("authorize") }, 2_000, failedCancel.version);
  assert.equal(stillWaiting.cancelError.timedOut, true);
  const ended = mcpSignInRunAfterPoll(stillWaiting, "f1", { ok: true, data: flow("done", { expiresInMs: 0, result: connected }) }, 3_000, stillWaiting.version);
  assert.equal(ended.flow.phase, "done");
  assert.equal("cancelError" in ended, false);
  assert.equal(ended.cancelling, false);

  const refused = mcpSignInRunAfterPaste({ ...waiting, pasting: true }, "f1", { ok: false, error: { error: "x", reason: "redirect-no-code" } });
  assert.equal(refused.pasteError.reason, "redirect-no-code");
  const expired = mcpSignInRunAfterPoll(refused, "f1", { ok: true, data: flow("expired", { expiresInMs: 0 }) }, 4_000, refused.version);
  assert.equal("pasteError" in expired, false);
});

test("a run follows its flow's answers, and only its own flow's", () => {
  const started = mcpSignInRunAfterStart({ ok: true, data: flow("connecting") }, 1_000);
  assert.deepEqual(started, { flow: flow("connecting"), deadlineAt: 61_000, gone: false });
  assert.equal(mcpSignInActive(started), true);
  assert.deepEqual(mcpSignInRunAfterStart({ ok: false, error: { error: "x", reason: "mcp-off" } }), { error: { error: "x", reason: "mcp-off" } });

  const waiting = mcpSignInRunAfterPoll(started, "f1", { ok: true, data: flow("authorize", { expiresInMs: 30_000 }) }, 2_000);
  assert.equal(waiting.flow.phase, "authorize");
  assert.equal(waiting.deadlineAt, 32_000);
  // A poll of another flow (a sign-in started since) changes nothing.
  assert.equal(mcpSignInRunAfterPoll(waiting, "f0", { ok: true, data: flow("done") }), waiting);
  // A network hiccup is retried; long past the time limit, the flow is taken for gone.
  assert.equal(mcpSignInRunAfterPoll(waiting, "f1", { ok: false, error: { error: "Failed to fetch" } }, 3_000), waiting);
  assert.equal(mcpSignInRunAfterPoll(waiting, "f1", { ok: false, error: { error: "Failed to fetch" } }, 32_000 + MCP_SIGN_IN_GONE_AFTER_MS + 1).gone, true);
  const gone = mcpSignInRunAfterPoll(waiting, "f1", { ok: false, error: { error: "x", reason: "sign-in-unknown" } });
  assert.equal(gone.gone, true);
  assert.equal(mcpSignInActive(gone), false);
  assert.equal(mcpSignInJustEnded(waiting, gone), true);

  const pasting = { ...waiting, pasting: true };
  const refused = mcpSignInRunAfterPaste(pasting, "f1", { ok: false, error: { error: "x", reason: "redirect-state-mismatch" } });
  assert.deepEqual([refused.pasting, refused.pasteError.reason, refused.flow.phase], [false, "redirect-state-mismatch", "authorize"]);
  const accepted = mcpSignInRunAfterPaste({ ...refused, pasting: true }, "f1", { ok: true, data: flow("finishing") });
  assert.deepEqual([accepted.pasting, accepted.pasteError, accepted.flow.phase], [false, undefined, "finishing"]);

  // A poll sent before the paste was answered would put the flow back to waiting: it is dropped.
  assert.equal(accepted.version, 2);
  assert.equal(mcpSignInRunAfterPoll(accepted, "f1", { ok: true, data: flow("authorize") }, 3_000, 1), accepted);
  assert.equal(mcpSignInRunAfterPoll(accepted, "f1", { ok: true, data: flow("finishing") }, 3_000, 2).flow.phase, "finishing");
  const ended = mcpSignInRunAfterPoll(accepted, "f1", { ok: true, data: flow("done", { expiresInMs: 0, result: connected }) });
  assert.equal(mcpSignInJustEnded(accepted, ended), true);
  assert.equal(mcpSignInJustEnded(ended, ended), false);

  const cancelling = { ...waiting, cancelling: true };
  const cancelled = mcpSignInRunAfterCancel(cancelling, "f1", { ok: true, data: flow("cancelled") });
  assert.deepEqual([cancelled.cancelling, cancelled.flow.phase], [false, "cancelled"]);
  const failed = mcpSignInRunAfterCancel(cancelling, "f1", { ok: false, error: { error: "Failed to fetch" } });
  assert.deepEqual([failed.cancelling, failed.cancelError.error, mcpSignInActive(failed)], [false, "Failed to fetch", true]);
});

test("the requests go to the sign-in routes as JSON, and refusals keep their reason", async () => {
  const calls = [];
  const answer = (status, body) => async (url, init) => {
    calls.push({ url, method: init?.method ?? "GET", headers: init?.headers, body: init?.body });
    return { ok: status < 400, status, json: async () => body };
  };
  assert.deepEqual(await postMcpSignIn({ scope: "project", name: "docs" }, "/repo", answer(200, flow("connecting"))), { ok: true, data: flow("connecting") });
  assert.deepEqual(calls.at(-1), {
    url: "/api/mcp/sign-in",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "project", name: "docs", cwd: "/repo" }),
  });
  await postMcpSignIn({ scope: "global", name: "docs" }, null, answer(200, flow("connecting")));
  assert.equal(calls.at(-1).body, JSON.stringify({ scope: "global", name: "docs" }));

  await getMcpSignIn("a/b", answer(200, flow("authorize")));
  assert.deepEqual([calls.at(-1).url, calls.at(-1).method], ["/api/mcp/sign-in/a%2Fb", "GET"]);
  await pasteMcpSignIn("f1", "http://127.0.0.1:1/callback?code=c", answer(200, flow("finishing")));
  assert.deepEqual([calls.at(-1).url, calls.at(-1).method, calls.at(-1).body], ["/api/mcp/sign-in/f1", "POST", JSON.stringify({ redirectUrl: "http://127.0.0.1:1/callback?code=c" })]);
  await cancelMcpSignInFlow("f1", answer(200, flow("cancelled")));
  assert.deepEqual([calls.at(-1).url, calls.at(-1).method], ["/api/mcp/sign-in/f1", "DELETE"]);

  assert.deepEqual(
    await pasteMcpSignIn("f1", "x", answer(400, { error: "Expected the full redirected address", reason: "redirect-invalid" })),
    { ok: false, error: { error: "Expected the full redirected address", reason: "redirect-invalid" } },
  );
  assert.deepEqual(await getMcpSignIn("f1", answer(200, { nope: true })), { ok: false, error: { error: "HTTP 200" } });
  assert.deepEqual(
    await getMcpSignIn("f1", async () => { throw new Error("Failed to fetch"); }),
    { ok: false, error: { error: "Failed to fetch" } },
  );
  const slow = await getMcpSignIn("f1", () => new Promise(() => {}), undefined, 20);
  assert.equal(slow.ok, false);
  assert.equal(slow.error.timedOut, true);
});

test("a start that does not answer in time is left running; a poll is aborted at its deadline", async () => {
  const signals = [];
  // Answers nothing, until its request is aborted.
  const hanging = (url, init) => {
    signals.push(init.signal);
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("The operation was aborted")), { once: true });
    });
  };
  const start = await postMcpSignIn({ scope: "global", name: "docs" }, null, hanging, undefined, 20);
  assert.equal(start.error.timedOut, true);
  assert.equal(signals.at(-1).aborted, false, "the start request goes on");
  const poll = await getMcpSignIn("f1", hanging, undefined, 20);
  assert.equal(poll.error.timedOut, true);
  assert.equal(signals.at(-1).aborted, true);
  // The caller's own signal still stops a start.
  const controller = new AbortController();
  const stopped = postMcpSignIn({ scope: "global", name: "docs" }, null, hanging, controller.signal, 1_000);
  controller.abort();
  assert.equal(signals.at(-1).aborted, true);
  assert.equal((await stopped).error.timedOut, undefined);
});
