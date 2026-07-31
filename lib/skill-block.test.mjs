import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseSkillBlock, parseSkillMessage } = await jiti.import("./skill-block.ts");

test("解析 skill 正文和附加用户输入", () => {
  assert.deepEqual(
    parseSkillBlock('<skill name="pdf" location="/skills/pdf/SKILL.md">\n完整说明\n</skill>\n\n检查 report.pdf'),
    {
      name: "pdf",
      location: "/skills/pdf/SKILL.md",
      content: "完整说明",
      userMessage: "检查 report.pdf",
    },
  );
});

test("普通用户消息不按 skill 处理", () => {
  assert.equal(parseSkillBlock("普通消息"), null);
});

test("解析多个 skill 和共享的附加输入", () => {
  assert.deepEqual(
    parseSkillMessage('<skill name="ssh" location="/ssh/SKILL.md">\nSSH 说明\n</skill>\n\n<skill name="database" location="/database/SKILL.md">\n数据库说明\n</skill>\n\n测试连接'),
    {
      skills: [
        { name: "ssh", location: "/ssh/SKILL.md", content: "SSH 说明" },
        { name: "database", location: "/database/SKILL.md", content: "数据库说明" },
      ],
      userMessage: "测试连接",
    },
  );
});
