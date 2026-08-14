// Server-side per-session prompt generation counter. Every accepted prompt
// bumps the generation; SSE events are stamped with the generation that was
// current when they were emitted, so the client can drop terminal events that
// belong to a run that ended before a newer prompt started. Stored on
// globalThis so it survives Vite hot reload.
declare global {
  var __piPromptGenerations: Map<string, number> | undefined;
}

function getGenerations(): Map<string, number> {
  if (!globalThis.__piPromptGenerations) globalThis.__piPromptGenerations = new Map();
  return globalThis.__piPromptGenerations;
}

export function nextPromptGeneration(sessionId: string): number {
  const generations = getGenerations();
  const next = (generations.get(sessionId) ?? 0) + 1;
  generations.set(sessionId, next);
  return next;
}

export function getPromptGeneration(sessionId: string): number {
  return getGenerations().get(sessionId) ?? 0;
}
