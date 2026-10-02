import {
  defaultToolEntries,
  getGlobalSettingsPath,
  readGlobalSettings,
  updateGlobalSettings,
} from "./global-settings-file";

const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];
const SHELL_TOOLS = new Set(["bash", "powershell"]);

export function isPowerShellToolEnabled(
  defaultTools: readonly string[] | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32"
    && defaultTools?.includes("powershell") === true
    && !defaultTools.includes("bash");
}

export function replaceShellTool(
  toolNames: readonly string[],
  usePowerShell: boolean,
): string[] {
  const shell = usePowerShell ? "powershell" : "bash";
  const result: string[] = [];
  for (const name of toolNames) {
    const next = SHELL_TOOLS.has(name) ? shell : name;
    if (!result.includes(next)) result.push(next);
  }
  return result;
}

export function resolveShellTools(
  toolNames: readonly string[],
  defaultTools: readonly string[] | undefined,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return replaceShellTool(toolNames, isPowerShellToolEnabled(defaultTools, platform));
}

export function getPowerShellSettingsPath(agentDir?: string): string {
  return getGlobalSettingsPath(agentDir);
}

function isToolModifier(entry: string): boolean {
  return entry.startsWith("+") || entry.startsWith("-");
}

/**
 * The tools a `defaultTools` list selects, by pi's rule (0.99): plain names replace the
 * defaults, then each `+name` adds and each `-name` removes a tool, in list order.
 */
export function resolveDefaultToolEntries(entries: readonly string[]): string[] {
  const plain = entries.filter((entry) => !isToolModifier(entry));
  const tools = plain.length > 0 || entries.length === 0 ? plain : [...DEFAULT_TOOLS];
  for (const entry of entries) {
    if (!isToolModifier(entry)) continue;
    const name = entry.slice(1);
    const index = tools.indexOf(name);
    if (entry.startsWith("+") && index === -1 && name) tools.push(name);
    else if (entry.startsWith("-") && index !== -1) tools.splice(index, 1);
  }
  return tools;
}

/**
 * The resolved tool list, never the raw entries: appending a plain name to a list of only
 * `+name`/`-name` entries would turn it into a plain list that drops pi's default tools.
 */
function configuredTools(settings: Record<string, unknown>): string[] | undefined {
  const entries = defaultToolEntries(settings);
  return entries === undefined ? undefined : resolveDefaultToolEntries(entries);
}

export async function readPowerShellToolEnabled(
  settingsPath = getPowerShellSettingsPath(),
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  return readGlobalSettings(settingsPath, (settings) => isPowerShellToolEnabled(configuredTools(settings), platform));
}

export async function writePowerShellToolEnabled(
  enabled: boolean,
  settingsPath = getPowerShellSettingsPath(),
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (platform !== "win32") throw new Error("PowerShell tool settings are only available on Windows");

  await updateGlobalSettings(settingsPath, (settings) => {
    const currentTools = configuredTools(settings) ?? DEFAULT_TOOLS;
    const nextTools = replaceShellTool(currentTools, enabled);
    if (!currentTools.some((name) => SHELL_TOOLS.has(name))) {
      nextTools.push(enabled ? "powershell" : "bash");
    }
    settings.defaultTools = nextTools;
  });
  return enabled;
}
