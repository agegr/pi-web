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
  const lines = [
    "┌──────┐",
    "│ \x1b[32mOK\x1b[0m   │",
    "└──────┘",
  ];

  const normalized = normalizeCustomPanelLines(lines);

  assert.equal(normalized.length, 1);
  assert.equal(stripAnsi(normalized[0]), "OK");
  assert.match(normalized[0], /\x1b\[32m/);
});

test("removes pi-tui cursor markers from custom panel output", async () => {
  const { normalizeCustomPanelLines } = await loadSubject();

  assert.deepEqual(normalizeCustomPanelLines(["> value\x1b_pi:c\x07"]), ["> value"]);
  assert.deepEqual(
    normalizeCustomPanelLines(["> \x1b_pi:c\x07\x1b_pi:fc\x07中\x1b_pi:/fc\x07"]),
    ["> 中"],
  );
  assert.deepEqual(
    normalizeCustomPanelLines(["> \x1b_pi:c\x07\x1b_pi:fc\x07 \x1b_pi:/fc\x07"]),
    [">"],
  );
});

test("strips pi-tui fake cursor markers alongside cursor position markers", async () => {
  const { stripAnsi, normalizeCustomPanelLines } = await loadSubject();

  assert.equal(stripAnsi("answer\x1b_pi:fc\x07中\x1b_pi:/fc\x07"), "answer中");
  assert.equal(stripAnsi("input\x1b_pi:c\x07\x1b_pi:fc\x07 \x1b_pi:/fc\x07"), "input ");

  const lines = [
    "┌────────────────────────────┐",
    "│ > \x1b_pi:c\x07\x1b_pi:fc\x07中\x1b_pi:/fc\x07                    │",
    "└────────────────────────────┘",
  ];
  assert.deepEqual(normalizeCustomPanelLines(lines), ["> 中"]);
});
