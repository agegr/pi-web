import { join } from "path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import { displaySettingsPath } from "./enabled-models-runtime";

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevel);
}

/** What the model and reasoning selectors' "save as default" action writes. */
export interface DefaultPreferencesEdit {
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
}

/**
 * Project settings keys that would hide this edit.
 *
 * `SettingsManager` only ever writes the global file, and a project
 * `.pi/settings.json` value wins over it, so writing a default the project
 * overrides would report success while new chats kept starting with the
 * project's choice. The route refuses instead and names the file.
 */
export function shadowingProjectKeys(
  settingsManager: SettingsManager,
  edit: DefaultPreferencesEdit,
): string[] {
  const project = settingsManager.getProjectSettings();
  const keys: string[] = [];
  if (edit.model) {
    if (project.defaultProvider !== undefined) keys.push("defaultProvider");
    if (project.defaultModel !== undefined) keys.push("defaultModel");
  }
  if (edit.thinkingLevel && project.defaultThinkingLevel !== undefined) keys.push("defaultThinkingLevel");
  return keys;
}

export function projectSettingsPath(cwd: string): string {
  return displaySettingsPath(join(cwd, ".pi", "settings.json"));
}

/**
 * Persist the global defaults new sessions start with, like the TUI's Ctrl+S
 * in `/model` and `/thinking`.
 *
 * `SettingsManager` skips the write when it could not load the settings file
 * and collects storage failures instead of throwing, so the queue is drained
 * here: a default that did not reach disk must not report success.
 */
export async function writeDefaultPreferences(
  settingsManager: SettingsManager,
  edit: DefaultPreferencesEdit,
): Promise<void> {
  const loadErrors = settingsManager.drainErrors();
  const globalLoadError = loadErrors.find((entry) => entry.scope === "global");
  if (globalLoadError) throw globalLoadError.error;
  if (edit.model) settingsManager.setDefaultModelAndProvider(edit.model.provider, edit.model.modelId);
  if (edit.thinkingLevel) settingsManager.setDefaultThinkingLevel(edit.thinkingLevel);
  await settingsManager.flush();
  const errors = settingsManager.drainErrors();
  if (errors.length > 0) throw errors[0].error;
}
