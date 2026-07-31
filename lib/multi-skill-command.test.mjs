import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { expandMultiSkillCommand } = await jiti.import("./multi-skill-command.ts");

test("展开多个 skill 并保留共享用户输入", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-skills-"));
  const sshPath = join(dir, "ssh.md");
  const databasePath = join(dir, "database.md");
  writeFileSync(sshPath, "---\nname: ssh\n---\nSSH 说明\n");
  writeFileSync(databasePath, "数据库说明\n");

  const result = expandMultiSkillCommand(
    "/skill:ssh /skill:database 测试连接",
    [
      { name: "ssh", filePath: sshPath, baseDir: dir },
      { name: "database", filePath: databasePath, baseDir: dir },
    ],
  );

  assert.equal(result.expanded, true);
  assert.match(result.text, /<skill name="ssh"[\s\S]*SSH 说明[\s\S]*<skill name="database"/);
  assert.ok(result.text.endsWith("\n\n测试连接"));
});
