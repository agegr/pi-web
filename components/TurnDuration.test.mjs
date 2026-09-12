import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { TurnDuration, formatTurnDuration } = await jiti.import("./TurnDuration.tsx");
const { mergeTurnTiming } = await jiti.import("@/lib/turn-timing");

const render = (component, props) => renderToStaticMarkup(
  React.createElement(I18nProvider, null, React.createElement(component, props)),
);

test("formats short, minute and hour durations without rounding across boundaries", () => {
  for (const [ms, zh, en] of [
    [0, "0秒", "0s"],
    [59999, "59秒", "59s"],
    [60000, "1分0秒", "1m 0s"],
    [222000, "3分42秒", "3m 42s"],
    [3600000, "1小时0分0秒", "1h 0m 0s"],
  ]) {
    assert.equal(formatTurnDuration(ms, "zh-CN"), zh);
    assert.equal(formatTurnDuration(ms, "en"), en);
  }
  assert.equal(formatTurnDuration(-1000, "en"), "0s");
  assert.equal(formatTurnDuration(3600000, "zh-TW"), "1小時0分0秒");
});

test("a refreshed live timer uses the server start, and completion freezes it", (t) => {
  t.mock.method(Date, "now", () => 101000);
  const timing = { id: "run", startedAt: 18000 };
  assert.match(render(TurnDuration, { timing, live: true }), /Working · 1m 23s/);
  const finished = { ...timing, endedAt: 60000 };
  assert.match(render(TurnDuration, { timing: finished, live: true }), /Took 42s/);
  assert.match(render(TurnDuration, { timing: finished }), /Took 42s/);
  assert.equal(render(TurnDuration, { timing }), "");
});

test("late snapshots cannot restart a finished timer or overwrite a newer run", () => {
  const started = { id: "first", startedAt: 1000 };
  const finished = { ...started, endedAt: 5000 };
  const next = { id: "second", startedAt: 6000 };
  assert.equal(mergeTurnTiming(started, finished), finished);
  assert.equal(mergeTurnTiming(finished, started), finished);
  assert.equal(mergeTurnTiming(next, finished), next);
  assert.equal(mergeTurnTiming(finished, next), next);
  assert.equal(mergeTurnTiming(started, null), null);
});
