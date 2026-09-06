export const SETTINGS_SECTION_VALUES = [
  "general",
  "models",
  "skills",
  "agents",
  "plugins",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTION_VALUES)[number];
export type SettingsDetailSection = Exclude<SettingsSection, "general">;

const STORAGE_KEY = "pi-web:settings-navigation";
const PROJECT_SECTIONS = new Set<SettingsSection>(["skills", "agents", "plugins"]);

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SettingsNavigationState {
  section?: string;
  selections?: Record<string, string>;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === "string"
    && SETTINGS_SECTION_VALUES.includes(value as SettingsSection);
}

function readState(storage: StorageLike): SettingsNavigationState {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const state = parsed as SettingsNavigationState;
    return {
      section: typeof state.section === "string" ? state.section : undefined,
      selections: state.selections !== null
        && typeof state.selections === "object"
        && !Array.isArray(state.selections)
        ? state.selections
        : undefined,
    };
  } catch {
    return {};
  }
}

function selectionKey(section: SettingsDetailSection, cwd?: string | null): string | null {
  if (section === "models") return section;
  return cwd ? JSON.stringify([section, cwd]) : null;
}

export function getLastSettingsSection(
  cwd: string | null,
  storage: StorageLike | null = getBrowserStorage(),
): SettingsSection {
  if (!storage) return "general";
  try {
    const section = readState(storage).section;
    if (!isSettingsSection(section) || section === "agents") return "general";
    return PROJECT_SECTIONS.has(section) && !cwd ? "general" : section;
  } catch {
    return "general";
  }
}

export function setLastSettingsSection(
  section: SettingsSection,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    const state = readState(storage);
    state.section = section;
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Browser storage is best-effort.
  }
}

export function getLastSettingsSelection(
  section: SettingsDetailSection,
  cwd?: string | null,
  storage: StorageLike | null = getBrowserStorage(),
): string | null {
  if (!storage) return null;
  const key = selectionKey(section, cwd);
  if (!key) return null;
  try {
    const value = readState(storage).selections?.[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setLastSettingsSelection(
  section: SettingsDetailSection,
  value: string,
  cwd?: string | null,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage || !value) return;
  const key = selectionKey(section, cwd);
  if (!key) return;
  try {
    const state = readState(storage);
    state.selections = { ...state.selections, [key]: value };
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Browser storage is best-effort.
  }
}
