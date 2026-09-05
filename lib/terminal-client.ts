export async function terminalRequest(path: string, options?: RequestInit): Promise<{ id?: string; cwd?: string }> {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(15_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export function createTerminalWriter(id: string, onError: (error: Error) => void) {
  let pending = Promise.resolve();
  let stopped = false;
  let bufferedInput: { type: "input"; data: string } | null = null;
  const enqueue = (body: Record<string, unknown>) => {
    if (stopped) return;
    pending = pending.then(async () => {
      if (stopped) return;
      if (body === bufferedInput) bufferedInput = null;
      await terminalRequest(`/api/terminal/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }).catch((error: Error) => {
      // Delivery is ambiguous after a network error. Never replay shell input.
      stopped = true;
      onError(error);
    });
  };
  return {
    write(data: string) {
      if (stopped) return;
      for (const chunk of data.match(/[\s\S]{1,32768}/gu) ?? []) {
        if (bufferedInput && bufferedInput.data.length + chunk.length <= 65536) bufferedInput.data += chunk;
        else {
          bufferedInput = { type: "input", data: chunk };
          enqueue(bufferedInput);
        }
      }
    },
    resize(cols: number, rows: number) {
      bufferedInput = null;
      enqueue({ type: "resize", cols, rows });
    },
    stop() { stopped = true; bufferedInput = null; return pending; },
  };
}
