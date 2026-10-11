const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$)/;
const HTML_TAG = /<[A-Za-z!/?]/;
const INLINE_CODE = /`[^`]*`/g;

/**
 * Splits markdown before top-level blocks that cannot belong to the block
 * above, so a streaming message renders block by block: finished blocks keep
 * their parse and only the last one is parsed again as text arrives (one parse
 * of the whole reply per chunk made a long reply quadratic). The pieces join
 * back to the input.
 *
 * A split goes only after a blank line, before a line that starts at column 0
 * and is not a list item: never inside a code fence or a `$$` math block,
 * never inside a loose list or an indented continuation. Raw HTML may wrap
 * blank lines (`<details>`, an inline `<b>` left open), so nothing after the
 * first line with a tag outside inline code is split, nor is a document
 * opening with front matter. A rare miss only makes a block larger
 * or, at worst, renders one transiently apart while streaming: the finished
 * message is rendered whole.
 */
export function splitMarkdownBlocks(markdown: string): string[] {
  const lines = markdown.split("\n");
  if (/^---[ \t]*\r?$/.test(lines[0])) return [markdown];
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: { marker: string; size: number } | null = null;
  let inMath = false;
  let rawHtml = false;
  let afterBlank = false;

  for (const line of lines) {
    const blank = line.trim() === "";
    if (afterBlank && !blank && !fence && !inMath && !rawHtml && current.length > 0
      && !/^[ \t]/.test(line) && !LIST_ITEM.test(line)) {
      blocks.push(current.join("\n") + "\n");
      current = [];
    }
    current.push(line);

    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const size = fenceMatch[1].length;
      if (!fence) fence = { marker, size };
      else if (marker === fence.marker && size >= fence.size) fence = null;
    } else if (!fence) {
      const prose = line.replace(INLINE_CODE, "");
      if (HTML_TAG.test(prose)) rawHtml = true;
      if ((prose.match(/\$\$/g)?.length ?? 0) % 2 === 1) inMath = !inMath;
    }
    afterBlank = blank;
  }
  blocks.push(current.join("\n"));
  return blocks;
}
