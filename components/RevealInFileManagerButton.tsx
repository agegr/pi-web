"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { revealPathInFileManager } from "@/lib/path-actions";
import { FolderIcon } from "./FileIcons";

/**
 * Reveal a local path in the OS file manager (Explorer / Finder / xdg-open).
 *
 * A directory opens as-is; a file is revealed with its entry selected. The icon
 * is the file tree's own folder icon (catppuccin `_folder`) so both places read
 * as the same thing. Failures (outside the allowed roots, missing path) surface
 * in the tooltip so the button stays a single-click affordance.
 */
export function RevealInFileManagerButton({ filePath, className = "file-viewer-icon-button", iconSize = 14 }: {
  filePath: string;
  className?: string;
  iconSize?: number;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  const reveal = useCallback(() => {
    setError(null);
    void revealPathInFileManager(filePath).then(setError);
  }, [filePath]);

  const label = error ?? t("i18n.revealInFileManager");

  return (
    <button
      type="button"
      onClick={reveal}
      title={label}
      aria-label={label}
      className={className}
      style={error ? { color: "#f87171" } : undefined}
    >
      <FolderIcon size={iconSize} />
    </button>
  );
}
