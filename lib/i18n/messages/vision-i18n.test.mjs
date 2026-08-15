import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { enLocale } = await jiti.import("./en.ts");
const { zhCNLocale } = await jiti.import("./zh-CN.ts");

const REQUIRED = [
  "common.vision",
  "vision.nav",
  "vision.title",
  "vision.intro",
  "vision.externalNotice",
  "vision.provider",
  "vision.providerHint",
  "vision.protocol",
  "vision.baseUrl",
  "vision.model",
  "vision.apiKey",
  "vision.apiKeyPlaceholderMissing",
  "vision.apiKeyPlaceholderConfigured",
  "vision.apiKeyHint",
  "vision.apiKeyLocked",
  "vision.apiKeyBlank",
  "vision.apiKeyInvalid",
  "vision.sourceHint",
  "vision.sourceEnv",
  "vision.sourceFile",
  "vision.configured",
  "vision.missing",
  "vision.save",
  "vision.saving",
  "vision.reload",
  "vision.saved",
  "vision.health",
  "vision.runHealth",
  "vision.testConnection",
  "vision.testing",
  "vision.connectionHint",
  "vision.saveBeforeTesting",
  "vision.notTested",
  "vision.advanced",
  "vision.advancedHint",
  "vision.language",
  "vision.userAgent",
  "vision.anthropicThinking",
  "vision.anthropicThinkingHint",
  "vision.reasoningEffort",
  "vision.openConfig",
  "vision.pluginKind",
  "vision.extension",
  "vision.skill",
  "vision.configPath",
  "vision.present",
  "vision.absent",
  "vision.statusOk",
  "vision.statusWarning",
  "vision.statusError",
  "vision.statusNotTested",
  "vision.healthPython",
  "vision.healthDependencies",
  "vision.healthChrome",
  "vision.healthCredential",
  "vision.healthConfigFile",
  "vision.healthExtension",
  "vision.healthSkill",
  "vision.healthService",
];

test("en and zh-CN vision.* keys stay synchronized", () => {
  const enKeys = Object.keys(enLocale.messages).filter((key) => key.startsWith("vision.")).sort();
  const zhKeys = Object.keys(zhCNLocale.messages).filter((key) => key.startsWith("vision.")).sort();
  assert.deepEqual(zhKeys, enKeys);
  assert.equal(enLocale.messages["common.vision"] !== undefined, true);
  assert.equal(zhCNLocale.messages["common.vision"] !== undefined, true);
  for (const key of REQUIRED) {
    assert.equal(typeof enLocale.messages[key], "string", key);
    assert.equal(typeof zhCNLocale.messages[key], "string", key);
  }
});
