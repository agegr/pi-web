import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ChatActivityStatus } = await jiti.import("./ChatActivityStatus.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { getRunningSubagents } = await jiti.import("@/lib/session-family");
const { getLocalePlugin } = await jiti.import("@/lib/i18n/registry");
const { translateMessage } = await jiti.import("@/lib/i18n/format");

function child(id, description, status = "running") {
  return {
    id,
    relation: { kind: "subagent", parentSessionId: "main", profile: "explore", description, status },
  };
}

function renderStatus(props = {}) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(ChatActivityStatus, { label: null, commandRunning: false, ...props })));
}

test("hides the whole status when no agent or command is active", () => {
  assert.equal(renderStatus(), "");
  assert.equal(renderStatus({ runningSubagents: [] }), "");
});

test("shows count and descriptions below the main phase without an Agents click", () => {
  const html = renderStatus({
    label: "Waiting for model...",
    runningSubagents: [child("a", "Check config"), child("b", "Read logs"), child("c", "Verify fix")],
  });
  assert.match(html, /3 subagents running \(Check config, Read logs, Verify fix\)/);
  assert.ok(html.indexOf("Waiting for model...") < html.indexOf("3 subagents running"));
  assert.match(html, /role="status"/);
  assert.match(html, /break-words/);
});

test("keeps background status when the main agent is idle or streaming", () => {
  const html = renderStatus({ runningSubagents: [child("a", "Review")] });
  assert.match(html, /1 subagent running \(Review\)/);
  assert.doesNotMatch(html, /Waiting for model|animate-/);
});

test("removes settled runs and their descriptions using the live running list", () => {
  const subagents = [
    child("active", "Still running", "completed"), // Persisted status may lag a resume.
    child("done", "Done", "completed"),
    child("stopped", "Stopped", "aborted"),
    child("error", "Error", "failed"),
    child("interrupted", "Interrupted", "interrupted"),
    child("queued", "Queued", "queued"),
  ];
  const html = renderStatus({ runningSubagents: getRunningSubagents(subagents, new Set(["active", "elsewhere"])) });
  assert.match(html, /1 subagent running \(Still running\)/);
  assert.doesNotMatch(html, /Done|Stopped|Error|Interrupted|Queued/);
  assert.equal(renderStatus({ runningSubagents: getRunningSubagents(subagents, new Set()) }), "");
});

test("preserves phase and shell command labels without subagents", () => {
  const html = renderStatus({ label: "Compacting context...", commandRunning: true });
  assert.match(html, /Compacting context\.\.\./);
  assert.match(html, /Running command\.\.\./);
  assert.doesNotMatch(html, /subagent|role="status"/);
});

test("keeps full long descriptions, escapes markup and falls back for a blank description", () => {
  const description = `Check ${"very-long-task-".repeat(80)}<script>alert(1)</script>`;
  const html = renderStatus({ runningSubagents: [child("a", description), child("b", "  ")] });
  assert.ok(html.includes(description.replaceAll("<", "&lt;").replaceAll(">", "&gt;")));
  assert.match(html, /, explore\)/);
  assert.doesNotMatch(html, /<script|truncate|line-clamp/);
});

test("provides count and description translations in every supported locale", () => {
  const expected = {
    en: ["1 subagent running (Check)", "3 subagents running (Check, Logs, Verify)"],
    "zh-CN": ["有 1 个子代理正在运行（检查）", "有 3 个子代理正在运行（检查、日志、验证）"],
    "zh-TW": ["有 1 個子代理正在執行（檢查）", "有 3 個子代理正在執行（檢查、日誌、驗證）"],
  };
  for (const [locale, values] of Object.entries(expected)) {
    const messages = { [locale]: getLocalePlugin(locale).messages };
    const english = locale === "en";
    assert.equal(translateMessage(locale, "chat.runningSubagent", messages, {
      count: 1, descriptions: english ? "Check" : locale === "zh-CN" ? "检查" : "檢查",
    }), values[0]);
    assert.equal(translateMessage(locale, "chat.runningSubagents", messages, {
      count: 3, descriptions: english ? "Check, Logs, Verify" : locale === "zh-CN" ? "检查、日志、验证" : "檢查、日誌、驗證",
    }), values[1]);
  }
});

test("wires the family running list into the chat, independent of the main phase", () => {
  const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
  const chat = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(shell, /runningSubagents=\{activeSessionFamily \? getRunningSubagents\(activeSessionFamily\.subagents, runningSessionIds\) : \[\]\}/);
  assert.match(chat, /<ChatActivityStatus\s+label=\{agentRunning && !hasStreamingContent \? phaseLabel\(agentPhase, t, isCompacting\) : null\}\s+commandRunning=\{bashRunning && !pendingBash\}\s+runningSubagents=\{runningSubagents\}/);
});
