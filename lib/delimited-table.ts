/**
 * Client-safe parsing and layout for the file viewer's table of a `.csv` /
 * `.tsv` file (components/DelimitedTable.tsx). RFC 4180 records: quoted fields
 * may hold the delimiter, `""` and line breaks; records end at LF or CRLF.
 * Lenient where files are not: a quote inside an unquoted field is a literal
 * character, text after a closing quote is kept, and ragged rows are allowed.
 */

export interface ParsedRecords {
  records: string[][];
  /** The file line (1-based, counted by LF) each record starts on. */
  lines: number[];
}

export interface DelimitedTableData {
  /** The first record's fields, padded with "" up to the widest record. */
  columns: string[];
  /** The line the header record starts on; 0 when there is no record at all. */
  headerLine: number;
  rows: string[][];
  rowLines: number[];
}

const CSV_DELIMITER_CANDIDATES = [",", ";", "\t", "|"] as const;
const DETECT_SAMPLE_CHARS = 64 * 1024;
const DETECT_SAMPLE_RECORDS = 20;

/** "," for .csv, "\t" for .tsv, null for any other file. */
export function delimiterForPath(filePath: string): string | null {
  // An extension, not a whole name: a file called "csv" is no table.
  const match = /\.(csv|tsv)$/i.exec(filePath);
  if (!match) return null;
  return match[1].toLowerCase() === "tsv" ? "\t" : ",";
}

export function isDelimitedTablePath(filePath: string): boolean {
  return delimiterForPath(filePath) !== null;
}

/**
 * Splits `text` into records. With `complete: false` the text is a prefix of
 * the file (the viewer loads large files in chunks), so a last record that no
 * line break ends, or that stops inside a quoted field, is left out rather
 * than shown cut. Blank lines are skipped, as spreadsheet tools do.
 */
export function parseDelimitedRecords(
  text: string,
  delimiter: string,
  options: { complete?: boolean; maxRecords?: number } = {},
): ParsedRecords {
  const complete = options.complete ?? true;
  const maxRecords = options.maxRecords ?? Infinity;
  const records: string[][] = [];
  const lines: number[] = [];
  const length = text.length;
  const delimiterCode = delimiter.charCodeAt(0);
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let record: string[] = [];
  let recordLine = 1;

  const endRecord = () => {
    // A blank line parses as one empty field.
    if (!(record.length === 1 && record[0] === "")) {
      records.push(record);
      lines.push(recordLine);
    }
    record = [];
  };

  while (index < length && records.length < maxRecords) {
    let value = "";
    let quotedOpen = false;
    if (text.charCodeAt(index) === 34 /* " */) {
      index += 1;
      quotedOpen = true;
      let segment = index;
      while (index < length) {
        const quote = text.indexOf("\"", index);
        if (quote === -1) break;
        if (text.charCodeAt(quote + 1) === 34) {
          value += text.slice(segment, quote + 1);
          index = quote + 2;
          segment = index;
          continue;
        }
        value += text.slice(segment, quote);
        index = quote + 1;
        quotedOpen = false;
        break;
      }
      if (quotedOpen) {
        value += text.slice(segment);
        index = length;
      }
      line += countLineFeeds(value);
    }
    // The unquoted field, or whatever follows a closing quote, runs to the
    // next delimiter or line break.
    let end = index;
    while (end < length) {
      const code = text.charCodeAt(end);
      if (code === delimiterCode || code === 10) break;
      end += 1;
    }
    const stop = end < length ? text.charCodeAt(end) : -1;
    // CRLF ends a record like LF; so does a CR left at the very end of a file.
    const fieldEnd = stop !== delimiterCode && end > index && text.charCodeAt(end - 1) === 13 ? end - 1 : end;
    value += text.slice(index, fieldEnd);
    record.push(value);
    index = end;

    if (stop === delimiterCode) {
      index += 1;
      // "a,b," at the very end: the trailing delimiter opens an empty field.
      if (index === length) {
        record.push("");
        if (complete) endRecord();
      }
    } else if (stop === 10) {
      index += 1;
      line += 1;
      endRecord();
      recordLine = line;
    } else if (complete) {
      // The end of the whole file ends the last record, even one inside an
      // unterminated quote: what it holds is shown rather than lost.
      endRecord();
    }
  }

  return { records, lines };
}

function countLineFeeds(value: string): number {
  let count = 0;
  let from = value.indexOf("\n");
  while (from !== -1) {
    count += 1;
    from = value.indexOf("\n", from + 1);
  }
  return count;
}

/**
 * The delimiter a `.csv` file actually uses: Excel in many locales writes `;`,
 * some exports `\t` or `|`. The candidate whose first records split into the
 * same number (> 1) of fields most often wins; ties go to the earlier one, so
 * an ambiguous file stays comma-separated.
 */
export function detectCsvDelimiter(text: string): string {
  const sample = text.slice(0, DETECT_SAMPLE_CHARS);
  const sampleComplete = sample.length === text.length;
  let best: string = ",";
  let bestScore = 0;
  for (const candidate of CSV_DELIMITER_CANDIDATES) {
    const { records } = parseDelimitedRecords(sample, candidate, {
      complete: sampleComplete,
      maxRecords: DETECT_SAMPLE_RECORDS,
    });
    const width = records[0]?.length ?? 0;
    if (width < 2) continue;
    const consistent = records.filter((record) => record.length === width).length;
    // Consistency first, then more columns.
    const score = consistent * 1000 + Math.min(width, 999);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** The table of a delimited file: the first record is the header row. */
export function parseDelimitedTable(text: string, filePath: string, complete = true): DelimitedTableData {
  const fixed = delimiterForPath(filePath) ?? ",";
  const delimiter = fixed === "," ? detectCsvDelimiter(text) : fixed;
  const { records, lines } = parseDelimitedRecords(text, delimiter, { complete });
  if (records.length === 0) return { columns: [], headerLine: 0, rows: [], rowLines: [] };
  let width = 0;
  for (const record of records) if (record.length > width) width = record.length;
  const header = records[0];
  const columns = header.length === width
    ? header
    : [...header, ...Array.from({ length: width - header.length }, () => "")];
  return { columns, headerLine: lines[0], rows: records.slice(1), rowLines: lines.slice(1) };
}

const MEASURE_SAMPLE_ROWS = 500;
const CHAR_WIDTH_PX = 7.4;
// 10 px padding each side, the 1 px border, 1 px to spare.
const CELL_PADDING_PX = 22;
export const MIN_COLUMN_WIDTH = 64;
export const MAX_COLUMN_WIDTH = 420;

/** Monospace columns a value's first line takes; wide (CJK) characters take two. */
function displayColumns(value: string): number {
  const breakAt = value.indexOf("\n");
  const firstLine = breakAt === -1 ? value : value.slice(0, breakAt);
  let columns = 0;
  for (let index = 0; index < firstLine.length; index += 1) {
    const code = firstLine.charCodeAt(index);
    // Low surrogates belong to the character before them.
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    columns += code >= 0x2e80 ? 2 : 1;
  }
  return columns;
}

/**
 * Each column as wide as its widest sampled value, clamped: a fixed width
 * spends the panel on empty space, and sampling keeps a large file's
 * measurement from scanning every cell.
 */
export function measureColumnWidths(columns: readonly string[], rows: readonly string[][]): number[] {
  const step = Math.max(1, Math.ceil(rows.length / MEASURE_SAMPLE_ROWS));
  return columns.map((column, columnIndex) => {
    let widest = displayColumns(column);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += step) {
      const value = rows[rowIndex][columnIndex];
      if (value) {
        const columnsUsed = displayColumns(value);
        if (columnsUsed > widest) widest = columnsUsed;
      }
    }
    const width = Math.ceil(widest * CHAR_WIDTH_PX + CELL_PADDING_PX);
    return Math.min(Math.max(width, MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH);
  });
}

/**
 * The rows to render for fixed-height rows: [start, end) covering the viewport
 * plus `overscan` rows each way. `scrollTop` is relative to the first row.
 */
export function visibleRowRange(
  rowCount: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): { start: number; end: number } {
  if (rowCount <= 0) return { start: 0, end: 0 };
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 800;
  const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const end = Math.min(rowCount, Math.ceil((top + height) / rowHeight) + overscan);
  return { start: Math.min(start, end), end };
}
