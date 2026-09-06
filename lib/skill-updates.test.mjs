import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildSkillUpdateArgs,
  checkSkillUpdate,
  checkSkillUpdates,
  skillUpdateKey,
} = await jiti.import("./skill-updates.ts");

function install(overrides = {}) {
  return {
    package: "owner/repo@example-skill",
    scope: "global",
    source: "owner/repo",
    sourceType: "github",
    skillsShUrl: "https://skills.sh/owner/repo/example-skill",
    skillPath: "skills/example-skill/SKILL.md",
    versionHash: "current-hash",
    canCheckForUpdates: true,
    ...overrides,
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("compares a global lock version with the remote Git tree", async () => {
  const seen = [];
  const upToDate = await checkSkillUpdate(install(), {
    fetcher: async (url) => {
      seen.push(url);
      return jsonResponse({
        sha: "root-hash",
        tree: [{ type: "tree", path: "skills/example-skill", sha: "current-hash" }],
      });
    },
  });

  assert.equal(upToDate.state, "up-to-date");
  assert.equal(upToDate.latestVersion, "current-hash");
  assert.match(seen[0], /repos\/owner\/repo\/git\/trees\/HEAD/);

  const available = await checkSkillUpdate(install(), {
    fetcher: async () => jsonResponse({
      sha: "root-hash",
      tree: [{ type: "tree", path: "skills/example-skill", sha: "next-hash" }],
    }),
  });
  assert.equal(available.state, "update-available");
  assert.equal(available.currentVersion, "current-hash");
  assert.equal(available.latestVersion, "next-hash");
});

test("uses the repository hash for a root global skill", async () => {
  const result = await checkSkillUpdate(install({ skillPath: "SKILL.md" }), {
    fetcher: async () => jsonResponse({ sha: "next-root", tree: [] }),
  });

  assert.equal(result.state, "update-available");
  assert.equal(result.latestVersion, "next-root");
});

test("compares a project lock version with the skills.sh snapshot", async () => {
  let requestedUrl = "";
  const result = await checkSkillUpdate(install({ scope: "project" }), {
    skillsApiBase: "https://skills.test",
    fetcher: async (url) => {
      requestedUrl = url;
      return jsonResponse({ hash: "current-hash" });
    },
  });

  assert.equal(result.state, "up-to-date");
  assert.equal(
    requestedUrl,
    "https://skills.test/api/download/owner/repo/example-skill",
  );
});

test("returns unsupported without making a remote request", async () => {
  let called = false;
  const result = await checkSkillUpdate(
    install({ canCheckForUpdates: false, versionHash: undefined }),
    { fetcher: async () => { called = true; return jsonResponse({}); } },
  );

  assert.equal(result.state, "unsupported");
  assert.equal(called, false);
});

test("returns a scoped error when the remote check fails", async () => {
  const result = await checkSkillUpdate(install(), {
    fetcher: async () => jsonResponse({}, 503),
  });

  assert.equal(result.state, "error");
  assert.equal(result.message, "HTTP 503");
  assert.equal(skillUpdateKey(install()), "global\0owner/repo@example-skill");
});

test("falls back to Git when the GitHub API is rate limited", async () => {
  let resolved = false;
  const result = await checkSkillUpdate(install(), {
    fetcher: async () => jsonResponse({}, 403),
    resolveGitTreeHash: async () => {
      resolved = true;
      return "next-hash";
    },
  });

  assert.equal(resolved, true);
  assert.equal(result.state, "update-available");
  assert.equal(result.latestVersion, "next-hash");
});

test("builds Pi-only update commands for each scope", () => {
  assert.deepEqual(buildSkillUpdateArgs(install()), [
    "skills",
    "add",
    "owner/repo/skills/example-skill",
    "--skill",
    "example-skill",
    "-y",
    "--agent",
    "pi",
    "-g",
  ]);
  assert.deepEqual(buildSkillUpdateArgs(install({ scope: "project" })), [
    "skills",
    "add",
    "owner/repo/skills/example-skill",
    "--skill",
    "example-skill",
    "-y",
    "--agent",
    "pi",
  ]);
  assert.deepEqual(buildSkillUpdateArgs(install({ ref: "release/v2" })), [
    "skills",
    "add",
    "owner/repo/skills/example-skill#release%2Fv2",
    "--skill",
    "example-skill",
    "-y",
    "--agent",
    "pi",
    "-g",
  ]);
});

test("reuses one remote request for skills from the same GitHub source", async () => {
  let requests = 0;
  const results = await checkSkillUpdates([
    install(),
    install({
      package: "owner/repo@another-skill",
      skillPath: "skills/another-skill/SKILL.md",
      versionHash: "another-hash",
    }),
  ], {
    fetcher: async () => {
      requests++;
      return jsonResponse({
        sha: "root-hash",
        tree: [
          { type: "tree", path: "skills/example-skill", sha: "current-hash" },
          { type: "tree", path: "skills/another-skill", sha: "another-hash" },
        ],
      });
    },
  });

  assert.equal(requests, 1);
  assert.deepEqual(results.map((item) => item.state), ["up-to-date", "up-to-date"]);
});
