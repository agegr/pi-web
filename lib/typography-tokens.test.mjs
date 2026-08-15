import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function token(name) {
  const match = css.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+);`));
  assert.ok(match, `missing ${name}`);
  return match[1].trim();
}

function hexToRgb(hex) {
  const n = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255);
}

function channel(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

test("defines the locked type tokens", () => {
  assert.equal(token("--text-chat"), "0.9375rem");
  assert.equal(token("--text-ui"), "0.8125rem");
  assert.equal(token("--text-title"), "0.875rem");
  assert.equal(token("--text-meta"), "0.75rem");
  assert.equal(token("--leading-prose"), "1.55");
  assert.equal(token("--leading-ui"), "1.35");
  assert.equal(token("--leading-title"), "1.25");
  assert.equal(token("--weight-regular"), "400");
  assert.equal(token("--weight-medium"), "600");
  assert.equal(token("--weight-semibold"), "650");
  assert.match(token("--font-ui"), /PingFang SC/);
  assert.match(token("--font-ui"), /Microsoft YaHei/);
});

test("splits muted and dim with AA helper contrast", () => {
  assert.equal(token("--text-muted"), "#4b5563");
  assert.equal(token("--text-dim"), "#6b7280");
  assert.notEqual(token("--text-muted"), token("--text-dim"));
  assert.ok(contrast("#4b5563", "#ffffff") >= 4.5);
  assert.ok(contrast("#4b5563", "#f5f5f5") >= 4.5);
  assert.match(css, /html\.dark[\s\S]*--text-muted:\s*#d1d5db/);
  assert.match(css, /html\.dark[\s\S]*--text-dim:\s*#9ca3af/);
  assert.ok(contrast("#d1d5db", "#171717") >= 4.5);
  assert.ok(contrast("#d1d5db", "#1f1f1f") >= 4.5);
});
