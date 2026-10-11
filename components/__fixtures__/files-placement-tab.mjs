// hooks/useFilesPlacement with the files in their own tab, the desktop
// setting's other choice: the server snapshot is always "below", so a test
// renders the tabs layout by aliasing the hook to this module.
export const FILES_PLACEMENT_STORAGE_KEY = "pi-web:sidebar-files-placement";
export const FILES_PLACEMENT_DEFAULT = "below";

export function parseFilesPlacement(raw) {
  return raw === "tab" ? "tab" : FILES_PLACEMENT_DEFAULT;
}

export function setFilesPlacement() {}

export function useFilesPlacement() {
  return "tab";
}
