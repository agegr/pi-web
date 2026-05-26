export interface RecentCwdOption {
  cwd: string;
  source: "stored" | "session" | "both";
  removable: boolean;
}

export function buildRecentCwdOptions(
  sessionCwds: string[],
  storedCwds: string[],
  limit = 5,
): RecentCwdOption[] {
  const sessionSet = new Set(sessionCwds);
  const result: RecentCwdOption[] = [];
  const seen = new Set<string>();

  for (const cwd of storedCwds) {
    if (seen.has(cwd)) continue;
    seen.add(cwd);
    result.push({
      cwd,
      source: sessionSet.has(cwd) ? "both" : "stored",
      removable: !sessionSet.has(cwd),
    });
    if (result.length >= limit) return result;
  }

  for (const cwd of sessionCwds) {
    if (seen.has(cwd)) continue;
    seen.add(cwd);
    result.push({
      cwd,
      source: "session",
      removable: false,
    });
    if (result.length >= limit) return result;
  }

  return result;
}

export function removeStoredRecentCwd(storedCwds: string[], cwd: string): string[] {
  return storedCwds.filter((item) => item !== cwd);
}
