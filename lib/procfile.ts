export interface ProcfileProcess {
  name: string;
  command: string;
}

/** Procfile commands are shell source; only the first colon is a separator. */
export function parseProcfile(source: string): ProcfileProcess[] {
  const processes: ProcfileProcess[] = [];
  const names = new Set<string>();
  for (const [index, raw] of source.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z0-9_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match || !match[2].trim() || line.includes("\0")) {
      throw new Error(`Procfile.dev line ${index + 1}: expected name: command`);
    }
    if (names.has(match[1])) throw new Error(`Procfile.dev line ${index + 1}: duplicate process ${match[1]}`);
    names.add(match[1]);
    processes.push({ name: match[1], command: match[2] });
  }
  if (!processes.length) throw new Error("Procfile.dev contains no processes");
  if (processes.length > 64) throw new Error("Procfile.dev contains more than 64 processes");
  return processes;
}
