/** The browser's own fetch, captured before install.ts replaces it. */
let realFetch: typeof fetch = (...args) => fetch(...args);

export function setRealFetch(value: typeof fetch): void {
  realFetch = value;
}

export function getRealFetch(): typeof fetch {
  return realFetch;
}
