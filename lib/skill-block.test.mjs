import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseSkillBlock } = await jiti.import("./skill-block.ts");

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
