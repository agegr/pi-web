import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

test("file previews show raw lines even when Git has a textconv driver", async () => {
  const { getGitFileDiff } = await createJiti(import.meta.url).import("./git-changes.ts");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-textconv-"));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  try {
    git("init", "-q");
    git("config", "core.fsmonitor", "false");
    fs.writeFileSync(path.join(root, "upper.cjs"), 'const fs = require("node:fs"); process.stdout.write(fs.readFileSync(process.argv[2], "utf8").toUpperCase());');
    git("config", "diff.upper.textconv", `"${process.execPath.replaceAll("\\", "/")}" upper.cjs`);
    fs.writeFileSync(path.join(root, ".gitattributes"), "*.txt diff=upper\n");
    const file = path.join(root, "note.txt");
    fs.writeFileSync(file, "old content\n");
    git("add", ".");
    git("-c", "user.name=Pi Web Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Initial text");
    fs.writeFileSync(file, "new content\n");
    assert.match(git("diff", "HEAD").toString(), /NEW CONTENT/);
    const result = await getGitFileDiff(root, file);
    assert.equal(result.supported, true);
    assert.match(result.patch, /\+new content/);
    assert.doesNotMatch(result.patch, /NEW CONTENT/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
