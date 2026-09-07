import { lstatSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { planFirstTurnUndo, type FirstTurnUndoTarget } from "./first-turn-undo";

/** Caller holds the history lock. Shutdown must finish before replacing the file. */
export async function undoFirstTurnFile(
  filePath: string,
  sessionId: string,
  target: FirstTurnUndoTarget,
  shutdown: () => Promise<void>,
): Promise<void> {
  const stat = lstatSync(filePath);
  if (!stat.isFile()) throw new Error("Session must be a regular file");
  const original = readFileSync(filePath, "utf8");
  const replacement = planFirstTurnUndo(original, sessionId, target);
  await shutdown();
  // Shutdown hooks or another writer may append history: never overwrite that work.
  if (readFileSync(filePath, "utf8") !== original) throw new Error("Session changed; refresh before trying again");
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, replacement, { flag: "wx", mode: stat.mode });
    renameSync(temporary, filePath);
  } finally {
    try { unlinkSync(temporary); } catch { /* renamed or never created */ }
  }
}
