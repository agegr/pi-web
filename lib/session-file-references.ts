import { getSessionEntries, resolveSessionPath } from "./session-reader";
import {
  isBashOutputPathReferencedByEntries,
  isValidSessionId,
} from "./session-file-references-core";

export async function isBashOutputPathReferencedBySession(filePath: string, sessionId: string | null): Promise<boolean> {
  if (!isValidSessionId(sessionId)) return false;
  try {
    const sessionPath = await resolveSessionPath(sessionId);
    if (!sessionPath) return false;
    return isBashOutputPathReferencedByEntries(filePath, getSessionEntries(sessionPath));
  } catch {
    return false;
  }
}
