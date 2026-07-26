import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

test("provider OAuth session invalidation aborts and closes SSE before late OAuth completion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-provider-oauth-"));
  const previousConfigPath = process.env.PI_WEB_AUTH_CONFIG_PATH;
  const previousCreate = ModelRuntime.create;
  const loginRelease = deferred();
  let loginInteraction;
  let loginSignal;
  const callbackCompleted = deferred();

  ModelRuntime.create = async () => ({
    getProvider() { return { auth: { oauth: true } }; },
    async login(_provider, _type, interaction) {
      loginInteraction = interaction;
      loginSignal = interaction.signal;
      try {
        await interaction.prompt({ type: "manual_code", message: "code", placeholder: "" });
      } catch {
        // The route rejects the pending callback during cleanup.
      }
      await loginRelease.promise;
      callbackCompleted.resolve();
      return { access: "late" };
    },
  });

  try {
    process.env.PI_WEB_AUTH_CONFIG_PATH = join(directory, "auth.json");
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const auth = await jiti.import("./pi-web-auth.ts");
    await auth.resetAuthStateForTests();
    await auth.initializeAuth(auth.getSetupTokenForTests(), "safe-password");
    const sessionToken = auth.createSession();
    const { GET } = await jiti.import("../app/api/auth/login/[provider]/route.ts");
    const client = new AbortController();
    const response = await GET(new Request("http://localhost/api/auth/login/anthropic", {
      signal: client.signal,
      headers: { cookie: `pi_web_session=${sessionToken}` },
    }), { params: Promise.resolve({ provider: "anthropic" }) });
    const reader = response.body.getReader();
    const first = await reader.read();
    const firstText = new TextDecoder().decode(first.value);
    const token = JSON.parse(firstText.match(/data: (.+)\n/u)[1]).token;
    assert.ok(globalThis.__piLoginCallbacks.has(token));

    await new Promise((resolve) => setTimeout(resolve, 0));
    await auth.revokeSession(sessionToken);

    assert.equal(loginSignal.aborted, true);
    assert.equal(globalThis.__piLoginCallbacks.has(token), false);
    assert.equal(await reader.read().then((result) => result.done), true);

    loginRelease.resolve();
    await callbackCompleted.promise;
    assert.equal(globalThis.__piLoginCallbacks.has(token), false);
    await reader.cancel();
    assert.equal(loginInteraction.signal, loginSignal);
  } finally {
    ModelRuntime.create = previousCreate;
    process.env.PI_WEB_AUTH_CONFIG_PATH = previousConfigPath;
    await rm(directory, { recursive: true, force: true });
  }
});

test("provider OAuth client abort also removes pending callback and closes SSE", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-provider-oauth-abort-"));
  const previousConfigPath = process.env.PI_WEB_AUTH_CONFIG_PATH;
  const previousCreate = ModelRuntime.create;
  const loginRelease = deferred();
  let loginSignal;
  let completed = false;
  ModelRuntime.create = async () => ({
    getProvider() { return { auth: { oauth: true } }; },
    async login(_provider, _type, interaction) {
      loginSignal = interaction.signal;
      try { await interaction.prompt({ type: "manual_code", message: "code", placeholder: "" }); } catch {}
      await loginRelease.promise;
      completed = true;
      return { access: "late" };
    },
  });

  try {
    process.env.PI_WEB_AUTH_CONFIG_PATH = join(directory, "auth.json");
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const auth = await jiti.import("./pi-web-auth.ts");
    await auth.resetAuthStateForTests();
    await auth.initializeAuth(auth.getSetupTokenForTests(), "safe-password");
    const token = auth.createSession();
    const { GET } = await jiti.import("../app/api/auth/login/[provider]/route.ts");
    const client = new AbortController();
    const response = await GET(new Request("http://localhost/api/auth/login/anthropic", {
      signal: client.signal,
      headers: { cookie: `pi_web_session=${token}` },
    }), { params: Promise.resolve({ provider: "anthropic" }) });
    const reader = response.body.getReader();
    const first = await reader.read();
    const tokenMatch = new TextDecoder().decode(first.value).match(/"token":"([^"]+)"/u);
    assert.ok(tokenMatch);
    client.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(loginSignal.aborted, true);
    assert.equal(globalThis.__piLoginCallbacks.has(tokenMatch[1]), false);
    assert.equal((await reader.read()).done, true);
    loginRelease.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(completed, true);
  } finally {
    ModelRuntime.create = previousCreate;
    process.env.PI_WEB_AUTH_CONFIG_PATH = previousConfigPath;
    await rm(directory, { recursive: true, force: true });
  }
});
