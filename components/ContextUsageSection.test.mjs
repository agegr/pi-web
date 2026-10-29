import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ContextUsageSection } = await jiti.import("./ContextUsageSection.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(state, isMobile = false) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(ContextUsageSection, {
    state, onRefresh: () => {}, locale: "en", isMobile, translate: (key, params) => `${key}${params ? JSON.stringify(params) : ""}`,
  })));
}

const breakdown = {
  categories: [
    { id: "system-prompt", label: "System Prompt", tokens: 3_000, children: [{ id: "prompt:preamble", label: "Preamble", tokens: 3_000, entries: [] }] },
    { id: "tool-output", label: "Tool Output", tokens: 2_000, children: [{ id: "tool-result:read", label: "read", tokens: 2_000, entries: [] }] },
  ],
  estimatedTokens: 5_000,
  reported: { tokens: 4_800, contextWindow: 200_000, percent: 2.4 },
  reserveTokens: 16_384,
  computedAt: 0,
};

test("lists the categories in order with free space and the reserve, Tool Output open", () => {
  const html = render({ status: "ready", breakdown });
  const legend = html.slice(html.indexOf("context-legend-row"));
  const order = ["session.contextCategory.system-prompt", "session.contextCategory.tool-output", ">read<", "session.contextFree", "session.contextReserve"]
    .map((needle) => legend.indexOf(needle));
  assert.ok(order.every((index) => index >= 0), order.join(","));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(legend, /session\.contextCategory\.prompt:preamble/, "System Prompt stays folded");
  assert.equal((html.match(/context-map-cell/g) ?? []).length - 2, 40 * 5, "one cell per map slot, plus the two swatches");
});

test("offers Fit only when it narrows the scale", () => {
  assert.match(render({ status: "ready", breakdown }), /session\.contextFitScale/);
  const full = { ...breakdown, reported: { ...breakdown.reported, contextWindow: 10_000 } };
  assert.doesNotMatch(render({ status: "ready", breakdown: full }), /session\.contextFitScale/);
});

test("says why there is nothing to show yet", () => {
  assert.match(render({ status: "loading" }), /session\.contextLoading/);
  assert.match(render({ status: "failed" }), /session\.contextFailed/);
  assert.match(render({ status: "compacting" }), /session\.contextCompacting/);
});
