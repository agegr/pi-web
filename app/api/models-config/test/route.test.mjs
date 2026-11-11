import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-models-config-test-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function completionStream() {
  const chunk = {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 0,
    model: "deepseek-v4.1-flash",
    choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
  };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

test("Test model prepares the probe like a chat request: auth and models.json headers, an OpenCode session id", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, headers: request.headers });
    return completionStream();
  });

  const response = await POST(new Request("http://localhost/api/models-config/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "localhost" },
    body: JSON.stringify({
      providerName: "open-code-go",
      provider: {
        baseUrl: "https://opencode.ai/zen/go/v1",
        api: "openai-completions",
        apiKey: "oc_sk_test",
        headers: { "X-Custom": "from-models-json" },
      },
      model: { id: "deepseek-v4.1-flash", api: "openai-completions", input: ["text"] },
    }),
  }));

  const result = await response.json();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.responseText, "OK");
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.equal(request.url, "https://opencode.ai/zen/go/v1/chat/completions");
  assert.equal(request.headers.get("authorization"), "Bearer oc_sk_test");
  assert.equal(request.headers.get("x-custom"), "from-models-json");
  assert.match(request.headers.get("x-opencode-session") ?? "", /^[0-9a-f-]{36}$/);
});
