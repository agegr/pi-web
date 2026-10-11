import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  delimiterForPath,
  detectCsvDelimiter,
  isDelimitedTablePath,
  measureColumnWidths,
  parseDelimitedRecords,
  parseDelimitedTable,
  visibleRowRange,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
} = await jiti.import("./delimited-table.ts");

test("recognizes .csv and .tsv only", () => {
  assert.equal(isDelimitedTablePath("/tmp/a.csv"), true);
  assert.equal(isDelimitedTablePath("C:\\data\\b.TSV"), true);
  assert.equal(isDelimitedTablePath("/tmp/a.json"), false);
  assert.equal(isDelimitedTablePath("/tmp/csv"), false);
  assert.equal(delimiterForPath("/tmp/a.tsv"), "\t");
});

test("parses RFC 4180 quoting: delimiters, doubled quotes and line breaks inside quotes", () => {
  const { records } = parseDelimitedRecords('a,"b,c","say ""hi""","two\nlines"\n', ",");
  assert.deepEqual(records, [["a", "b,c", 'say "hi"', "two\nlines"]]);
});

test("ends records at LF or CRLF and keeps a CR inside quotes", () => {
  const { records } = parseDelimitedRecords('a,b\r\n"x\r\ny",z\r\n', ",");
  assert.deepEqual(records, [["a", "b"], ["x\r\ny", "z"]]);
});

test("keeps empty fields, skips blank lines and a byte order mark", () => {
  const { records } = parseDelimitedRecords("\ufeffa,,c\n\n,\n\r\nd,e,\n", ",");
  assert.deepEqual(records, [["a", "", "c"], ["", ""], ["d", "e", ""]]);
});

test("a last record without a line break still counts at the end of the file", () => {
  assert.deepEqual(parseDelimitedRecords("a,b\nc,d", ",").records, [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseDelimitedRecords("a,b\nc,", ",").records, [["a", "b"], ["c", ""]]);
});

test("is lenient with stray quotes", () => {
  const { records } = parseDelimitedRecords('5" disk,"quoted"tail,x\n', ",");
  assert.deepEqual(records, [['5" disk', "quotedtail", "x"]]);
  // An unterminated quote at the end of the whole file keeps what it holds.
  assert.deepEqual(parseDelimitedRecords('a,"open\nstill', ",").records, [["a", "open\nstill"]]);
});

test("a loaded prefix of a file drops its cut last record", () => {
  const options = { complete: false };
  assert.deepEqual(parseDelimitedRecords("a,b\nc,d\ne,", ",", options).records, [["a", "b"], ["c", "d"]]);
  // Cut inside a quoted field that spans lines.
  assert.deepEqual(parseDelimitedRecords('a,b\nc,"one\ntw', ",", options).records, [["a", "b"]]);
  // Cut between the CR and the LF of a CRLF.
  assert.deepEqual(parseDelimitedRecords("a,b\r\nc,d\r", ",", options).records, [["a", "b"]]);
  // Ending on a line break, nothing is cut.
  assert.deepEqual(parseDelimitedRecords("a,b\nc,d\n", ",", options).records, [["a", "b"], ["c", "d"]]);
});

test("numbers each record by the file line it starts on", () => {
  const { lines } = parseDelimitedRecords('h1,h2\n\nx,"1\n2\n3"\r\ny,z\n', ",");
  assert.deepEqual(lines, [1, 3, 6]);
});

test("detects a .csv file's delimiter from its first records", () => {
  assert.equal(detectCsvDelimiter("a;b;c\n1,5;2,5;3\n4;5;6\n"), ";");
  assert.equal(detectCsvDelimiter("a,b\n\"x;y\",z\n"), ",");
  assert.equal(detectCsvDelimiter("a\tb\n1\t2\n"), "\t");
  assert.equal(detectCsvDelimiter("a|b|c\n1|2|3\n"), "|");
  // One column, or nothing to go on: comma.
  assert.equal(detectCsvDelimiter("value\n1\n2\n"), ",");
  assert.equal(detectCsvDelimiter(""), ",");
});

test("builds the table: header row, ragged rows padded, line numbers kept", () => {
  const table = parseDelimitedTable("name,note\nalice,plain\nbob,\"two\nlines\",extra\ncarol\n", "/tmp/a.csv");
  assert.deepEqual(table.columns, ["name", "note", ""]);
  assert.equal(table.headerLine, 1);
  assert.deepEqual(table.rows, [["alice", "plain"], ["bob", "two\nlines", "extra"], ["carol"]]);
  assert.deepEqual(table.rowLines, [2, 3, 5]);
});

test("a .tsv file always splits on tabs", () => {
  const table = parseDelimitedTable("a,b\tc\n1,2\t3\n", "/tmp/a.tsv");
  assert.deepEqual(table.columns, ["a,b", "c"]);
  assert.deepEqual(table.rows, [["1,2", "3"]]);
});

test("an empty file has no table", () => {
  assert.deepEqual(parseDelimitedTable("\n\n", "/tmp/a.csv"), { columns: [], headerLine: 0, rows: [], rowLines: [] });
});

test("sizes columns to their content within bounds, wide characters counting twice", () => {
  const [narrow, wide, cjk] = measureColumnWidths(
    ["id", "note", "名"],
    [["7", "x".repeat(200), "中文中文中文中文"], ["42", "", ""]],
  );
  assert.equal(narrow, MIN_COLUMN_WIDTH);
  assert.equal(wide, MAX_COLUMN_WIDTH);
  assert.ok(cjk > measureColumnWidths(["n"], [["abcdefgh"]])[0]);
});

test("renders only the rows around the viewport", () => {
  assert.deepEqual(visibleRowRange(0, 26, 0, 500, 10), { start: 0, end: 0 });
  assert.deepEqual(visibleRowRange(10_000, 26, 0, 520, 10), { start: 0, end: 30 });
  assert.deepEqual(visibleRowRange(10_000, 26, 2600, 520, 10), { start: 90, end: 130 });
  // Past the end (a shrunk file, a stale scroll position) stays in range.
  assert.deepEqual(visibleRowRange(50, 26, 1_000_000, 520, 10), { start: 50, end: 50 });
  // Unmeasured viewport: a sensible first screen.
  assert.ok(visibleRowRange(10_000, 26, 0, 0, 10).end > 20);
});
