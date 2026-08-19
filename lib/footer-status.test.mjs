import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFooterPanelData,
  computeFooterCacheHit,
  formatFooterCost,
  formatFooterTokens,
  parseFooterFileCounts,
} from "./footer-status.ts";

// Combined TUI footer model (buildFooterPanelData / formatters)
// ---------------------------------------------------------------------------


describe("combined TUI footer model", () => {
  it("returns null without a model", () => {
    assert.equal(
      buildFooterPanelData({ provider: "", model: "", hasReasoning: false }),
      null,
    );
  });

  it("builds full structured data from session state", () => {
    const data = buildFooterPanelData({
      provider: "opencode-go",
      model: "deepseek-v4-flash",
      thinking: "high",
      hasReasoning: true,
      contextPercent: 13,
      contextWindow: 1_000_000,
      contextTokens: 130_000,
      sessionTokens: {
        input: 134_000,
        output: 36_000,
        cacheRead: 10_900_000,
        cacheWrite: 0,
        total: 11_070_000,
      },
      sessionCost: 0.06,
      cwd: "/Users/x/agegr-pi-web-custom",
      branch: "feat/ui-telemetry-themes",
      modifiedCount: 9,
      untrackedCount: 7,
      agentBusy: false,
    });

    assert.equal(data.model, "deepseek-v4-flash");
    assert.equal(data.provider, "opencode-go");
    assert.equal(data.thinking, "high");
    assert.equal(data.workspace.branch, "feat/ui-telemetry-themes");
    assert.equal(data.workspace.modified, 9);
    assert.equal(data.workspace.untracked, 7);
    assert.equal(data.context.contextWindow, 1_000_000);
    assert.equal(data.tokens.input, 134_000);
    // cache hit = cacheRead / (cacheRead + cacheWrite + input)
    const expectedHit = (10_900_000 / (10_900_000 + 0 + 134_000)) * 100;
    assert.ok(Math.abs(data.tokens.cacheHitPercent - expectedHit) < 1e-6);
    assert.ok(data.cost.estimatedTotalUsd === 0.06);
  });

  it("maps no-reasoning / off thinking to null", () => {
    const data = buildFooterPanelData({
      provider: "x",
      model: "m",
      thinking: "off",
      hasReasoning: false,
    });
    assert.equal(data.thinking, null);
  });

  it("computes cache hit from read/write/input", () => {
    assert.equal(computeFooterCacheHit(90, 0, 10), 90);
    assert.equal(computeFooterCacheHit(0, 0, 0), null);
    assert.equal(computeFooterCacheHit(50, 50, 0), 50);
  });

  it("formats tokens and cost compactly", () => {
    assert.equal(formatFooterTokens(15000), "15k");
    assert.equal(formatFooterTokens(10900000), "10.9M");
    assert.equal(formatFooterTokens(0), "0");
    assert.equal(formatFooterCost(0.06), "$0.0600");
    assert.equal(formatFooterCost(0), "$0.0000");
  });

  it("parses filechanges status into modified/untracked counts", () => {
    assert.deepEqual(parseFooterFileCounts("Δ 9  + 7"), { modified: 9, untracked: 7 });
    assert.deepEqual(parseFooterFileCounts("\u001b[2mΔ 3  + 1\u001b[0m"), { modified: 3, untracked: 1 });
    assert.deepEqual(parseFooterFileCounts(""), { modified: 0, untracked: 0 });
  });
});
