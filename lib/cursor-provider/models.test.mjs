import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  estimateModelCost,
  inferContextWindow,
  parseModelId,
  processModels,
  resolveCursorWireModelId,
  thinkingLevelMapFromEfforts,
  toProviderModelConfig,
} = await jiti.import("./models.ts");

function model(id, name = id) {
  return { id, name, reasoning: false, contextWindow: 200000, maxTokens: 64000 };
}

test("parses Cursor effort and speed suffixes", () => {
  assert.deepEqual(parseModelId("gpt-5.4-high-fast"), {
    base: "gpt-5.4",
    effort: "high",
    fast: true,
    thinking: false,
  });
  assert.deepEqual(parseModelId("claude-4.6-opus-max-thinking"), {
    base: "claude-4.6-opus",
    effort: "max",
    fast: false,
    thinking: true,
  });
  assert.deepEqual(parseModelId("gemini-3.6-flash-minimal"), {
    base: "gemini-3.6-flash",
    effort: "minimal",
    fast: false,
    thinking: false,
  });
  assert.deepEqual(parseModelId("composer-2"), {
    base: "composer-2",
    effort: "",
    fast: false,
    thinking: false,
  });
});

test("collapses Cursor Grok 4.6 siblings into one model with xhigh thinking", () => {
  const processed = processModels([
    model("cursor-grok-4.6-low", "Cursor Grok 4.6 Low"),
    model("cursor-grok-4.6-medium", "Cursor Grok 4.6 Medium"),
    model("cursor-grok-4.6-high", "Cursor Grok 4.6"),
    model("cursor-grok-4.6-xhigh", "Cursor Grok 4.6 Extra High"),
    model("cursor-grok-4.6-medium-fast", "Cursor Grok 4.6 Medium Fast"),
    model("cursor-grok-4.6-xhigh-fast", "Cursor Grok 4.6 Extra High Fast"),
    model("composer-2", "Composer 2"),
  ]);
  const grok = processed.find((entry) => entry.id === "cursor-grok-4.6");
  const grokFast = processed.find((entry) => entry.id === "cursor-grok-4.6-fast");
  const composer = processed.find((entry) => entry.id === "composer-2");
  assert.equal(grok?.name, "Cursor Grok 4.6");
  assert.ok(grok?.supportsEffort);
  assert.deepEqual(grok.availableEfforts, ["low", "medium", "high", "xhigh"]);
  assert.ok(grokFast?.supportsEffort);
  assert.equal(composer?.supportsEffort, false);
  assert.equal(processed.some((entry) => entry.id === "cursor-grok-4.6-xhigh"), false);

  const config = toProviderModelConfig(grok);
  assert.equal(config.reasoning, true);
  assert.equal(config.thinkingLevelMap.xhigh, "xhigh");
  assert.equal(config.thinkingLevelMap.max, null);
  assert.equal(config.thinkingLevelMap.off, null);
  assert.deepEqual(getSupportedThinkingLevels(config), ["low", "medium", "high", "xhigh"]);
});

test("keeps Claude effort SKUs as separate models", () => {
  const processed = processModels([
    model("claude-sonnet-5-medium", "Claude Sonnet 5 Medium"),
    model("claude-sonnet-5-xhigh", "Claude Sonnet 5 Extra High"),
    model("claude-sonnet-5-thinking-xhigh", "Claude Sonnet 5 Thinking Extra High"),
    model("claude-4.6-sonnet-medium", "Claude Sonnet 4.6 1M"),
  ]);
  const ids = processed.map((entry) => entry.id);
  assert.deepEqual(ids, [
    "claude-4.6-sonnet-medium",
    "claude-sonnet-5-medium",
    "claude-sonnet-5-xhigh",
  ]);
  assert.equal(processed.every((entry) => entry.supportsEffort === false), true);
  const xhigh = toProviderModelConfig(processed.find((entry) => entry.id === "claude-sonnet-5-xhigh"));
  assert.equal(xhigh.reasoning, false);
  assert.equal(xhigh.thinkingLevelMap, undefined);
  assert.deepEqual(getSupportedThinkingLevels(xhigh), ["off"]);
});

test("collapses Gemini Flash and GLM families and drops thinking SKUs", () => {
  const processed = processModels([
    model("gemini-3.6-flash-high"),
    model("gemini-3.6-flash-low"),
    model("gemini-3.6-flash-medium"),
    model("gemini-3.6-flash-minimal"),
    model("glm-5.2-high"),
    model("glm-5.2-max"),
    model("gpt-5.4-low"),
    model("gpt-5.4-high"),
  ]);
  assert.ok(processed.find((entry) => entry.id === "gemini-3.6-flash")?.supportsEffort);
  assert.ok(processed.find((entry) => entry.id === "glm-5.2")?.supportsEffort);
  assert.ok(processed.find((entry) => entry.id === "gpt-5.4-low"));
  assert.ok(processed.find((entry) => entry.id === "gpt-5.4-high"));
  assert.equal(processed.some((entry) => entry.id === "gpt-5.4"), false);
});

test("maps pi thinking levels onto available Cursor effort suffixes", () => {
  assert.deepEqual(thinkingLevelMapFromEfforts(["low", "medium", "high", "xhigh"]), {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  });
});

test("resolves collapsed Grok wire ids including a medium default", () => {
  assert.equal(resolveCursorWireModelId("cursor-grok-4.6", "xhigh"), "cursor-grok-4.6-xhigh");
  assert.equal(resolveCursorWireModelId("cursor-grok-4.6-fast", "high"), "cursor-grok-4.6-high-fast");
  assert.equal(resolveCursorWireModelId("cursor-grok-4.6"), "cursor-grok-4.6-medium");
  assert.equal(resolveCursorWireModelId("claude-sonnet-5-xhigh", "low"), "claude-sonnet-5-xhigh");
});

test("routes bundled gpt-5.4-nano and grok-4-20 to their own costs", () => {
  const nano = estimateModelCost("gpt-5.4-nano-high");
  const full = estimateModelCost("gpt-5.4-high");
  const grok420 = estimateModelCost("grok-4-20");
  const grok46 = estimateModelCost("grok-4.6");
  assert.equal(nano.input, 0.2);
  assert.equal(nano.output, 1.25);
  assert.notEqual(nano.input, full.input);
  assert.equal(grok420.input, 2);
  assert.equal(grok420.output, 6);
  assert.notEqual(grok420.output, grok46.output);
});

test("infers context windows and thinking-capable ids", () => {
  assert.equal(inferContextWindow("claude-4.6-sonnet"), 1_048_576);
  assert.equal(inferContextWindow("gpt-5.4-medium"), 1_048_576);
  assert.equal(inferContextWindow("gemini-3.1-pro"), 1_048_576);
  assert.equal(inferContextWindow("grok-4.6"), 256_000);
  assert.equal(inferContextWindow("cursor-grok-4.6"), 256_000);
  const config = toProviderModelConfig({
    id: "grok-4.6",
    name: "Grok 4.6",
    reasoning: true,
    contextWindow: 256000,
    maxTokens: 64000,
    supportsEffort: false,
  });
  assert.equal(config.contextWindow, 256000);
  assert.equal(config.input.includes("image"), true);
  assert.equal(config.reasoning, false);
});
