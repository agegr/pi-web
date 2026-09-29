/**
 * Where the login page may send the browser after a successful sign-in: the
 * same-origin location named by its `next` query, or `/`.
 *
 * A leading `/` alone does not prove the target is local: the URL parser reads
 * `/\evil.example` and `/<TAB>/evil.example` as `//evil.example`, another host.
 * Resolve against the page origin and require that the origin is unchanged.
 */
export function safeLoginDestination(next: string | null, origin: string): string {
  if (!next?.startsWith("/")) return "/";
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? url.href : "/";
  } catch {
    return "/";
  }
}
