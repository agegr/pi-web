/**
 * Dialog-title rendering helpers for the extension request dialog.
 *
 * A dialog title can be long and may embed a risky command inside a ```sh / ```bash
 * code fence. We split the title into a one-line "head" (pinned in the dialog header)
 * and the remaining "rest" (shown in the scrollable body), and render any code fences
 * in the rest as highlighted code blocks.
 */

/** Split a dialog title at its first newline into a one-line head and the rest. */
export function splitDialogTitle(title: string): { head: string; rest: string } {
  const firstNewline = title.indexOf("\n");
  return {
    head: firstNewline === -1 ? title : title.slice(0, firstNewline),
    rest: firstNewline === -1 ? "" : title.slice(firstNewline + 1),
  };
}

export type DialogTitleSegment = { text: string; isCode: boolean };

/**
 * Split dialog-title text into alternating text / code segments. A ```sh or ```bash
 * code fence (with an optional trailing newline) toggles into a code segment; all
 * other content is plain text. The first segment is always text, and code segments
 * are the ones that get highlighted.
 */
export function splitDialogTitleCode(title: string): DialogTitleSegment[] {
  const parts = title.split(/```(?:sh|bash)?\s*\n?/);
  if (parts.length === 1) {
    return [{ text: parts[0], isCode: false }];
  }
  return parts.map((text, i) => {
    // Drop the single newline that precedes the closing fence so the highlighted
    // code block does not end with a stray blank line.
    const value = i % 2 === 1 ? text.replace(/\n$/, "") : text;
    return { text: value, isCode: i % 2 === 1 };
  });
}
