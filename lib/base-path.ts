// Base-path helpers for sub-path deployments.
//
// pi-web does not hardcode support for Next.js `basePath` everywhere — client
// fetches, EventSource streams and asset references use absolute root paths
// (`/api/...`, `/sw.js`). These helpers make every client-originated URL
// base-path aware so the app can be served under e.g. `https://host/dev/`.
//
// The value comes from `NEXT_PUBLIC_BASE_PATH` (set alongside `basePath` in
// next.config.ts) and is empty for a root deployment.

export const BASE_PATH: string = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

/** Prefix a root-absolute path with the configured base path. */
export function withBasePath(path: string): string {
  if (!BASE_PATH) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`) || path.startsWith(`${BASE_PATH}?`)) {
    return path;
  }
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Prefix an API path (`/api/...`) with the configured base path. */
export function apiUrl(path: string): string {
  return withBasePath(path);
}
