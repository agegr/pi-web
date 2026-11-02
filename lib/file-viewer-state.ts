export type FileViewerDisplayMode = "source" | "preview" | "diff";

export interface FileViewerState {
  displayMode: FileViewerDisplayMode;
  // Undefined means the reader never chose: the file's own kind decides (see
  // wrapsByDefault). A pressed toggle writes a boolean, and that wins forever
  // after, whatever the extension says.
  wrapLines?: boolean;
  scrollTop: number;
  scrollLeft: number;
}

export function resolveInitialFileDisplayMode(
  initialState?: FileViewerState,
  initialDisplayMode?: FileViewerDisplayMode,
): FileViewerDisplayMode {
  return initialState?.displayMode ?? initialDisplayMode ?? "source";
}

// Prose: a long line is the same sentence going on, so the wrap button's job is
// already done and a horizontal scrollbar only hides the rest of the paragraph.
// Source code is the opposite — an editor keeps one line per row and scrolls
// sideways, because indentation and column alignment are the reading cue.
// `.txt` is here because it holds prose more often than structure; `.log` is not,
// because a log line is a column: a timestamp, a level, a message, and wrapping
// it puts the next line's timestamp where its message was.
const PROSE_EXTENSIONS = new Set(["md", "markdown", "mdx", "mdown", "mkd", "rst", "adoc", "txt"]);

export function wrapsByDefault(filePath?: string): boolean {
  if (!filePath) return false;
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const ext = base.toLowerCase().split(".").pop() ?? "";
  return PROSE_EXTENSIONS.has(ext);
}

export function resolveInitialWrapLines(
  initialState?: { wrapLines?: boolean },
  filePath?: string,
): boolean {
  return initialState?.wrapLines ?? wrapsByDefault(filePath);
}
