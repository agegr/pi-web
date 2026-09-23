/**
 * Line diffs for the Git changes panel (`git diff` hunks) and for edit tool
 * results (pi's `details.patch` / `details.diff` formats from edit-diff.ts).
 */

export type DiffOp = { kind: " " | "-" | "+"; line: string };

/** LCS line diff; common prefix/suffix are trimmed first so large files stay cheap. */
export function diffOps(before: string, after: string): DiffOp[] {
  const a = before.split("\n");
  const b = after.split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  const n = midA.length;
  const m = midB.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = a.slice(0, prefix).map((line) => ({ kind: " ", line }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) { ops.push({ kind: " ", line: midA[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push({ kind: "-", line: midA[i++] });
    else ops.push({ kind: "+", line: midB[j++] });
  }
  while (i < n) ops.push({ kind: "-", line: midA[i++] });
  while (j < m) ops.push({ kind: "+", line: midB[j++] });
  for (const line of a.slice(a.length - suffix)) ops.push({ kind: " ", line });
  // A trailing newline produces one empty final line on both sides; drop it.
  if (ops.length && ops[ops.length - 1].kind === " " && ops[ops.length - 1].line === "" && before.endsWith("\n")) ops.pop();
  return ops;
}

/** `@@` hunks with `context` lines around each change. */
export function unifiedHunks(ops: DiffOp[], context: number): { text: string; additions: number; deletions: number } {
  const changed = ops.map((op, index) => (op.kind !== " " ? index : -1)).filter((index) => index >= 0);
  const hunks: string[] = [];
  let additions = 0;
  let deletions = 0;
  let cursor = 0;
  while (cursor < changed.length) {
    const start = Math.max(0, changed[cursor] - context);
    let end = Math.min(ops.length - 1, changed[cursor] + context);
    while (cursor + 1 < changed.length && changed[cursor + 1] - context <= end + 1) {
      cursor++;
      end = Math.min(ops.length - 1, changed[cursor] + context);
    }
    cursor++;
    let oldLine = 1;
    let newLine = 1;
    for (let index = 0; index < start; index++) {
      if (ops[index].kind !== "+") oldLine++;
      if (ops[index].kind !== "-") newLine++;
    }
    const slice = ops.slice(start, end + 1);
    const oldCount = slice.filter((op) => op.kind !== "+").length;
    const newCount = slice.filter((op) => op.kind !== "-").length;
    additions += slice.filter((op) => op.kind === "+").length;
    deletions += slice.filter((op) => op.kind === "-").length;
    hunks.push(`@@ -${oldLine},${oldCount} +${newLine},${newCount} @@\n${slice.map((op) => `${op.kind}${op.line}`).join("\n")}`);
  }
  return { text: hunks.join("\n"), additions, deletions };
}

/** pi's edit tool details: a headered unified patch plus a numbered display diff. */
export function editToolDetails(path: string, before: string, after: string) {
  const ops = diffOps(before, after);
  const patch = `--- ${path}\n+++ ${path}\n${unifiedHunks(ops, 4).text}\n`;
  const width = String(Math.max(before.split("\n").length, after.split("\n").length)).length;
  const lines: string[] = [];
  let oldLine = 1;
  let newLine = 1;
  let firstChangedLine: number | undefined;
  const near = (index: number) => ops.slice(Math.max(0, index - 4), index + 5).some((op) => op.kind !== " ");
  let skipped = false;
  ops.forEach((op, index) => {
    if (op.kind === " ") {
      if (near(index)) {
        lines.push(` ${String(oldLine).padStart(width)} ${op.line}`);
        skipped = false;
      } else if (!skipped) {
        lines.push(` ${"".padStart(width)} ...`);
        skipped = true;
      }
      oldLine++;
      newLine++;
    } else if (op.kind === "-") {
      firstChangedLine ??= newLine;
      lines.push(`-${String(oldLine).padStart(width)} ${op.line}`);
      oldLine++;
      skipped = false;
    } else {
      firstChangedLine ??= newLine;
      lines.push(`+${String(newLine).padStart(width)} ${op.line}`);
      newLine++;
      skipped = false;
    }
  });
  while (lines.length && lines[0].trimEnd().endsWith("...")) lines.shift();
  while (lines.length && lines[lines.length - 1].trimEnd().endsWith("...")) lines.pop();
  return { diff: lines.join("\n"), patch, firstChangedLine };
}
