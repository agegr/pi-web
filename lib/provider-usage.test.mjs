import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./provider-usage.ts");
}

const { isOfficialProviderUsageOrigin, isProviderUsageId, normalizeProviderUsagePayload } = await loadSubject();

test("recognizes only providers with usage adapters", () => {
  assert.equal(isProviderUsageId("openai-codex"), true);
  assert.equal(isProviderUsageId("opencode-go"), true);
  assert.equal(isProviderUsageId("anthropic"), false);
});

test("accepts only the official origin for provider usage credentials", () => {
  assert.equal(isOfficialProviderUsageOrigin("deepseek", "https://api.deepseek.com/v1"), true);
  assert.equal(isOfficialProviderUsageOrigin("deepseek", "https://proxy.example.com/v1"), false);
  assert.equal(isOfficialProviderUsageOrigin("deepseek", "not a URL"), false);
  assert.equal(isOfficialProviderUsageOrigin("opencode-go", "https://opencode.ai/zen/go/v1"), true);
  assert.equal(isOfficialProviderUsageOrigin("opencode-go", "https://proxy.example.com/zen/go/v1"), false);
});

test("normalizes Codex windows into remaining percentages and reset times", () => {
  const report = normalizeProviderUsagePayload("openai-codex", {
    rate_limit: {
      primary_window: { used_percent: 12, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
      secondary_window: { used_percent: 40, limit_window_seconds: 604_800 },
    },
  }, 123);
  assert.deepEqual(report.buckets.map((bucket) => [bucket.label, bucket.groupLabel, bucket.remaining, bucket.resetsAt]), [
    ["5h", undefined, 88, 1_800_000_000],
    ["Weekly", undefined, 60, undefined],
  ]);
});

test("normalizes MiniMax token-plan counts using the reported remaining percent", () => {
  const report = normalizeProviderUsagePayload("minimax", {
    model_remains: [{
      model_name: "MiniMax-M2",
      current_interval_usage_count: 20,
      current_interval_total_count: 100,
      current_interval_remaining_percent: 80,
      current_interval_status: 1,
      start_time: 1_700_000_000_000,
      end_time: 1_700_360_000_000,
      current_weekly_usage_count: 1,
      current_weekly_total_count: 1,
      current_weekly_remaining_percent: 0,
      current_weekly_status: 3,
      weekly_start_time: 1_700_000_000_000,
      weekly_end_time: 1_706_000_000_000,
    }],
  }, 123);
  assert.equal(report.buckets[0].remaining, 80);
  assert.equal(report.buckets[0].used, 20);
  assert.equal(report.buckets[1].period, "Unlimited");
});

test("normalizes OpenCode Go windows into remaining percentages and reset times", () => {
  const report = normalizeProviderUsagePayload("opencode-go", {
    usage: {
      rolling: { status: "ok", percent: 3, resetsAt: "2026-09-14T05:53:50.774Z" },
      weekly: { status: "ok", percent: 1, resetsAt: "2026-09-21T00:00:00.774Z" },
      monthly: { status: "ok", percent: 98, resetsAt: "2026-09-19T02:38:27.774Z" },
    },
  }, 123);
  assert.deepEqual(report.buckets.map((bucket) => [bucket.label, bucket.remaining, bucket.unit, bucket.resetsAt]), [
    ["Rolling", 97, "percent", Math.floor(Date.parse("2026-09-14T05:53:50.774Z") / 1_000)],
    ["Weekly", 99, "percent", Math.floor(Date.parse("2026-09-21T00:00:00.774Z") / 1_000)],
    ["Monthly", 2, "percent", Math.floor(Date.parse("2026-09-19T02:38:27.774Z") / 1_000)],
  ]);
});
