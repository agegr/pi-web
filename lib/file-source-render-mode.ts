import type { FileViewerDisplayMode } from "@/lib/file-viewer-state";

export const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;

export function getSourceRenderMode({
  truncated,
  sourceLineCount,
  highlightLargeSource,
  effectiveDisplayMode,
  hasGitDiff,
  hasPreview,
}: {
  truncated: boolean;
  sourceLineCount: number;
  highlightLargeSource: boolean;
  effectiveDisplayMode: FileViewerDisplayMode;
  hasGitDiff: boolean;
  hasPreview: boolean;
}): "lightweight" | "highlighted" {
  return (truncated || sourceLineCount > SOURCE_HIGHLIGHT_MAX_LINES)
    && !highlightLargeSource
    && !(effectiveDisplayMode === "diff" && hasGitDiff)
    && !(effectiveDisplayMode === "preview" && hasPreview)
    ? "lightweight"
    : "highlighted";
}
