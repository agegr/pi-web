/** GitHub Pages prefix (e.g. "/pi-web"), empty for local builds. */
export const DEMO_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix a root-relative static asset path with the Pages base path. */
export function demoAssetPath(path: string): string {
  return `${DEMO_BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Current pathname without the base path, for `router.replace()`, which adds
 * the base path itself. Pi Web passes `window.location.pathname` directly.
 */
export function demoRouterPath(): string {
  if (typeof window === "undefined") return "/";
  const { pathname } = window.location;
  const stripped = DEMO_BASE_PATH && pathname.startsWith(DEMO_BASE_PATH) ? pathname.slice(DEMO_BASE_PATH.length) : pathname;
  return stripped || "/";
}
