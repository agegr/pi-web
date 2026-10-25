import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { RunningSubagentsStatus } = await jiti.import("./RunningSubagentsStatus.tsx");
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

function renderStatus(runningSubagents) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(RunningSubagentsStatus, { runningSubagents })));
}

test("hides the entire block and icon when no subagents run", () => {
  assert.equal(renderStatus(), "");
  assert.equal(renderStatus([]), "");
});

test("shows count and descriptions without needing the main phase or an Agents click", () => {
  const html = renderStatus([child("a", "Check config"), child("b", "Read logs"), child("c", "Verify fix")]);
  assert.match(html, /3 subagents running \(Check config, Read logs, Verify fix\)/);
  assert.match(html, /role="status"/);
  assert.match(html, /break-words/);
  assert.doesNotMatch(html, /Waiting for model|Running command|pulse_1/);
});

test("shows a decorative four-square spinner before the text", () => {
  const html = renderStatus([child("a", "Review")]);
  assert.equal((html.match(/<svg\b/g) ?? []).length, 1);
  assert.equal((html.match(/<rect\b/g) ?? []).length, 4);
  assert.match(html, /animate-spin/);
  assert.match(html, /animation-duration:2\.4s/);
  assert.match(html, /motion-reduce:animate-none/);
  assert.match(html, /aria-hidden="true" focusable="false"/);
  assert.match(html, /fill="currentColor"/);
  assert.ok(html.indexOf("<svg") < html.indexOf("1 subagent running"));
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
  const html = renderStatus(getRunningSubagents(subagents, new Set(["active", "elsewhere"])));
  assert.match(html, /1 subagent running \(Still running\)/);
  assert.doesNotMatch(html, /Done|Stopped|Error|Interrupted|Queued/);
  assert.equal(renderStatus(getRunningSubagents(subagents, new Set())), "");
});

test("keeps full long descriptions, escapes markup and falls back for a blank description", () => {
  const description = `Check ${"very-long-task-".repeat(80)}<script>alert(1)</script>`;
  const html = renderStatus([child("a", description), child("b", "  ")]);
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

test("inserts the independent block while preserving both original status blocks in ChatWindow", () => {
  const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
  const chat = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const component = readFileSync(new URL("./RunningSubagentsStatus.tsx", import.meta.url), "utf8");
  const mainPhase = `{agentRunning && !hasStreamingContent && (agentPhase || isCompacting) && (
              <div className="break-words py-2 text-[13px] text-text-muted">
                <span className="animate-[pulse_1.5s_infinite]">{phaseLabel(agentPhase, t, isCompacting)}</span>
              </div>
            )}`;
  const command = `{bashRunning && !pendingBash && (
              <div className="py-2 text-[13px] text-text-muted">
                 <span className="animate-[pulse_1.5s_infinite]">{t("chat.runningCommand")}</span>
              </div>
            )}`;
  const subagentBlock = "<RunningSubagentsStatus runningSubagents={runningSubagents} />";
  assert.match(shell, /runningSubagents=\{activeSessionFamily \? getRunningSubagents\(activeSessionFamily\.subagents, runningSessionIds\) : \[\]\}/);
  assert.ok(chat.includes(mainPhase), "The main phase condition, markup and pulse stay unchanged in ChatWindow");
  assert.ok(chat.includes(command), "The command condition, markup and pulse stay unchanged in ChatWindow");
  assert.ok(chat.indexOf(mainPhase) < chat.indexOf(subagentBlock));
  assert.ok(chat.indexOf(subagentBlock) < chat.indexOf(command));
  assert.doesNotMatch(component, /phaseLabel|commandRunning|agentRunning|hasStreamingContent|pulse_1/);
  assert.doesNotMatch(chat, /ChatActivityStatus/);
});
