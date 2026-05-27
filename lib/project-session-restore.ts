export interface ProjectSessionCandidate {
  id: string;
  cwd: string;
  modified: string;
}

export function pickSessionForCwd<T extends ProjectSessionCandidate>(
  sessions: T[],
  cwd: string | null,
): T | null {
  if (!cwd) return null;

  let best: T | null = null;
  for (const session of sessions) {
    if (session.cwd !== cwd) continue;
    if (!best || session.modified > best.modified) {
      best = session;
    }
  }

  return best;
}
