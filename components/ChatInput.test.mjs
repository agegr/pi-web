import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
import ts from "typescript";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ChatInput, ModelErrorBanner, ModelScopeWarningBanner, canRestoreUserMessage, filterModelOptions, getUpwardMenuMaxHeight, getUserMessageText, getUserMessageDraftImages } = await jiti.import("./ChatInput.tsx");
const { clearDraft, getDraft, mergeRestoredSubmissionDraft, mergeRestoredSubmissionText, rekeyDraft, setDraft } = await jiti.import("../lib/draft-store.ts");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

test("follow-up shortcuts preserve newline, IME, mobile and completion behavior", () => {
  const source = ts.createSourceFile("ChatInput.tsx", readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function findHandler(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "handleKeyDown") {
      return node.initializer.arguments[0];
    }
    return ts.forEachChild(node, findHandler);
  }
  // Execute the component's actual callback without mounting the rest of the UI.
  const script = new Script(ts.transpileModule(findHandler(source).getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText);
  const cases = [
    ["Enter steers", {}, {}, "steer"],
    ["Alt+Enter follows up", { altKey: true }, {}, "followup"],
    ["idle Alt+Enter sends", { altKey: true }, { isStreaming: false }, "send"],
    ["Shift+Enter inserts a newline", { shiftKey: true }, {}, "native"],
    ["Alt+Shift+Enter keeps native behavior", { altKey: true, shiftKey: true }, {}, "native"],
    ["composition ref blocks sending", { altKey: true }, { isComposingRef: { current: true } }, "native"],
    ["native composition blocks sending", { altKey: true, nativeEvent: { isComposing: true } }, {}, "native"],
    ["IME keyCode blocks sending", { altKey: true, nativeEvent: { keyCode: 229 } }, {}, "native"],
    ["composition grace blocks sending", { altKey: true }, { lastCompositionEndAtRef: { current: 950 } }, "prevented"],
    ["mobile Alt+Enter keeps native behavior", { altKey: true }, { isMobile: true }, "native"],
    ["mobile composition grace cannot send", { altKey: true }, { isMobile: true, lastCompositionEndAtRef: { current: 950 } }, "native"],
    ["mobile Ctrl+Alt+Enter follows up", { altKey: true, ctrlKey: true }, { isMobile: true }, "followup"],
    ["mobile Cmd+Alt+Enter follows up", { altKey: true, metaKey: true }, { isMobile: true }, "followup"],
    ["mobile modified Enter respects composition grace", { altKey: true, ctrlKey: true }, { isMobile: true, lastCompositionEndAtRef: { current: 950 } }, "prevented"],
    ["Enter falls back to follow-up", {}, { onSteer: undefined }, "followup"],
    ["Alt+Enter falls back to steer", { altKey: true }, { onFollowUp: undefined }, "steer"],
    ["slash completion takes priority", { altKey: true }, { slashMenuOpen: true, slashQuery: "help" }, "slash"],
    ["file completion takes priority", { altKey: true }, { atMenuOpen: true, atQuery: {} }, "file"],
    ["history selection takes priority", { altKey: true }, { historyMenuOpen: true }, "history"],
  ];
  for (const [name, keys, state, expected] of cases) {
    let action = "native";
    const handler = script.runInNewContext({
      Date: { now: () => 1000 },
      COMPOSITION_END_ENTER_GRACE_MS: 100,
      isMobile: false, isStreaming: true,
      isComposingRef: { current: false }, lastCompositionEndAtRef: { current: 0 },
      historyMenuOpen: false, inputHistory: ["previous"], historyActiveIndex: 0,
      slashMenuOpen: false, slashQuery: null, displayedSlashCommands: [{}], slashActiveIndex: 0,
      atMenuOpen: false, atQuery: null, atMatches: [{}], atActiveIndex: 0,
      onSteer() {}, onFollowUp() {},
      sendQueued(mode) { action = mode; }, handleSend() { action = "send"; },
      applySlashCommand() { action = "slash"; },
      applyAtCompletion() { action = "file"; },
      applyHistoryInput() { action = "history"; },
      ...state,
    });
    handler({
      key: "Enter", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
      nativeEvent: { isComposing: false, keyCode: 13 },
      preventDefault() { action = "prevented"; },
      ...keys,
    });
    assert.equal(action, expected, name);
  }
});

test("shows the follow-up shortcut in the button tooltip", () => {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(ChatInput, {
      onSend() {}, onAbort() {}, onFollowUp() {}, isStreaming: true,
    })),
  );

  assert.match(html, /title="Queue this message after the agent finishes \(Alt\/Option\+Enter\)"/);
  assert.match(html, /aria-keyshortcuts="Alt\+Enter"/);
});

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

test("renders the read-only tool preset as the active selection", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onToolPresetChange() {},
        isStreaming: false,
        toolPreset: "read-only",
      }),
    ),
  );

  assert.match(html, /title="Change tool preset: read-only"/);
  assert.match(html, />read-only<\/span>/);
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
