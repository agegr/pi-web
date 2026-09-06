import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { checkPluginUpdates, isPluginSourceCheckable } = await jiti.import("./plugin-updates.ts");

function installedPackage(t, version = "1.0.0") {
  const path = mkdtempSync(join(tmpdir(), "pi-web-plugin-update-"));
  writeFileSync(join(path, "package.json"), JSON.stringify({ version }));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test("only exact npm versions and Git refs are pinned", () => {
  assert.equal(isPluginSourceCheckable("npm:pkg@1.2.3"), false);
  assert.equal(isPluginSourceCheckable("npm:pkg@^1.2"), true);
  assert.equal(isPluginSourceCheckable("npm:pkg@~2"), true);
  assert.equal(isPluginSourceCheckable("npm:pkg@latest"), true);
  assert.equal(isPluginSourceCheckable("git:github.com/user/repo@feature/foo"), false);
  assert.equal(isPluginSourceCheckable("git:github.com/user/repo"), true);
});

test("a single-plugin check only runs that plugin's remote command", async (t) => {
  const first = installedPackage(t);
  const second = installedPackage(t);
  const checked = [];
  const results = await checkPluginUpdates("/tmp", { source: "npm:first", scope: "global" }, {
    packages: [
      { source: "npm:first", scope: "user", installedPath: first },
      { source: "npm:second", scope: "user", installedPath: second },
    ],
    runCommand: async (_command, args) => {
      checked.push(args[1]);
      return JSON.stringify("1.0.0");
    },
  });

  assert.deepEqual(checked, ["first"]);
  assert.equal(results.length, 1);
  assert.equal(results[0].state, "up-to-date");
});

test("missing installs and failed commands return errors", async (t) => {
  const missing = await checkPluginUpdates("/tmp", undefined, {
    packages: [{ source: "npm:missing", scope: "user" }],
    runCommand: async () => {
      throw new Error("should not run");
    },
  });
  assert.equal(missing[0].state, "error");
  assert.match(missing[0].message, /not installed/i);

  const installedPath = installedPackage(t);
  const failed = await checkPluginUpdates("/tmp", undefined, {
    packages: [{ source: "npm:failed", scope: "user", installedPath }],
    runCommand: async () => {
      throw new Error("registry unavailable");
    },
  });
  assert.equal(failed[0].state, "error");
  assert.equal(failed[0].message, "registry unavailable");
});

test("npm checks compare the installed version with the selected range", async (t) => {
  const rangePath = installedPackage(t, "1.2.0");
  const latestPath = installedPackage(t, "2.0.0");
  const results = await checkPluginUpdates("/tmp", undefined, {
    packages: [
      { source: "npm:range@^1.2", scope: "user", installedPath: rangePath },
      { source: "npm:stable@latest", scope: "project", installedPath: latestPath },
    ],
    runCommand: async (_command, args) => args[1] === "range@^1.2"
      ? JSON.stringify(["1.2.0", "1.3.0", "2.0.0"])
      : JSON.stringify("2.0.0"),
  });

  assert.deepEqual(results.map((item) => item.state), ["update-available", "up-to-date"]);
});

test("Git checks compare local HEAD with the upstream remote ref", async (t) => {
  const installedPath = installedPackage(t);
  const local = "a".repeat(40);
  let remote = local;
  const refs = [];
  const runCommand = async (_command, args) => {
    if (args[0] === "rev-parse" && args[1] === "HEAD") return `${local}\n`;
    if (args[0] === "rev-parse") return "origin/main\n";
    refs.push(args[2]);
    return `${remote}\trefs/heads/main\n`;
  };
  const packages = [{ source: "git:github.com/user/repo", scope: "user", installedPath }];

  const current = await checkPluginUpdates("/tmp", undefined, { packages, runCommand });
  remote = "b".repeat(40);
  const available = await checkPluginUpdates("/tmp", undefined, { packages, runCommand });

  assert.equal(current[0].state, "up-to-date");
  assert.equal(available[0].state, "update-available");
  assert.deepEqual(refs, ["refs/heads/main", "refs/heads/main"]);
});
