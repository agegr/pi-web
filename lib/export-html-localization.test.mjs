import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { localizeExportHtml, resolveExportLocale } =
  await jiti.import("./export-html-localization.ts");

const exporterDir = new URL(
  "../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/",
  import.meta.url,
);
const templateHtml = readFileSync(new URL("template.html", exporterDir), "utf8");
const templateJs = readFileSync(new URL("template.js", exporterDir), "utf8");
const exporterFixture = `${templateHtml}\n<script>${templateJs}</script>`;

test("resolves only supported export locales", () => {
  assert.equal(resolveExportLocale("zh-CN"), "zh-CN");
  assert.equal(resolveExportLocale("en"), "en");
  assert.equal(resolveExportLocale("zh"), "en");
  assert.equal(resolveExportLocale(null), "en");
});

test("leaves the exporter unchanged for English", () => {
  assert.equal(localizeExportHtml(exporterFixture, "en"), exporterFixture);
});

test("localizes the standalone export controls and generated UI for Simplified Chinese", () => {
  const localized = localizeExportHtml(exporterFixture, "zh-CN");
  const localizedJs = localizeExportHtml(templateJs, "zh-CN");

  assert.doesNotThrow(() => new Function(localizedJs));

  for (const expected of [
    '<html lang="zh-CN">',
    "<title>会话导出</title>",
    'placeholder="搜索..."',
    ">默认</button>",
    ">无工具</button>",
    ">用户</button>",
    ">已标记</button>",
    ">全部</button>",
    "个条目",
    "复制此消息的链接",
    "思考中...",
    "分支摘要",
    "会话：",
    "T 切换思考内容 · O 切换工具输出",
    "系统提示词",
    "可用工具",
  ]) {
    assert.match(localized, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const removed of [
    "<title>Session Export</title>",
    'placeholder="Search..."',
    "Copy link to this message",
    "T toggle thinking · O toggle tools",
    '<div class="system-prompt-header">System Prompt</div>',
    '<div class="tools-header">Available Tools</div>',
  ]) {
    assert.doesNotMatch(localized, new RegExp(removed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("does not translate encoded session content", () => {
  const sessionData = '<script id="session-data" type="application/json">VGhpbmtpbmcgLi4u</script>';
  const localized = localizeExportHtml(`${exporterFixture}\n${sessionData}`, "zh-CN");
  assert.match(localized, /VGhpbmtpbmcgLi4u/);
});
