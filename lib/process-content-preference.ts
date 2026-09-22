const STORAGE_KEY = "pi-web:chat:show-process-content";

export const PROCESS_CONTENT_EVENT = "pi-web:chat:show-process-content-changed";

export function isProcessContentVisible(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

export function setProcessContentVisible(visible: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, String(visible));
  window.dispatchEvent(new Event(PROCESS_CONTENT_EVENT));
}
