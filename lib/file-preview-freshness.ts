// Project files are mutable, unlike images attached to transcript entries.
let revision = 0;
const pageEpoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function nextFilePreviewVersion(): string {
  return `${pageEpoch}-${++revision}`;
}

export function fetchLiveFile(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, cache: "no-store" });
}

export function requestFilePreviewRefresh(filePath: string): void {
  window.dispatchEvent(new CustomEvent("pi-web:refresh-file-preview", { detail: { filePath } }));
}

// The callback checks size+mtime before loading: focusing or reopening an
// unchanged preview must not discard HTML form state, PDF position or playback.
export function onFilePreviewRefresh(filePath: string, checkVersion: () => void): () => void {
  const visible = () => {
    if (document.visibilityState !== "hidden") checkVersion();
  };
  const reopened = (event: Event) => {
    if ((event as CustomEvent<{ filePath: string }>).detail?.filePath === filePath) checkVersion();
  };
  window.addEventListener("focus", visible);
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("pi-web:refresh-file-preview", reopened);
  return () => {
    window.removeEventListener("focus", visible);
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("pi-web:refresh-file-preview", reopened);
  };
}
