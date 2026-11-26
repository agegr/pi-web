/** The page's `localStorage`, or null on the server or where the browser blocks it. */
export function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}
