import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchSubscriptionUsage,
  formatSubscriptionUsage,
  parseAnthropicUsage,
  parseOpenAIUsage,
} from "./provider-usage.ts";

const NOW = Date.parse("2026-08-17T00:00:00.000Z");

test("parses provider quota windows and reset times defensively", () => {
  const openai = parseOpenAIUsage({
    plan_type: "plus",
    rate_limit: {
      primary_window: {
        used_percent: 32,
        limit_window_seconds: 604800,
        reset_at: (NOW + 86_400_000) / 1000,
      },
    },
    credits: { has_credits: true, balance: "4.25" },
  }, NOW);
  assert.deepEqual(openai, {
    provider: "openai-codex",
    displayName: "OpenAI Codex",
    plan: "plus",
    creditBalance: 4.25,
    windows: [{ label: "7 days", usedPercent: 32, resetAt: NOW + 86_400_000 }],
  });

  const anthropic = parseAnthropicUsage({
    five_hour: { utilization: 39, resets_at: "2026-08-17T08:50:00.000Z" },
    seven_day: { utilization: 48, resets_at: "2026-08-21T04:00:00.000Z" },
    seven_day_opus: null,
    extra_usage: { is_enabled: false },
  });
  assert.equal(anthropic.windows.length, 2);
  assert.equal(anthropic.windows[0].usedPercent, 39);
  assert.equal(anthropic.extraUsageEnabled, false);

  assert.deepEqual(parseOpenAIUsage({ rate_limit: { primary_window: { used_percent: "bad" } } }).windows, []);
  assert.deepEqual(parseAnthropicUsage(null).windows, []);
});

test("fetches with refreshed OAuth auth without exposing tokens", async () => {
  const secret = "oauth-secret-that-must-not-escape";
  const seenHeaders = [];
  const usage = await fetchSubscriptionUsage(
    async () => ({ token: secret, source: "OAuth" }),
    {
      fetchFn: async (url, init) => {
        seenHeaders.push(new Headers(init?.headers).get("authorization"));
        if (String(url).includes("chatgpt.com")) {
          return Response.json({
            rate_limit: {
              primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_at: 1780000000 },
            },
          });
        }
        return Response.json({
          five_hour: { utilization: 30, resets_at: "2026-08-18T00:00:00.000Z" },
        });
      },
    },
  );

  assert.deepEqual(seenHeaders, [`Bearer ${secret}`, `Bearer ${secret}`]);
  assert.equal(JSON.stringify(usage).includes(secret), false);
  assert.equal(formatSubscriptionUsage(usage, NOW).includes(secret), false);
});

test("requires subscription OAuth and does not call the provider with an API key", async () => {
  let called = false;
  const usage = await fetchSubscriptionUsage(
    async () => ({ token: "api-key", source: "ANTHROPIC_API_KEY" }),
    { fetchFn: async () => { called = true; return Response.json({}); } },
  );
  assert.equal(called, false);
  assert.match(usage[0].error, /Subscription OAuth/);
  assert.match(usage[1].error, /Subscription OAuth/);
});
