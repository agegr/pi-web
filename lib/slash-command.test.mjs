import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { applySlashSelection, findSlashQuery } = await jiti.import("./slash-command.ts");

test("识别输入开头的斜杠查询", () => {
  assert.deepEqual(findSlashQuery("/skill:pdf"), {
    query: "skill:pdf",
    start: 0,
    inline: false,
  });
});

test("识别已有正文后的斜杠查询", () => {
  const slash = findSlashQuery("分析这个文件 /pdf");
  assert.deepEqual(slash, { query: "pdf", start: 7, inline: true });
  assert.equal(
    applySlashSelection("分析这个文件 /pdf", slash, "skill:pdf"),
    "/skill:pdf 分析这个文件 ",
  );
});

test("忽略已带参数或不完整的斜杠片段", () => {
  assert.equal(findSlashQuery("/skill:pdf 分析"), null);
  assert.equal(findSlashQuery("路径/foo"), null);
});
