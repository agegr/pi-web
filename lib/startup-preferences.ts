import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";

export interface ExplicitStartupPreferences {
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
}

export interface EffectiveStartupPreferences {
  model?: { provider: string; modelId: string };
  thinkingLevel: ThinkingLevel;
  supportsThinking: boolean;
}

/**
 * Previously persisted explicit browser model/thinking selections into
 * `~/.pi/agent/settings.json` on every new-session create.
 *
 * That silently overwrote the user's global defaults whenever they picked a
 * one-off model for a single chat (unlike the TUI, where setModel defaults to
 * session-only unless `persist: true`). Keep this helper as the extension
 * point for a future explicit "Save as default" action, but do not mutate
 * settings on ordinary session startup.
 *
 * Session construction already records the effective model/thinking level in
 * the session file. Callers must not re-run setModel()/setThinkingLevel() here
 * either — that would append duplicate session entries.
 */
export async function persistExplicitStartupPreferences(
  _settingsManager: SettingsManager,
  _explicit: ExplicitStartupPreferences,
  _effective: EffectiveStartupPreferences,
): Promise<{ modelDefaultChanged: boolean }> {
  return { modelDefaultChanged: false };
}
