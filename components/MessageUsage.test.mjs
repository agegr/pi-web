import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { MessageUsage, usageDetailsText } = await jiti.import("./MessageUsage.tsx");
const { UsageIcon } = await jiti.import("./UsageIcon.tsx");
const { MessageView } = await jiti.import("./MessageView.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { getLocalePlugin } = await jiti.import("@/lib/i18n/registry");
const summary = {
  usage: {
    input: 314_138, output: 7_241, cacheRead: 1_600_640, cacheWrite: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.8608 },
  },
  scope: "turn", complete: true, durationMs: 10_000,
};
const translate = (locale) => (key, params) => {
  const text = getLocalePlugin(locale).messages[key];
  assert.ok(text, `missing ${locale} ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
};
const render = (component, props) => renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(component, props)));

test("compact summary uses shared thin SVGs, decimal K/M and actual average output rate", () => {
  const html = render(MessageUsage, { summary, onShowDetails() {} });
  assert.match(html, /314\.1K/);
  assert.match(html, /7\.2K/);
  assert.match(html, /1\.6M/);
  assert.match(html, /\$0\.8608/);
  assert.match(html, /724\.1 t\/s/);
  assert.match(html, /took 10s/);
  assert.match(html, /<line x1="5" y1="8.5" x2="5" y2="1.5"/);
  assert.match(html, /<line x1="5" y1="1.5" x2="5" y2="8.5"/);
  assert.match(html, /<button type="button" class="message-usage"/);
  assert.equal((html.match(/<svg/g) ?? []).length, 3);
  assert.doesNotMatch(html, /cache R|cache W|♻|📥|📤/);
});

test("message SVGs inherit the counts color and shared toolbar icons stay neutral", () => {
  const withWrite = { ...summary, usage: { ...summary.usage, cacheWrite: 12_000 } };
  const html = render(MessageUsage, { summary: withWrite });
  const icons = [...html.matchAll(/<svg\b[^>]*>/g)].map(([tag]) => tag);
  assert.equal(icons.length, 4);
  for (const icon of icons) {
    assert.match(icon, /stroke="currentColor"/);
    assert.doesNotMatch(icon, /style="[^"]*color:/);
  }
  const withoutIcons = html.replace(/<svg\b[\s\S]*?<\/svg>/g, "");
  assert.doesNotMatch(withoutIcons, /color:var\(--accent\)|color:var\(--text-muted\)/);
  assert.match(withoutIcons, /color:var\(--text-dim\)/);
  for (const kind of ["input", "output", "cacheRead", "cacheWrite"]) {
    const neutral = render(UsageIcon, { kind });
    assert.doesNotMatch(neutral, /style="[^"]*color:/, `${kind} is not colored by default`);
    assert.match(neutral, /stroke="currentColor"/);
  }
});

test("details contain exact counts, total, cost, timing and scope in all three locales", () => {
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const text = usageDetailsText(summary, translate(locale), locale);
    for (const count of ["314,138", "7,241", "1,600,640", "1,922,019", "$0.8608", "724.1 t/s"]) assert.ok(text.includes(count), `${locale}: ${count}`);
    assert.ok(text.startsWith(translate(locale)("chat.usageTurn")));
    assert.ok(!text.includes(`\n${translate(locale)("session.cacheWrite")}:`), "zero cache write tokens are omitted");
  }
});

test("summary and details truncate displayed fees to four decimals without mutating recorded values", () => {
  for (const [cost, expected] of [[0.023180000000000003, "0.0231"], [0.00001234, "0"], [0.123456789, "0.1234"], [0, "0"]]) {
    const precise = { ...summary, usage: { ...summary.usage, cost: { ...summary.usage.cost, total: cost } } };
    const original = structuredClone(precise);
    assert.ok(usageDetailsText(precise, translate("en"), "en").includes(`Cost: $${expected}\n`));
    if (cost) assert.ok(render(MessageUsage, { summary: precise }).includes(`$${expected}`));
    assert.deepEqual(precise, original);
  }
});

test("read-only viewers have no dead button, click label or keyboard focus target", () => {
  const html = render(MessageUsage, { summary });
  assert.match(html, /<span class="message-usage"/);
  assert.doesNotMatch(html, /<button|tabindex=|aria-label="Show exact usage/);
  assert.match(html, /title="Turn usage/);
});

test("nonzero cache writes get their own SVG and exact detail", () => {
  const withWrite = { ...summary, usage: { ...summary.usage, cacheWrite: 12_000 } };
  const html = render(MessageUsage, { summary: withWrite });
  assert.match(html, /12K/);
  assert.match(html, /M1\.5 5a3\.5 3\.5/);
  assert.match(usageDetailsText(withWrite, translate("en"), "en"), /Cache Write: 12,000/);
});

test("old or invalid timing and partial totals hide the rate instead of guessing", () => {
  for (const durationMs of [undefined, 0, -1, NaN, Infinity]) {
    const html = render(MessageUsage, { summary: { ...summary, durationMs } });
    assert.doesNotMatch(html, /[\d.] t\/s|NaN|Infinity/);
  }
  const partial = { ...summary, complete: false };
  assert.doesNotMatch(render(MessageUsage, { summary: partial }), /[\d.] t\/s/);
  assert.match(usageDetailsText(partial, translate("en"), "en"), /Partial usage/);
});

test("finished message uses supplied turn totals, not the final response's own usage", () => {
  const message = {
    role: "assistant", provider: "p", model: "m", timestamp: 1_000, durationMs: 500,
    content: [{ type: "text", text: "Done" }],
    usage: { ...summary.usage, input: 12, output: 7 },
  };
  const html = render(MessageView, { message, usageSummary: summary, onShowUsageDetails() {} });
  assert.match(html, /314\.1K/);
  assert.match(html, /724\.1 t\/s/);
  assert.doesNotMatch(html, /14\.0 t\/s/);
  const responseHtml = render(MessageView, { message });
  assert.match(responseHtml, /14\.0 t\/s/);
  assert.match(responseHtml, /Response usage/);
  assert.match(responseHtml, /Model: m/);
  assert.match(responseHtml, /Provider: p/);
  assert.match(responseHtml, /Request started:/);
  assert.match(responseHtml, /Response completed:/);
  assert.doesNotMatch(html, /Model:|Provider:|Request started:|Response completed:/);
  const liveHtml = render(MessageView, { message, isStreaming: true });
  assert.doesNotMatch(liveHtml, /class="message-usage"/);
});

test("details use only supplied response metadata, with localized times and a separate turn scope", () => {
  const response = { model: "model-id", provider: "provider-id", timestamp: 1_000, durationMs: 500, stopReason: "toolUse", errorMessage: "Recorded error" };
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const t = translate(locale);
    const text = usageDetailsText({ ...summary, scope: "response", durationMs: 500 }, t, locale, response);
    assert.ok(text.includes(`${t("chat.usageModel")}: model-id`));
    const providerLabel = { en: "Provider", "zh-CN": "模型提供商", "zh-TW": "模型供應商" }[locale];
    assert.ok(text.includes(`${providerLabel}: provider-id`));
    assert.ok(text.includes(`${t("chat.usageStopReason")}: toolUse`));
    assert.ok(text.includes(`${t("chat.usageError")}: Recorded error`));
    assert.ok(text.includes(`${t("chat.usageDuration")}: 0.5s`));
    assert.equal(text.split(`${t("chat.usageDuration")}:`).length - 1, 1);
    const time = (ms) => new Date(ms).toLocaleString(locale, {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short",
    });
    assert.ok(text.includes(`${t("chat.usageRequestStarted")}: ${time(1_000)}`));
    assert.ok(text.includes(`${t("chat.usageResponseCompleted")}: ${time(1_500)}`));
    const turn = usageDetailsText(summary, t, locale, response);
    assert.ok(turn.includes(`${t("chat.usageDuration")}: 10s`));
    assert.ok(!turn.includes(`${t("chat.usageModel")}:`));
    assert.ok(!turn.includes(`${t("chat.usageRequestStarted")}:`));
    assert.doesNotMatch(text, /thinkingLevel|Thinking level|思考深度/);
  }
});

test("invalid or absent response dates never invent a response completion time", () => {
  const t = translate("en");
  const single = { ...summary, scope: "response" };
  for (const timestamp of [undefined, -1, NaN, Infinity, 9e15]) {
    const text = usageDetailsText(single, t, "en", { timestamp, durationMs: 500 });
    assert.doesNotMatch(text, /Request started:|Response completed:|Invalid Date|NaN|Infinity/);
  }
  for (const durationMs of [undefined, -1, NaN, Infinity, 9e15]) {
    const text = usageDetailsText(single, t, "en", { timestamp: 1_000, durationMs });
    assert.match(text, /Request started:/);
    assert.doesNotMatch(text, /Response completed:|Invalid Date|NaN|Infinity/);
  }
  const zero = usageDetailsText(single, t, "en", { timestamp: 0, durationMs: 0 });
  assert.match(zero, /Request started:/);
  assert.match(zero, /Response completed:/);
  const noMetadata = usageDetailsText(single, t, "en", {});
  assert.doesNotMatch(noMetadata, /Last response|Model:|Provider:|Stop reason:|Error:/);
});

test("fee breakdown truncates supplied values and does not invent missing fee categories", () => {
  const cost = { input: 0.000012345, output: 0, cacheRead: 0.0002, cacheWrite: 0.0003, total: 0.000512345 };
  const text = usageDetailsText({ ...summary, usage: { ...summary.usage, cost } }, translate("en"), "en");
  assert.match(text, /Input cost: \$0\n/);
  assert.match(text, /Output cost: \$0\n/);
  assert.match(text, /Cache Read cost: \$0\.0002/);
  assert.match(text, /Cache Write cost: \$0\.0003/);
  const missing = usageDetailsText({ ...summary, usage: { ...summary.usage, cost: { total: 1 } } }, translate("en"), "en");
  assert.match(missing, /Cost: \$1/);
  assert.doesNotMatch(missing, /Input cost:|Output cost:|Cache Read cost:|Cache Write cost:/);
});

test("derived usage changes and click callbacks participate in MessageView memoization", () => {
  const props = { message: { role: "assistant", content: [] }, usageSummary: summary };
  assert.equal(MessageView.compare(props, { ...props, usageSummary: structuredClone(summary) }), true);
  assert.equal(MessageView.compare(props, { ...props, usageSummary: { ...summary, durationMs: 20_000 } }), false);
  assert.equal(MessageView.compare(props, { ...props, onShowUsageDetails() {} }), false);
});

test("chat uses the existing toast path and original turn range for summary and duration", async () => {
  const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(source, /addNotice\(\{ message \}\)/);
  assert.match(source, /onShowUsageDetails=\{showUsageDetails\}/);
  assert.match(source, /usageSummary: hasAnchor \? summarizeTurnUsage\(messages, groupStartIdx, endIdx, turnDurationMs\) : undefined/);
  assert.match(source, /durationMs=\{finalAnswerMessage \? undefined : turnDurationMs\}/);
});
