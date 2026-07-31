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

test("识别紧跟在已有正文后的斜杠查询", () => {
  const slash = findSlashQuery("分析这个文件/pdf");
  assert.deepEqual(slash, { query: "pdf", start: 6, inline: true });
  assert.equal(
    applySlashSelection("分析这个文件/pdf", slash, "skill:pdf"),
    "/skill:pdf 分析这个文件 ",
  );
});

test("忽略已带参数或不完整的斜杠片段", () => {
  assert.equal(findSlashQuery("/skill:pdf 分析"), null);
  assert.equal(findSlashQuery("路径/foo/bar"), null);
});

test("连续输入斜杠仍打开同一个查询", () => {
  assert.deepEqual(findSlashQuery("你还 ////"), {
    query: "",
    start: 3,
    inline: true,
  });
});

test("连续选择多个 skill 时保留全部 skill，并把用户输入放在最后", () => {
  const value = "/skill:agent-ssh-cli 测试连接 /data";
  const slash = findSlashQuery(value);
  assert.deepEqual(slash, { query: "data", start: 26, inline: true });
  assert.equal(
    applySlashSelection(value, slash, "skill:agent-database-cli"),
    "/skill:agent-ssh-cli /skill:agent-database-cli 测试连接 ",
  );
});
