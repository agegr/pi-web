import { createStoredChoice } from "./useStoredChoice";

/** Where the desktop sidebar shows the file browser: under the sessions, or behind its own tab. Phones always use tabs. */
export type FilesPlacement = "below" | "tab";

export const FILES_PLACEMENT_STORAGE_KEY = "pi-web:sidebar-files-placement";
export const FILES_PLACEMENT_DEFAULT: FilesPlacement = "below";

export function parseFilesPlacement(raw: string | null): FilesPlacement {
  return raw === "tab" ? "tab" : FILES_PLACEMENT_DEFAULT;
}

const placement = createStoredChoice(FILES_PLACEMENT_STORAGE_KEY, parseFilesPlacement, FILES_PLACEMENT_DEFAULT);

export function setFilesPlacement(next: FilesPlacement): void {
  placement.set(next);
}

export function useFilesPlacement(): FilesPlacement {
  return placement.use();
}
