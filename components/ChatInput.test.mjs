import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ChatInput, ModelErrorBanner, ModelScopeWarningBanner, filterModelOptions } = await jiti.import("./ChatInput.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

test("renders the upstream model error", () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelErrorBanner, {
      error: "Invalid models.json schema:\nproviders.custom.models.0.id must not be empty",
    }),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Model error/);
  assert.match(html, /providers\.custom\.models\.0\.id must not be empty/);
});

test("does not render an empty model error", () => {
  assert.equal(renderToStaticMarkup(React.createElement(ModelErrorBanner, { error: null })), "");
});

test("renders enabledModels scope warnings", () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelScopeWarningBanner, {
      warnings: ['No models match pattern "ghost-gateway/*"'],
    }),
  );

  assert.match(html, /Model scope warning/);
  assert.match(html, /ghost-gateway/);
  assert.equal(renderToStaticMarkup(React.createElement(ModelScopeWarningBanner, { warnings: [] })), "");
});

test("keeps the model selector visible when a model error leaves no options", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        isStreaming: false,
        modelError: "Invalid models.json schema",
        modelList: [],
        modelNames: {},
      }),
    ),
  );

  assert.match(html, />No models</);
  assert.match(html, /title="No available models"/);
});

test("filters model options by name and id", () => {
  const options = [
    { provider: "ollama", modelId: "qwen3:latest", name: "Qwen 3" },
    { provider: "anthropic", modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { provider: "openai", modelId: "gpt-5.4", name: "GPT-5.4" },
  ];

  assert.deepEqual(filterModelOptions(options, "QWEN"), [options[0]]);
  assert.deepEqual(filterModelOptions(options, "claude-sonnet"), [options[1]]);
  assert.equal(filterModelOptions(options, "OpenAI").length, 0);
  assert.equal(filterModelOptions(options, "anthropic/claude").length, 0);
  assert.equal(filterModelOptions(options, "missing").length, 0);
  assert.equal(filterModelOptions(options, "  "), options);
});

test("renders compact errors above the input as a wrapping alert", () => {
  const error = "Compaction failed: OpenAI API error (403): <html>request forbidden</html>";
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onCompact() {},
        isStreaming: false,
        compactError: error,
      }),
    ),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Compaction failed: OpenAI API error/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
  assert.match(html, /white-space:pre-wrap/);
  assert.ok(html.indexOf('role="alert"') < html.indexOf("<textarea"));
});

test("renders the worktree selector only for a new session", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        isStreaming: false,
        cwd: "/repo",
        newSessionCwd: "/repo-wt",
        newSessionWorktrees: [
          { path: "/repo", branch: "main", isMain: true },
          { path: "/repo-wt", branch: "feature/test", isMain: false },
        ],
      }),
    ),
  );
  assert.match(html, /选择 worktree/);
  assert.match(html, /feature\/test/);
});

const thinkingBaseProps = {
  onSend() {}, onAbort() {}, isStreaming: false,
  model: "test-model", modelNames: [], modelList: [], modelError: null, modelScopeWarnings: [],
  onModelChange() {}, thinkingLevel: "high", onThinkingLevelChange() {},
  availableThinkingLevels: null, thinkingLevelMap: null,
};

test("streaming shows read-only thinking badge before Stop", () => {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null,
      React.createElement(ChatInput, { ...thinkingBaseProps, isStreaming: true })),
  );
  const badgeIndex = html.indexOf(">high</span>");
  assert.ok(badgeIndex > -1, "badge should show current thinking level");
  const stopIndex = html.indexOf(">Stop<");
  assert.ok(stopIndex > -1, "stop button should render");
  assert.ok(stopIndex > badgeIndex, "badge should appear before stop button");
  const badgeOpen = html.lastIndexOf("<div", badgeIndex);
  const beforeBadge = html.slice(Math.max(0, badgeOpen - 200), badgeOpen);
  assert.ok(!beforeBadge.includes("cursor:pointer"), "badge should not be clickable");
});

test("idle renders the interactive thinking button instead of the badge", () => {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null,
      React.createElement(ChatInput, thinkingBaseProps)),
  );
  assert.ok(html.includes('aria-label="Change reasoning level"'), "idle thinking button has aria-label");
  assert.ok(!html.includes(">Stop<"), "no stop button when idle");
});

test("streaming badge shows the mapped level label when thinkingLevelMap is set", () => {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null,
      React.createElement(ChatInput, {
        ...thinkingBaseProps,
        isStreaming: true,
        thinkingLevelMap: { high: "claude thinking" },
      })),
  );
  assert.ok(html.includes(">claude thinking</span>"), "badge should show mapped label");
});

test("streaming without thinkingLevel hides the badge but keeps Stop", () => {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null,
      React.createElement(ChatInput, { ...thinkingBaseProps, isStreaming: true, thinkingLevel: undefined })),
  );
  assert.ok(!html.includes(">high</span>"), "no badge when thinkingLevel is undefined");
  assert.ok(html.includes(">Stop<"), "stop button still renders");
});

test("clearing an accepted new-session prompt cannot restore its draft", async () => {
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const clearInputSource = source.slice(
    source.indexOf("const clearInput = useCallback"),
    source.indexOf("useEffect(() =>", source.indexOf("const clearInput = useCallback")),
  );
  const persistStart = source.indexOf("// 发送清空或切换草稿 key 时");
  const persistDraftSource = source.slice(
    persistStart,
    source.indexOf("useEffect(() =>", persistStart + 1),
  );

  assert.match(clearInputSource, /valueRef\.current = "";[\s\S]*?setValue\(""\)/);
  assert.match(clearInputSource, /attachedImagesRef\.current = \[\]/);
  assert.match(persistDraftSource, /draftKeyRef\.current !== draftKey \|\| valueRef\.current !== value/);
});
