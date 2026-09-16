export interface InitialNavigation {
  requestedCwd: string | null;
  sessionId: string | null;
  sidebarCollapsed: boolean;
}

export function getInitialNavigation(
  searchParams: Pick<URLSearchParams, "get">,
): InitialNavigation {
  const requestedCwd = searchParams.get("cwd")?.trim() || null;

  return {
    requestedCwd,
    sessionId: requestedCwd ? null : searchParams.get("session"),
    sidebarCollapsed: searchParams.get("sidebar") === "collapsed",
  };
}
