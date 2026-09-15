import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { AgentCommandError, isPromptRejectedError, isSideChatReclaimError, sendAgentCommand } =
  await jiti.import("./agent-client.ts");

test("agent command HTTP rejections are distinguishable from transport failures", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => new Response(
    JSON.stringify({
      error: "Authentication failed",
      code: "prompt_rejected",
      accepted: false,
    }),
    { status: 500, headers: { "Content-Type": "application/json" } },
  );

  await assert.rejects(
    sendAgentCommand("session-id", { type: "prompt", message: "hello" }),
    (error) => {
      assert.equal(error instanceof AgentCommandError, true);
      assert.equal(error.status, 500);
      assert.equal(error.message, "Authentication failed");
      assert.equal(error.code, "prompt_rejected");
      assert.equal(error.accepted, false);
      assert.equal(isPromptRejectedError(error), true);
      return true;
    },
  );

  const transportError = new TypeError("connection reset");
  globalThis.fetch = async () => {
    throw transportError;
  };

  await assert.rejects(
    sendAgentCommand("session-id", { type: "prompt", message: "hello" }),
    (error) => {
      assert.equal(error, transportError);
      assert.equal(error instanceof AgentCommandError, false);
      assert.equal(isPromptRejectedError(error), false);
      return true;
    },
  );
});

test("only an explicit negative prompt acknowledgement is definitive", () => {
  assert.equal(
    isPromptRejectedError(new AgentCommandError("proxy failure", 502)),
    false,
  );
  assert.equal(
    isPromptRejectedError(new AgentCommandError("generic API failure", 500, "internal_error", false)),
    false,
  );
});

test("identifies a reclaimed side conversation so the panel can open a fresh fork", () => {
  assert.equal(isSideChatReclaimError({ status: 404, code: "prompt_rejected", accepted: false }), true);
  assert.equal(isSideChatReclaimError(new AgentCommandError("Session not found", 404, "prompt_rejected", false)), true);
});

test("does not treat other failures as a reclaim", () => {
  // A live session whose prompt was refused for an unrelated reason.
  assert.equal(isSideChatReclaimError({ status: 400, code: "prompt_rejected", accepted: false }), false);
  // A 404 outside the prompt-rejection contract (e.g. a bad route).
  assert.equal(isSideChatReclaimError({ status: 404 }), false);
  // A transport failure, which a fresh fork would not fix.
  assert.equal(isSideChatReclaimError(new TypeError("Failed to fetch")), false);
  // The prompt was accepted, so nothing needs recovering.
  assert.equal(isSideChatReclaimError({ status: 404, code: "prompt_rejected", accepted: true }), false);
  assert.equal(isSideChatReclaimError(null), false);
  assert.equal(isSideChatReclaimError(undefined), false);
});
