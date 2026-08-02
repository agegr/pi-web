import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./ansi.ts");
}

test("strips ANSI escape sequences", async () => {
  const { stripAnsi } = await loadSubject();

  assert.equal(stripAnsi("\x1b[31mred\x1b[0m plain"), "red plain");
  assert.equal(stripAnsi("answer\x1b_pi:c\x07"), "answer");
});

test("normalizes boxed custom panel lines while preserving ANSI codes", async () => {
  const { normalizeCustomPanelLines, stripAnsi } = await loadSubject();
  const lines = ["┌──────┐", "│ \x1b[32mOK\x1b[0m   │", "└──────┘"];

  const normalized = normalizeCustomPanelLines(lines);

  assert.equal(normalized.length, 1);
  assert.equal(stripAnsi(normalized[0]), "OK");
  assert.match(normalized[0], /\x1b\[32m/);
});

test("removes pi-tui cursor markers from custom panel output", async () => {
  const { normalizeCustomPanelLines } = await loadSubject();

  assert.deepEqual(normalizeCustomPanelLines(["> value\x1b_pi:c\x07"]), ["> value"]);
});

test("parses ANSI style segments and reset codes", async () => {
  const { parseAnsiLine } = await loadSubject();

  assert.deepEqual(parseAnsiLine("\x1b[31;1mhot\x1b[0m cold"), [
    { text: "hot", style: { color: "#dc2626", fontWeight: 700 } },
    { text: " cold", style: {} },
  ]);
});

test("maps 256-color SGR codes", async () => {
  const { ansi256Color, parseAnsiLine } = await loadSubject();

  assert.equal(ansi256Color(196), "rgb(255, 0, 0)");
  assert.deepEqual(parseAnsiLine("\x1b[38;5;196mred"), [
    { text: "red", style: { color: "rgb(255, 0, 0)" } },
  ]);
});
