import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { DetachedSubagentStatusPanel } = await jiti.import("./DetachedSubagentStatusPanel.tsx");
const messages = {
  "chat.subagentsTitle": "后台子代理状态",
  "chat.subagentsRunning": "后台子代理 · {count} 个运行中",
  "chat.subagentsNoTask": "未提供任务描述",
  "chat.subagentsStateRunning": "运行中",
  "chat.subagentsStateFailed": "失败",
  "chat.subagentsStateAwaitingResume": "已完成，等待主代理接管",
  "chat.subagentsStateAwaitingNextTurn": "已完成，等待下一轮",
};
const t = (key, params = {}) => Object.entries(params).reduce(
  (text, [name, value]) => text.replace(`{${name}}`, String(value)),
  messages[key] ?? key,
);
test("shows running subagent mode and task", () => {
  const html = renderToStaticMarkup(React.createElement(DetachedSubagentStatusPanel, {
    statuses: [{
      id: "sa_1",
      agent: "worker",
      task: "实现 Go 管理端",
      mode: "auto-resume",
      state: "running",
    }],
    t,
  }));

  assert.match(html, /后台子代理 · 1 个运行中/);
  assert.match(html, /worker · auto-resume/);
  assert.match(html, /实现 Go 管理端/);
  assert.match(html, />运行中</);
  assert.match(html, /width:calc\(100% - 32px\)/);
});

test("distinguishes completion delivery states", () => {
  const html = renderToStaticMarkup(React.createElement(DetachedSubagentStatusPanel, {
    statuses: [
      { id: "sa_auto", agent: "reviewer", task: "审查", mode: "auto-resume", state: "completed" },
      { id: "sa_next", agent: "worker", task: "调研", mode: "next-turn", state: "completed" },
    ],
    t,
  }));

  assert.match(html, /已完成，等待主代理接管/);
  assert.match(html, /已完成，等待下一轮/);
});
