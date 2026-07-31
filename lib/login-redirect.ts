export function getAuthenticatedLoginRedirect(searchParams: URLSearchParams): string {
  const next = searchParams.get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";

  const nextUrl = new URL(next, "http://localhost");
  return nextUrl.pathname === "/login" ? "/" : `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
}
