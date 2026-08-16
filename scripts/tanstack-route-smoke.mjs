/**
 * Shared safe route matrix for the 42 TanStack API adapters.
 *
 * Used identically by standalone and installed-package smoke runs. Never
 * mutates user state: write endpoints are probed with invalid bodies
 * (documented 400/401/404), dynamic endpoints use a fake id (404), session
 * reads use the first real session id when available (redacted), and all
 * fixtures live under a temporary directory authorized through the public
 * POST /api/cwd/validate flow. Output records only method, route pattern,
 * and status.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FAKE_ID = "00000000-0000-0000-0000-000000000000";

export async function smokeAllRoutes({ origin, authHeaders = {} }) {
  const probes = [];
  const skipped = [];
  const results = [];
  let sessionId;

  const redact = (value) => value
    .replaceAll(fixtureDir, "<fixture>")
    .replaceAll(gitDir, "<gitfixture>")
    .replaceAll(sessionId ?? FAKE_ID, sessionId ? "<session>" : "<fake>");

  async function probe(method, path, expectedStatuses, init = {}, label = path) {
    let status;
    const controller = init.expectAbort ? new AbortController() : undefined;
    try {
      const response = await fetch(`${origin}${path}`, {
        ...init,
        method,
        headers: { ...authHeaders, ...(init.headers || {}) },
        signal: controller?.signal ?? init.signal ?? AbortSignal.timeout(5_000),
      });
      status = response.status;
      if (controller && response.body) {
        // SSE: read the first frame, then abort and discard the stream.
        const reader = response.body.getReader();
        await reader.read().catch(() => {});
        controller.abort();
        await reader.cancel().catch(() => {});
      }
    } catch (error) {
      throw new Error(`${method} ${redact(label)}: ${error?.name ?? error}`);
    }
    const ok = expectedStatuses.includes(status);
    results.push({ method, route: redact(label), status, ok });
    if (!ok) {
      probes.push(`${method} ${redact(label)} -> ${status} (expected ${expectedStatuses.join("/")})`);
    }
    return status;
  }

  const envSkip = (route, reason) => {
    skipped.push({ route, reason });
  };

  // ---- Fixtures: temporary directory + git repository, authorized via the
  // public cwd/validate flow so no user state is touched.
  const fixtureDir = mkdtempSync(join(tmpdir(), "pi-web-route-smoke-"));
  const gitDir = mkdtempSync(join(tmpdir(), "pi-web-route-smoke-git-"));
  try {
    execFileSync("git", ["init", "-q", gitDir], { stdio: "ignore" });
    execFileSync("git", ["-C", gitDir, "config", "user.email", "smoke@local"], { stdio: "ignore" });
    execFileSync("git", ["-C", gitDir, "config", "user.name", "smoke"], { stdio: "ignore" });
    writeFileSync(join(gitDir, "fixture.txt"), "route smoke fixture\n");
    execFileSync("git", ["-C", gitDir, "add", "fixture.txt"], { stdio: "ignore" });
    execFileSync("git", ["-C", gitDir, "commit", "-qm", "fixture"], { stdio: "ignore" });

    const authorize = async (dir) => {
      const response = await fetch(`${origin}/api/cwd/validate`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({ cwd: dir }),
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(response.status, 200, `authorize ${dir}`);
    };
    await authorize(fixtureDir);
    await authorize(gitDir);

    // Real session id for read probes (redacted from all output).
    const sessionsResponse = await fetch(`${origin}/api/sessions`, { headers: authHeaders });
    assert.equal(sessionsResponse.status, 200);
    sessionId = (await sessionsResponse.json()).sessions?.[0]?.id;
    const sid = sessionId ?? FAKE_ID;
    if (!sessionId) {
      envSkip("/api/sessions/{id} reads", "no session exists on this host");
    }

    // ---- every adapter URL accounted for.
    await probe("GET", "/api/sessions", [200]);
    await probe("POST", "/api/sessions", [405]);
    await probe("GET", `/api/sessions/${FAKE_ID}`, [404]);
    await probe("PATCH", `/api/sessions/${FAKE_ID}`, [400, 404], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("DELETE", `/api/sessions/${FAKE_ID}`, [404]);
    await probe("GET", `/api/sessions/${FAKE_ID}/state`, [404]);
    const contextStatus = await probe("GET", `/api/sessions/${sid}/context`, [200, 404], {
      headers: { ...authHeaders, "x-smoke-note": "existing-session-read" },
    });
    if (sessionId && contextStatus === 500) {
      envSkip("/api/sessions/{id}/context", "session file busy (500)");
    }
    await probe("GET", `/api/sessions/${FAKE_ID}/export`, [404]);
    await probe("POST", `/api/sessions/${FAKE_ID}/auto-name`, [404]);
    await probe("GET", `/api/sessions/${sid}/entries/nonexistent/thinking`, [400, 404]);
    await probe("GET", `/api/sessions/${sid}/entries/nonexistent/tool-result`, [404]);
    await probe("GET", `/api/agent/${FAKE_ID}`, [200, 404]);
    await probe("POST", `/api/agent/${FAKE_ID}`, [404], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("GET", `/api/agent/${FAKE_ID}/events`, [404], { expectAbort: true });
    await probe("GET", `/api/agent/${FAKE_ID}/subagents`, [404]);
    await probe("POST", `/api/agent/${FAKE_ID}/subagents`, [400], {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ childSessionId: "nope", action: "interrupt" }),
    });
    await probe("GET", `/api/agent/${FAKE_ID}/bash-output`, [200, 400]);
    await probe("POST", "/api/agent/new", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("GET", "/api/agent/running", [200]);
    await probe("GET", "/api/agent/running/events", [200], { expectAbort: true });
    await probe("GET", "/api/app-update", [200]);
    await probe("GET", "/api/auth/all-providers", [200]);
    await probe("GET", "/api/auth/providers", [200]);
    await probe("GET", "/api/auth/api-key/openai", [200, 400]);
    await probe("POST", "/api/auth/api-key/nonexistent-provider", [400, 404], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("DELETE", "/api/auth/api-key/nonexistent-provider", [200, 404]);
    await probe("GET", "/api/auth/login/github", [200], { expectAbort: true });
    await probe("POST", "/api/auth/login/github", [400, 404], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("POST", "/api/auth/logout/github", [400, 404]);
    await probe("GET", `/api/cwd/browse?path=${encodeURIComponent(fixtureDir)}`, [200]);
    await probe("POST", "/api/cwd/browse", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("DELETE", "/api/cwd/browse", [405]);
    await probe("POST", "/api/cwd/validate", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("GET", "/api/cwd/validate", [405]);
    await probe("GET", "/api/default-cwd", [405]);
    await probe("GET", `/api/file-index?cwd=${encodeURIComponent(fixtureDir)}&q=`, [200, 400]);
    await probe("GET", `/api/files/${encodeURIComponent(fixtureDir)}?type=list`, [200]);
    await probe("POST", `/api/files/${encodeURIComponent(fixtureDir)}?type=upload`, [400], {
      headers: { "content-type": "multipart/form-data; boundary=smoke" },
      body: "--smoke--\r\n",
    });
    await probe("PATCH", `/api/files/${encodeURIComponent(fixtureDir)}?type=list`, [405]);
    await probe("GET", `/api/git/status?cwd=${encodeURIComponent(gitDir)}`, [200]);
    await probe("GET", `/api/git/diff?cwd=${encodeURIComponent(gitDir)}`, [200, 400]);
    await probe("GET", "/api/home", [200]);
    await probe("GET", "/api/models", [200, 403]);
    await probe("GET", "/api/models-config", [200]);
    // PUT /api/models-config is a real write with almost no validation and
    // would overwrite the operator's model configuration. It is covered by
    // unit tests only; smoke deliberately never performs it.
    envSkip("PUT /api/models-config", "write operation; covered by unit tests only");
    const catalogStatus = await probe("GET", "/api/models-config/catalog", [200, 502]);
    if (catalogStatus === 502) {
      envSkip("/api/models-config/catalog", "upstream catalog unreachable (502)");
    }
    await probe("POST", "/api/models-config/discover", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("POST", "/api/models-config/test", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("GET", `/api/plugins?cwd=${encodeURIComponent(fixtureDir)}`, [200, 400]);
    await probe("POST", "/api/plugins", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("GET", `/api/project-trust?cwd=${encodeURIComponent(fixtureDir)}`, [200]);
    await probe("POST", "/api/project-trust", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("GET", "/api/projects", [200]);
    await probe("PUT", "/api/projects", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("PATCH", "/api/projects", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("GET", "/api/remote-access", [200]);
    envSkip("PUT /api/remote-access", "write operation; covered by unit tests only");
    await probe("GET", `/api/skills?cwd=${encodeURIComponent(fixtureDir)}`, [200, 400]);
    await probe("PATCH", "/api/skills", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("POST", "/api/skills/check", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("POST", "/api/skills/install", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("POST", "/api/skills/search", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("POST", "/api/skills/update", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("GET", "/api/ui-locale", [200]);
    await probe("PUT", "/api/ui-locale", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("GET", "/api/vision-toolkit", [200]);
    envSkip("PUT /api/vision-toolkit", "write operation; covered by unit tests only");
    await probe("POST", "/api/vision-toolkit/health", [200], {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ testConnection: false }),
    });
    envSkip("POST /api/vision-toolkit/reveal", "opens OS file manager; covered by unit tests only");
    await probe("GET", `/api/worktrees?cwd=${encodeURIComponent(gitDir)}`, [200]);
    await probe("POST", "/api/worktrees", [400], {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await probe("DELETE", `/api/worktrees?cwd=${encodeURIComponent(join(gitDir, "nonexistent"))}`, [400]);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(gitDir, { recursive: true, force: true });
  }

  assert.deepEqual(probes, [], `route probes failed:\n${probes.join("\n")}`);
  return { results, skipped };
}
