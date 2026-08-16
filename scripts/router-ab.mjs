#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const baseUrl = valueAfter("--base-url") ?? "http://127.0.0.1:30144";
const cwd = valueAfter("--cwd") ?? process.cwd();
const prompt = valueAfter("--prompt");
const selectedMode = valueAfter("--mode") ?? "both";

if (!["off", "auto", "both"].includes(selectedMode)) {
  console.error("--mode must be off, auto, or both");
  process.exit(1);
}

if (!prompt) {
  console.error("Usage: node scripts/router-ab.mjs --prompt <task> [--base-url URL] [--cwd PATH] [--mode off|auto|both]");
  process.exit(1);
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  return JSON.parse(text);
}

async function waitForIdle(sessionId) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const state = await post(`/api/agent/${sessionId}`, { type: "get_state" });
    if (!state.data?.isStreaming && !state.data?.isPromptRunning) return state.data;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for session ${sessionId}`);
}

async function readSessionMetrics(sessionFile) {
  const lines = await readFile(sessionFile, "utf8");
  const entries = lines.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const messages = entries.filter((entry) => entry.type === "message").map((entry) => entry.message);
  const toolResults = messages.filter((message) => message?.role === "toolResult");
  return {
    routerEntries: entries
      .filter((entry) => entry.type === "custom" && String(entry.customType).startsWith("pi-web-router-"))
      .map((entry) => ({ customType: entry.customType, data: entry.data })),
    toolCalls: messages.reduce((total, message) => total + (message?.role === "assistant"
      ? (Array.isArray(message.content) ? message.content.filter((block) => block?.type === "toolCall").length : 0)
      : 0), 0),
    toolErrors: toolResults.filter((message) => message?.isError === true).length,
  };
}

async function run(mode) {
  const created = await post("/api/agent/new", { cwd, type: "ensure_session" });
  const sessionId = created.sessionId;
  await post(`/api/agent/${sessionId}`, { type: "run_command", name: "router", args: mode });

  const startedAt = performance.now();
  await post(`/api/agent/${sessionId}`, { type: "prompt", message: prompt });
  const state = await waitForIdle(sessionId);
  const finishedAt = performance.now();
  const reply = await post(`/api/agent/${sessionId}`, { type: "get_last_assistant_text" });
  const metrics = await readSessionMetrics(state.sessionFile);

  return {
    mode,
    sessionId,
    resolved: metrics.routerEntries.findLast((entry) => entry.customType === "pi-web-router-resolved")?.data?.mode ?? null,
    durationMs: Math.round(finishedAt - startedAt),
    model: state.model,
    response: reply.data?.text ?? "",
    ...metrics,
  };
}

const modes = selectedMode === "both" ? ["off", "auto"] : [selectedMode];
const results = [];
for (const mode of modes) results.push(await run(mode));
console.log(JSON.stringify({ baseUrl, cwd, prompt, results }, null, 2));
