import { encodeFilePathForApi } from "./file-paths";

// Share in-flight requests across repeated references, but do not cache missing
// files: an agent may create them later in the same conversation.
const pending = new Map<string, Promise<boolean>>();
const waiters: Array<() => void> = [];
let activeRequests = 0;

async function checkMetadata(filePath: string): Promise<boolean> {
  // Long histories can contain hundreds of candidates; avoid flooding the server.
  if (activeRequests >= 6) await new Promise<void>((resolve) => waiters.push(resolve));
  else activeRequests++;
  try {
    const response = await fetch(`/api/files/${encodeFilePathForApi(filePath)}?type=meta`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    const next = waiters.shift();
    if (next) next();
    else activeRequests--;
  }
}

export function validateFileLink(filePath: string): Promise<boolean> {
  const existing = pending.get(filePath);
  if (existing) return existing;
  const request = checkMetadata(filePath).finally(() => {
    pending.delete(filePath);
  });
  pending.set(filePath, request);
  return request;
}
