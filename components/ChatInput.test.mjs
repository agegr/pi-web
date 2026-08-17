import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ChatInput, ModelErrorBanner, ModelScopeWarningBanner, canRestoreUserMessage, composerThinkingBadgeLevel, filterModelOptions, getUpwardMenuMaxHeight, getUserMessageText, getUserMessageDraftImages } = await jiti.import("./ChatInput.tsx");
const { clearDraft, getDraft, mergeRestoredSubmissionDraft, mergeRestoredSubmissionText, rekeyDraft, setDraft } = await jiti.import("../lib/draft-store.ts");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

test("renders the upstream model error", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ModelErrorBanner, {
        error: "Invalid models.json schema:\nproviders.custom.models.0.id must not be empty",
      }),
    ),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Model error/);
  assert.match(html, /providers\.custom\.models\.0\.id must not be empty/);
});

test("does not render an empty model error", () => {
  assert.equal(
    renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(ModelErrorBanner, { error: null }))),
    "",
  );
});

test("renders enabledModels scope warnings", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ModelScopeWarningBanner, {
        warnings: ['No models match pattern "ghost-gateway/*"'],
      }),
    ),
  );

  assert.match(html, /Model scope warning/);
  assert.match(html, /ghost-gateway/);
  assert.equal(
    renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(ModelScopeWarningBanner, { warnings: [] }))),
    "",
  );
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

test("shows the workspace hint inside the composer on the new-session home", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        isStreaming: false,
        cwd: "/Users/kale/pi-cwd-20260807",
        workspaceHint: "pi-cwd-20260807",
      }),
    ),
  );

  assert.match(html, /class="composer-workspace-hint"/);
  assert.match(html, /pi-cwd-20260807/);
  assert.match(html, /Working in pi-cwd-20260807/);
  assert.doesNotMatch(
    renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(ChatInput, {
          onSend() {},
          onAbort() {},
          onModelChange() {},
          isStreaming: false,
        }),
      ),
    ),
    /composer-workspace-hint/,
  );
});

test("lays out attach, access, model, and reasoning like the reference composer", () => {
  assert.equal(composerThinkingBadgeLevel("auto"), null);
  assert.equal(composerThinkingBadgeLevel("high"), "high");

  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        onThinkingLevelChange() {},
        onToolPresetChange() {},
        onCompact() {},
        isStreaming: false,
        model: { provider: "xai", modelId: "grok-4.6" },
        modelList: [{ provider: "xai", id: "grok-4.6", name: "grok-4.6" }],
        thinkingLevel: "high",
        toolPreset: "full",
      }),
    ),
  );

  assert.match(html, />Full access</);
  assert.match(html, />grok-4\.6</);
  assert.match(html, /data-thinking-badge="high"/);
  assert.doesNotMatch(html, />Compact context</);
  assert.doesNotMatch(html, /aria-label="More controls"/);
});

test("shows and locks the optimistic model while a switch is pending", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        isStreaming: false,
        model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
        modelList: [{ provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
        modelSwitching: true,
      }),
    ),
  );

  assert.match(html, /title="Switching model"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, />DeepSeek V4 Flash</);
  assert.match(html, /animation:spin 0\.8s linear infinite/);
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

test("caps an upward menu to the visible space above its anchor", () => {
  assert.equal(getUpwardMenuMaxHeight(343, 36), 299);
  assert.equal(getUpwardMenuMaxHeight(40, 36), 0);
});

test("restores text and base64 images when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "text", text: "Review this image @src/example.ts " },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ],
  };

  assert.equal(getUserMessageText(message), "Review this image @src/example.ts ");
  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/png" },
  ]);
});

test("restores legacy flat image entries when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "image", data: "AQID", mimeType: "image/jpeg" },
    ],
  };

  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/jpeg" },
  ]);
});

test("does not restore a historical message over a pending image attachment", () => {
  assert.equal(canRestoreUserMessage("", 0, 0), true);
  assert.equal(canRestoreUserMessage("", 1, 0), false);
  assert.equal(canRestoreUserMessage("", 0, 1), false);
  assert.equal(canRestoreUserMessage("draft", 0, 0), false);
});

test("restores a cleared submission using the queued React state", () => {
  let value = "failed submission";
  const updates = [
    () => "",
    (current) => mergeRestoredSubmissionText("failed submission", current),
  ];

  for (const update of updates) value = update(value);

  assert.equal(value, "failed submission");
  assert.equal(
    mergeRestoredSubmissionText("failed submission", "new draft"),
    "failed submission\n\nnew draft",
  );
  assert.equal(
    mergeRestoredSubmissionText("failed submission", "failed submission"),
    "failed submission\n\nfailed submission",
  );
});

test("keeps a failed first submission recoverable across a composer remount", () => {
  const image = { data: "AQID", mimeType: "image/png" };
  const restored = mergeRestoredSubmissionDraft(
    "failed submission",
    [image],
    "",
    [],
  );

  assert.deepEqual(restored, {
    value: "failed submission",
    images: [image],
  });
  assert.deepEqual(
    mergeRestoredSubmissionDraft("failed submission", [image], "new draft", []),
    {
      value: "failed submission\n\nnew draft",
      images: [image],
    },
  );
});

test("preserves duplicate image attachments when restoring a submission", () => {
  const image = { data: "AQID", mimeType: "image/png" };
  const restored = mergeRestoredSubmissionDraft("", [image, image], "", [image]);

  assert.deepEqual(restored.images, [image, image, image]);
});

test("moves a provisional new-session draft to the real session key", () => {
  const provisionalKey = "new:/tmp/rekey-test";
  const sessionKey = "session-rekey-test";
  clearDraft(provisionalKey);
  clearDraft(sessionKey);
  setDraft(provisionalKey, { value: "queued while preflight ran", images: [] });

  assert.deepEqual(rekeyDraft(provisionalKey, sessionKey), {
    value: "queued while preflight ran",
    images: [],
  });
  assert.equal(getDraft(provisionalKey), null);
  assert.deepEqual(getDraft(sessionKey), {
    value: "queued while preflight ran",
    images: [],
  });

  clearDraft(sessionKey);
});

test("rekey keeps a synchronously restored draft when React state is still empty", () => {
  const provisionalKey = "new:/tmp/rekey-race";
  const sessionKey = "session-rekey-race";
  clearDraft(provisionalKey);
  clearDraft(sessionKey);
  setDraft(provisionalKey, { value: "restored before state flush", images: [] });

  assert.deepEqual(
    rekeyDraft(provisionalKey, sessionKey, { value: "", images: [] }),
    { value: "restored before state flush", images: [] },
  );
  assert.equal(getDraft(provisionalKey), null);
  assert.deepEqual(getDraft(sessionKey), {
    value: "restored before state flush",
    images: [],
  });

  clearDraft(sessionKey);
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
        onClearCompactFeedback() {},
        isStreaming: false,
        compactError: error,
      }),
    ),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /compaction-feedback is-error/);
  assert.match(html, /Compaction failed: OpenAI API error/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
  assert.match(html, /aria-label="Dismiss compaction error"/);
  assert.ok(html.indexOf('role="alert"') < html.indexOf("<textarea"));
});

test("shows a live compaction status row above the composer", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onCompact() {},
        onAbortCompaction() {},
        isStreaming: false,
        isCompacting: true,
      }),
    ),
  );

  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Compacting context/);
  assert.match(html, />Stop</);
  assert.match(html, /compaction-feedback-spinner/);
  assert.ok(html.indexOf('role="status"') < html.indexOf("<textarea"));
});

test("replaces the running row with compact before and after token counts", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onCompact() {},
        isStreaming: false,
        compactResult: {
          reason: "manual",
          tokensBefore: 191000,
          estimatedTokensAfter: 42000,
        },
      }),
    ),
  );

  assert.match(html, /role="status"/);
  assert.match(html, /Context compacted/);
  assert.match(html, /191k -&gt; 42k · 149k freed/);
  assert.doesNotMatch(html, /Compacting context/);
});

test("keeps the running compaction row instead of a stale result", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onCompact() {},
        isStreaming: false,
        isCompacting: true,
        compactResult: {
          reason: "manual",
          tokensBefore: 191000,
          estimatedTokensAfter: 42000,
        },
        compactError: "Compaction failed",
      }),
    ),
  );

  assert.match(html, /Compacting context/);
  assert.doesNotMatch(html, /Context compacted/);
  assert.doesNotMatch(html, /role="alert"/);
});

test("keeps compaction actions coarse-pointer sized and still under reduced motion", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.compaction-feedback\.is-error \{[^}]*white-space: pre-wrap/);
  assert.match(css, /\.compaction-feedback-spinner \{[^}]*animation:/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.compaction-feedback-spinner \{[^}]*animation: none/);
  assert.match(css, /@media \(pointer: coarse\) \{\s*\.compaction-feedback-action \{[^}]*min-height: 44px/);
});

test("keeps composer chip labels from wrapping", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.composer-chip \{\s*display: flex;[^}]*white-space: nowrap/);
});

test("queue dock labels steering vs follow-up and only steers follow-ups", async () => {
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const start = source.indexOf("function QueueDock(");
  const end = source.indexOf("function ModelNoticeBanner(", start);
  const dock = source.slice(start, end);
  assert.match(dock, /t\("chat\.queueKindSteer"\)/);
  assert.match(dock, /t\("chat\.queueKindFollowUp"\)/);
  assert.match(dock, /item\.kind === "followUp"/);
});

test("streaming composer shows a clickable interject button that steers", async () => {
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  // Draft + running: visible 插话 button on desktop and mobile. Enter still
  // queues; the button / Cmd+Enter steers. A mobile-only follow-up send left
  // no way to click-guide the agent.
  assert.match(source, /\(value\.trim\(\) \|\| attachedImages\.length\) && onSteer/);
  assert.match(source, /onClick=\{?\(\) => sendQueued\(true\)/);
  assert.match(source, /t\("chat\.interject"\)/);
  assert.match(source, /chat\.interjectTitleMobile/);
  assert.match(source, /chat\.interjectTitle/);
  assert.match(source, /chat\.runningDraftPlaceholderMobile/);
  assert.match(source, /chat\.runningDraftPlaceholder/);
  assert.match(source, /chat\.agentPlaceholderMobile/);
  assert.match(source, /t\("chat\.composerLabel"\)/);
  assert.match(source, /background: "transparent"/);
  assert.match(source, /border: "1px solid var\(--border\)"/);
  assert.match(source, /isStreaming \? \(\s*<div style=\{\{ display: "flex", alignItems: "center", gap: 8/);
});

test("busy Enter queues, Cmd/Ctrl+Enter interjects, empty-draft chord flushes the queue", async () => {
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const sendQueued = useCallback");
  const end = source.indexOf("}, [value, attachedImages, onPromptWithStreamingBehavior", start);
  const sendQueued = source.slice(start, end);
  // "/" drafts always interject — pi executes extension commands immediately.
  assert.match(sendQueued, /onPromptWithStreamingBehavior\(msg, "steer", images\)/);
  assert.match(sendQueued, /const steer = accelerated \|\| !onFollowUp;/);
  assert.match(source, /const canSteerQueue = isStreaming/);
  assert.match(source, /if \(accelerated && canSteerQueue\) \{\s*\n\s*onSteerAllQueued\?\.\(\)/);
  assert.match(source, /sendQueued\(accelerated\)/);
});

test("IME grace does not swallow Cmd/Ctrl+Enter interject", async () => {
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const start = source.indexOf("if (sendShortcut && (isComposing || recentlyComposed))");
  const end = source.indexOf("if (historyMenuOpen && !isComposing)", start);
  const guard = source.slice(start, end);
  assert.ok(start >= 0 && end > start, "IME send guard should exist");
  assert.match(guard, /accelerated/);
  assert.match(guard, /isComposing \|\| !accelerated/);
});

test("clears slash commands before waiting for a builtin handler", async () => {
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const handleSend = useCallback");
  const end = source.indexOf("}, [value, attachedImages", start);
  const handleSend = source.slice(start, end);
  const clearAt = handleSend.indexOf("clearInput()");
  const awaitAt = handleSend.indexOf("await onBuiltinCommand");
  assert.ok(start >= 0 && end > start);
  assert.ok(clearAt >= 0, "handleSend should clear the composer");
  assert.ok(awaitAt >= 0, "handleSend should still wait for builtin commands");
  assert.ok(clearAt < awaitAt, "/compact must leave the input before compaction finishes");
});
