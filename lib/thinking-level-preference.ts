const STORAGE_KEY = "pi-thinking-level";
export type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
const LEVELS = new Set<string>(["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"]);

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function getPreferredThinkingLevel(storage: StorageLike | null = browserStorage()): ThinkingLevelOption | null {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return value && LEVELS.has(value) ? value as ThinkingLevelOption : null;
  } catch {
    return null;
  }
}

export function setPreferredThinkingLevel(level: ThinkingLevelOption, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, level);
  } catch {
    // Browser storage is best-effort.
  }
}

/** Current selections beat scope pins; inherited preferences do not. */
export function resolveThinkingPreference(options: {
  explicit: ThinkingLevelOption | null;
  preferred: ThinkingLevelOption | null;
  supported?: string[];
  pinned?: string;
}): { level: ThinkingLevelOption; override: Exclude<ThinkingLevelOption, "auto"> | null } {
  const { explicit, preferred, supported, pinned } = options;
  const compatible = (value: string | null | undefined): value is Exclude<ThinkingLevelOption, "auto"> =>
    Boolean(value && value !== "auto" && LEVELS.has(value) && supported?.includes(value));
  if (explicit === "auto") return { level: "auto", override: null };
  if (compatible(explicit)) return { level: explicit, override: explicit };
  if (pinned && LEVELS.has(pinned)) return { level: pinned as ThinkingLevelOption, override: null };
  if (preferred === "auto") return { level: "auto", override: null };
  if (compatible(preferred)) return { level: preferred, override: preferred };
  return { level: "auto", override: null };
}
