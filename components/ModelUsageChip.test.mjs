import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { buildUsageTooltip, formatUsageChip } = await jiti.import("./ModelUsageChip.tsx");

// The real `t()` is supplied by I18nProvider; these formatters only need the lookups.
const t = (key, params) => ({
  "providerUsage.chipTitle": `${params.provider} usage`,
  "providerUsage.bucketUsed": `${params.percent}% used`,
  "providerUsage.bucketResets": `resets ${params.time}`,
})[key];

const percentBucket = (id, label, used, resetsAt) => ({
  id,
  label,
  used,
  remaining: 100 - used,
  limit: 100,
  unit: "percent",
  ...(resetsAt === undefined ? {} : { resetsAt }),
});

test("formats OpenCode Go windows as used percentages in one compact chip", () => {
  const report = {
    providerName: "OpenCode Go",
    capturedAt: 0,
    buckets: [
      percentBucket("rolling", "Rolling 5h", 2),
      percentBucket("weekly", "Weekly", 17),
      percentBucket("monthly", "Monthly", 35),
    ],
  };
  assert.equal(formatUsageChip("opencode-go", report), "Go 2/17/35%");
});

test("labels every value when a provider reports mixed units", () => {
  const report = {
    providerName: "Moonshot AI",
    capturedAt: 0,
    buckets: [
      percentBucket("daily", "Daily", 40),
      { id: "balance", label: "Balance", remaining: 12.5, limit: 20, unit: "currency", currency: "CNY" },
    ],
  };
  const chip = formatUsageChip("moonshotai", report);
  assert.match(chip, /^Moonshot Daily 40%/);
  assert.match(chip, /CNY 12\.50/);
});

test("tooltip names the provider and lists each window with its reset time", () => {
  const report = {
    providerName: "OpenCode Go",
    capturedAt: 0,
    buckets: [
      percentBucket("rolling", "Rolling 5h", 2, 1_800_000_000),
      percentBucket("weekly", "Weekly", 17),
    ],
  };
  const tooltip = buildUsageTooltip("opencode-go", report, t);
  const lines = tooltip.split("\n");
  assert.equal(lines[0], "OpenCode Go usage");
  assert.match(lines[1], /^ {2}Rolling 5h: 2% used, resets /);
  assert.equal(lines[2], "  Weekly: 17% used");
});

test("tooltip appends provider-reported window states as notes", () => {
  const report = {
    providerName: "OpenCode Go",
    capturedAt: 0,
    buckets: [percentBucket("rolling", "Rolling 5h", 100)],
    notes: ["Rolling 5h: rate-limited"],
  };
  assert.match(buildUsageTooltip("opencode-go", report, t), /Go: Rolling 5h: rate-limited$/);
});
