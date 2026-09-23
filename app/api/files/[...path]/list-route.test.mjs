import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end !== -1, `end marker not found after ${startMarker}: ${endMarker}`);
  // Include the end marker so assertions can pin it.
  return source.slice(start, end + endMarker.length);
}

test("build/dist live in BUILD_OUTPUT_NAMES, not the unconditional ignore set", () => {
  const ignoredNamesBlock = sliceBetween("const IGNORED_NAMES", "const BUILD_OUTPUT_NAMES");
  // The opt-in exempted names are exactly `dist` and `build`...
  assert.match(source, /const BUILD_OUTPUT_NAMES = new Set\(\["dist", "build"\]\);/);
  // ...and they are gone from the always-hidden set.
  assert.ok(!ignoredNamesBlock.includes('"dist"'), "dist must not be in IGNORED_NAMES");
  assert.ok(!ignoredNamesBlock.includes('"build"'), "build must not be in IGNORED_NAMES");
});

test("performance-critical names stay hidden whether or not the flag is set", () => {
  const ignoredNamesBlock = sliceBetween("const IGNORED_NAMES", "const BUILD_OUTPUT_NAMES");
  for (const name of ["node_modules", ".git", ".next", "__pycache__", "target", "vendor"]) {
    assert.ok(ignoredNamesBlock.includes(`"${name}"`), `${name} must stay in IGNORED_NAMES`);
  }
  // Suffix filters are untouched and unconditional.
  assert.match(source, /const IGNORED_SUFFIXES = \["\.pyc"\];/);
});

test("the flag exempts build/dist only inside the type=list branch", () => {
  const listBlock = sliceBetween('// type === "list"', "return NextResponse.json({ entries, path: filePath });");
  // The parameter is parsed from the query string only here...
  assert.match(
    listBlock,
    /const rawShowBuildOutputs = request\.nextUrl\.searchParams\.get\("showBuildOutputs"\);/,
  );
  assert.match(listBlock, /const showBuildOutputs = rawShowBuildOutputs === "1" \|\| rawShowBuildOutputs === "true";/);
  // ...and the filter chain consults it exactly for the two exempted names,
  // with every other ignored name/suffix remaining unconditional.
  assert.match(
    listBlock,
    /IGNORED_NAMES\.has\(d\.name\)\s*\n\s*\|\| \(BUILD_OUTPUT_NAMES\.has\(d\.name\) && !showBuildOutputs\)\s*\n\s*\|\| IGNORED_SUFFIXES\.some\(\(s\) => d\.name\.endsWith\(s\)\)/,
  );
  // The listing stays a single readdir with lazy expansion: no recursive
  // traversal or artifact search was added.
  assert.doesNotMatch(listBlock, /readdirSync[\s\S]*readdirSync/);
  // No other request type reads the parameter: the only code-side read of
  // the query parameter lives inside the list branch (the BUILD_OUTPUT_NAMES
  // comment above mentions the flag, but comments are not reads).
  const beforeList = source.slice(0, source.indexOf('// type === "list"'));
  assert.ok(
    !beforeList.includes('searchParams.get("showBuildOutputs")'),
    "showBuildOutputs must only be read in the type=list branch",
  );
  assert.equal(
    (source.match(/searchParams\.get\("showBuildOutputs"\)/g) ?? []).length,
    1,
    "the query parameter is read exactly once",
  );
});

test("the response shape and sorting of the list branch are unchanged", () => {
  const listBlock = sliceBetween('// type === "list"', "return NextResponse.json({ entries, path: filePath });");
  assert.match(listBlock, /return NextResponse\.json\(\{ entries, path: filePath \}\);/);
  assert.match(listBlock, /if \(a\.isDir !== b\.isDir\) return a\.isDir \? -1 : 1;/);
  assert.match(listBlock, /return a\.name\.localeCompare\(b\.name\);/);
});

test("download and read never gate on IGNORED_NAMES (build/ artifacts stay downloadable)", () => {
  const downloadBlock = sliceBetween('if (type === "download")', 'if (type === "meta")');
  assert.ok(!downloadBlock.includes("IGNORED_NAMES"), "download must not filter on IGNORED_NAMES");
  assert.ok(!downloadBlock.includes("BUILD_OUTPUT_NAMES"), "download must not filter on BUILD_OUTPUT_NAMES");
  const readBlock = sliceBetween('if (type === "read")', 'if (type === "download")');
  assert.ok(!readBlock.includes("IGNORED_NAMES"), "read must not filter on IGNORED_NAMES");
  assert.ok(!readBlock.includes("BUILD_OUTPUT_NAMES"), "read must not filter on BUILD_OUTPUT_NAMES");
  // The allowed-roots boundary is the only path-based gate on downloads.
  assert.match(source, /isFilePathAllowed\(filePath, allowedRoots\)/);
});
