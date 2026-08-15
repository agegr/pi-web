import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const FILES = ["app/globals.css", "components/ChatMinimap.module.css"];
const BANNED = /\bfont-size:\s*(9|9\.5|10|10\.5|11)px\b/;
const RAW_PX = /\bfont-size:\s*(\d+(?:\.\d+)?)px\b/;
const FONT_SHORTHAND = /\bfont:\s*[^;]*\b(9|9\.5|10|10\.5|11)px\b/;

function linesOf(rel) {
  return readFileSync(join(process.cwd(), rel), "utf8").split("\n").map((text, i) => ({
    file: rel,
    line: i + 1,
    text,
  }));
}

function isAllowed16(line) {
  return /\bfont-size:\s*16px\b/.test(line.text);
}

test("product CSS has no type below 12px", () => {
  const hits = FILES.flatMap(linesOf).filter((row) => BANNED.test(row.text) || FONT_SHORTHAND.test(row.text));
  assert.deepEqual(hits, [], hits.map((h) => `${h.file}:${h.line} ${h.text.trim()}`).join("\n"));
});

test("product CSS font-size uses tokens except the 16px input exception", () => {
  const hits = FILES.flatMap(linesOf).filter((row) => RAW_PX.test(row.text) && !isAllowed16(row));
  assert.deepEqual(hits, [], hits.map((h) => `${h.file}:${h.line} ${h.text.trim()}`).join("\n"));
});
