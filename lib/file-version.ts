/**
 * A watched file's version as `/api/files` meta and watch `change` events report
 * it (size and modification time). A viewer that reconnects its watch (the page
 * came back from hidden, the panel reopened) compares it with the version it
 * shows, so an unchanged image, recording or PDF is not loaded again: that would
 * restart playback and lose the PDF's scroll position. Null when either part is
 * missing, which always counts as a change.
 */
export function fileVersion(meta: { size?: unknown; mtime?: unknown } | null | undefined): string | null {
  if (!meta || typeof meta.size !== "number" || typeof meta.mtime !== "string") return null;
  return `${meta.size}:${meta.mtime}`;
}

/** Whether a reconnect's meta read shows a file other than the one on screen. */
export function fileVersionChanged(shown: string | null, next: string | null): boolean {
  return shown === null || next === null || shown !== next;
}
