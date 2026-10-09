import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { parseDelimitedTable, measureColumnWidths, isCsvPath } = await jiti.import("./CsvTable.tsx");

test("recognizes delimited file extensions", () => {
  assert.equal(isCsvPath("/tmp/a.csv"), true);
  assert.equal(isCsvPath("/tmp/a.TSV"), true);
  assert.equal(isCsvPath("/tmp/a.json"), false);
});

test("reads a header row and numbers records by the line they start on", () => {
  const content = "name,note\nalice,plain\nbob,\"two\nlines\"\ncarol,last\n";
  const table = parseDelimitedTable(content, "/tmp/a.csv");
  assert.deepEqual(table.columns, ["name", "note"]);
  assert.deepEqual(table.body.map((row) => row[0]), ["alice", "bob", "carol"]);
  assert.deepEqual(table.body[1], ["bob", "two\nlines"]);
  // A record spanning two lines is numbered by the line it starts on.
  assert.deepEqual(table.bodyLines, [2, 3, 5]);
});

test("numbers a mid-file slice from its own start line and keeps every record", () => {
  const table = parseDelimitedTable("a,1\nb,2\nc,3\n", "/tmp/a.csv", 40);
  // A slice from mid-file has no header row, so nothing is consumed as one.
  assert.deepEqual(table.columns, ["#1", "#2"]);
  assert.deepEqual(table.body.map((row) => row[0]), ["a", "b", "c"]);
  assert.deepEqual(table.bodyLines, [40, 41, 42]);
});

test("sizes columns to their content within bounds", () => {
  const narrow = measureColumnWidths(["id"], [["7"], ["42"]]);
  const wide = measureColumnWidths(["note"], [[`${"x".repeat(200)}`]]);
  assert.equal(narrow.length, 1);
  assert.equal(narrow[0], 72);
  assert.ok(wide[0] <= 420);
  // Two columns of short values stay narrow enough that both fit the panel.
  assert.ok(narrow[0] + narrow[0] < 400);
});

test("parses tab-separated content", () => {
  const table = parseDelimitedTable("a\tb\n1\t2\n", "/tmp/a.tsv");
  assert.deepEqual(table.columns, ["a", "b"]);
  assert.deepEqual(table.body, [["1", "2"]]);
});