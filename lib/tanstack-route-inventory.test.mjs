import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

const EXPECTED_ROUTES = {
  "app/api/agent/[id]/bash-output/route.ts": ["GET"],
  "app/api/agent/[id]/events/route.ts": ["GET"],
  "app/api/agent/[id]/route.ts": ["GET", "POST"],
  "app/api/agent/new/route.ts": ["POST"],
  "app/api/agent/running/events/route.ts": ["GET"],
  "app/api/agent/running/route.ts": ["GET"],
  "app/api/app-update/route.ts": ["GET"],
  "app/api/auth/all-providers/route.ts": ["GET"],
  "app/api/auth/api-key/[provider]/route.ts": ["DELETE", "GET", "POST"],
  "app/api/auth/login/[provider]/route.ts": ["GET", "POST"],
  "app/api/auth/logout/[provider]/route.ts": ["POST"],
  "app/api/auth/providers/route.ts": ["GET"],
  "app/api/cwd/browse/route.ts": ["GET", "POST"],
  "app/api/cwd/validate/route.ts": ["POST"],
  "app/api/default-cwd/route.ts": ["POST"],
  "app/api/file-index/route.ts": ["GET"],
  "app/api/files/[...path]/route.ts": ["GET", "POST"],
  "app/api/git/diff/route.ts": ["GET"],
  "app/api/git/status/route.ts": ["GET"],
  "app/api/home/route.ts": ["GET"],
  "app/api/models-config/catalog/route.ts": ["GET"],
  "app/api/models-config/discover/route.ts": ["POST"],
  "app/api/models-config/route.ts": ["GET", "PUT"],
  "app/api/models-config/test/route.ts": ["POST"],
  "app/api/models/route.ts": ["GET"],
  "app/api/plugins/route.ts": ["GET", "POST"],
  "app/api/project-trust/route.ts": ["GET", "POST"],
  "app/api/projects/route.ts": ["GET", "PUT"],
  "app/api/sessions/[id]/auto-name/route.ts": ["POST"],
  "app/api/sessions/[id]/context/route.ts": ["GET"],
  "app/api/sessions/[id]/entries/[entryId]/thinking/route.ts": ["GET"],
  "app/api/sessions/[id]/export/route.ts": ["GET"],
  "app/api/sessions/[id]/route.ts": ["DELETE", "GET", "PATCH"],
  "app/api/sessions/[id]/state/route.ts": ["GET"],
  "app/api/sessions/route.ts": ["GET"],
  "app/api/skills/check/route.ts": ["POST"],
  "app/api/skills/install/route.ts": ["POST"],
  "app/api/skills/route.ts": ["GET", "PATCH"],
  "app/api/skills/search/route.ts": ["POST"],
  "app/api/skills/update/route.ts": ["POST"],
  "app/api/worktrees/route.ts": ["DELETE", "GET", "POST"],
};

async function filesNamedRoute(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesNamedRoute(path);
    return entry.name === "route.ts" ? [relative(ROOT, path)] : [];
  }));
  return nested.flat().sort();
}

test("the internal API inventory contains exactly the expected 41 routes", async () => {
  const actual = await filesNamedRoute(join(ROOT, "app", "api"));
  assert.equal(actual.length, 41);
  assert.deepEqual(actual, Object.keys(EXPECTED_ROUTES).sort());
});

test("every internal API handler uses standard Web APIs and exports the expected methods", async () => {
  for (const [file, expectedMethods] of Object.entries(EXPECTED_ROUTES)) {
    const source = await readFile(join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /from ["']next\/server["']/, file);
    assert.doesNotMatch(source, /\bNextRequest\b|\bNextResponse\b|\.nextUrl\b/, file);
    const methods = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Z]+)/gm)]
      .map((match) => match[1]);
    assert.deepEqual(methods.sort(), [...expectedMethods].sort(), file);
  }
});
