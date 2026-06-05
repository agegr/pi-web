import { homedir } from "os";
import { isAbsolute, resolve } from "path";

export function normalizeCwd(cwd: string): string {
  const trimmed = cwd.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
}
