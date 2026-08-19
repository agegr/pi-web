import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { FooterPanel } = await jiti.import("./FooterPanel.tsx");

function renderPanel(data) {
  return renderToStaticMarkup(React.createElement(FooterPanel, { data }));
}

const sampleData = {
  provider: "opencode-go",
  model: "deepseek-v4-flash",
  thinking: "high",
  activeTool: null,
  totalTokens: 11070000,
  activityBusy: false,
  context: { percent: 13, contextWindow: 1000000, tokens: 130000 },
  workspace: {
    cwd: "/Users/x/agegr-pi-web-custom",
    branch: "feat/ui-telemetry-themes",
    modified: 9,
    untracked: 7,
  },
  tokens: {
    input: 134000,
    output: 36000,
    cacheRead: 10900000,
    cacheWrite: 0,
    cacheHitPercent: 98.8,
  },
  cost: { inputUsd: 0.02, outputUsd: 0.01, cacheReadUsd: 0.03, estimatedTotalUsd: 0.06 },
};

test("renders the full combined TUI footer structure", () => {
  const html = renderPanel(sampleData);

  // Row 1: model/provider/thinking
  assert.match(html, /\(opencode-go\) deepseek-v4-flash • high/);
  // PI token summary
  assert.match(html, /PI: 11.1M tok/);
  // context summary
  assert.match(html, /13%/);
  // Row 2: workspace
  assert.match(html, /\/Users\/x\/agegr-pi-web-custom/);
  assert.match(html, /feat\/ui-telemetry-themes/);
  assert.match(html, /✎/);
  assert.match(html, /9/);
  assert.match(html, /◌/);
  assert.match(html, /7/);
  // Row 3: token columns
  assert.match(html, />Input</);
  assert.match(html, />Output</);
  assert.match(html, />Cache read</);
  assert.match(html, />Cache write</);
  assert.match(html, />Cache hit</);
  assert.match(html, /134k/);
  assert.match(html, /36k/);
  assert.match(html, /10.9M/);
  assert.match(html, /98.8%/);
  // Row 4/5: cost + estimated total
  assert.match(html, /Est\. total/);
  assert.match(html, /\$0\.0600/);
  assert.match(html, /Context/);
});

test("renders thinking as null when off", () => {
  const html = renderPanel({
    ...sampleData,
    thinking: null,
  });
  assert.match(html, /\(opencode-go\) deepseek-v4-flash/);
  assert.doesNotMatch(html, /• high/);
});

test("renders empty state when no data", () => {
  const html = renderPanel(null);
  assert.match(html, /No session data/);
});

test("omits workspace row when no cwd", () => {
  const html = renderPanel({
    ...sampleData,
    workspace: null,
  });
  assert.doesNotMatch(html, /feat\/ui-telemetry-themes/);
  assert.match(html, /PI:/);
});
