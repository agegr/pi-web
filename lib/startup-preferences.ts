import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Settings } from "@oh-my-pi/pi-coding-agent";
import { formatRoleSelector } from "./model-roles";

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
 * Persist explicit browser selections without re-running AgentSession setters.
 *
 * The session constructor already records the effective model and thinking
 * level. Calling setModel()/setThinkingLevel() again would append duplicate
 * session entries and emit duplicate extension events.
 *
 * A model picked in the browser is stored as omp's `default` model role, which
 * is the same slot the TUI's `/model` writes — so the next `omp` run in a
 * terminal starts on the model the browser last selected, and vice versa.
 */
export async function persistExplicitStartupPreferences(
  settings: Settings,
  explicit: ExplicitStartupPreferences,
  effective: EffectiveStartupPreferences,
): Promise<{ modelDefaultChanged: boolean }> {
  if (!explicit.model && !explicit.thinkingLevel) {
    return { modelDefaultChanged: false };
  }

  let modelDefaultChanged = false;

  if (
    explicit.model
    && effective.model
    && explicit.model.provider === effective.model.provider
    && explicit.model.modelId === effective.model.modelId
  ) {
    settings.setModelRole("default", formatRoleSelector(effective.model));
    modelDefaultChanged = true;
  }

  if (
    explicit.thinkingLevel
    && (effective.supportsThinking || effective.thinkingLevel !== "off")
  ) {
    settings.set("defaultThinkingLevel", effective.thinkingLevel as never);
  }

  await settings.flush();
  return { modelDefaultChanged };
}
