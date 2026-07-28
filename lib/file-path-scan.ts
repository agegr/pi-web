import { isPreviewableExtension } from "./file-types";

export interface FilePathMatch {
  start: number;
  end: number;
  path: string;
}

// CJK/fullwidth punctuation cannot occur in a path but constantly abuts one in
// Chinese prose. Unlike ASCII punctuation it is not followed by a space, so it
// lands mid-candidate ("/tmp/a.md，请查看") where a $-anchored strip cannot
// reach it. Excluding it here ends the candidate at the punctuation instead.
// The curly quotes are GB/T 15834's Simplified Chinese quotation marks, the
// typographic counterparts of the ASCII " and ' already excluded above. Dashes
// are deliberately absent: "/tmp/a-b–c.md" is a legal file name.
const CANDIDATE_PATTERN = /\/[^\s"'`<>|*?“”‘’。，、；：！？…（）【】《》「」『』]+/g;
// CJK entries here are unreachable — new CJK punctuation belongs in CANDIDATE_PATTERN.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"。，、；：！？）】》」』…]+$/;

function stripLineSuffix(value: string): string {
  return value.replace(/:\d+(?::\d+)?$/, "");
}

function hasDottedBaseName(value: string): boolean {
  const base = value.replace(/\\/g, "/").split("/").pop() ?? "";
  return base.includes(".");
}

export function scanFilePaths(text: string): FilePathMatch[] {
  const matches: FilePathMatch[] = [];
  CANDIDATE_PATTERN.lastIndex = 0;

  let candidate: RegExpExecArray | null;
  while ((candidate = CANDIDATE_PATTERN.exec(text)) !== null) {
    const start = candidate.index;

    // Protocol-relative and UNC-style prefixes are rejected downstream anyway.
    if (candidate[0].startsWith("//")) continue;
    // A path glued to a preceding word is almost always not a path.
    if (start > 0 && /[A-Za-z0-9]/.test(text[start - 1])) continue;
    // A "/" rooted in a Windows drive-letter prefix ("C:/...") is not a Unix
    // path. Drive paths are intentionally not linkified (known limitation; see
    // design spec), and the ":" before "/" slips past the word-glue guard above.
    // Only a standalone drive letter is rejected, so scheme tails like "https://"
    // still match here at the first slash and get dropped by the "//" check.
    if (
      start >= 2 &&
      text[start - 1] === ":" &&
      /[A-Za-z]/.test(text[start - 2]) &&
      (start === 2 || !/[A-Za-z0-9]/.test(text[start - 3]))
    ) {
      continue;
    }

    const trimmed = candidate[0].replace(TRAILING_PUNCTUATION, "");
    if (!trimmed) continue;
    const bare = stripLineSuffix(trimmed);
    // getFileExt() falls back to the whole base name when there is no dot, so
    // "/bin/bash" would otherwise read as extension "bash". Require a real dot.
    if (!hasDottedBaseName(bare)) continue;
    if (!isPreviewableExtension(bare)) continue;

    matches.push({ start, end: start + trimmed.length, path: trimmed });
  }

  return matches;
}
