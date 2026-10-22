/**
 * What the Generate title button's model menu offers, as plain data the shell
 * turns into labelled items. Pure, so the rules are testable without a DOM:
 * a level survives clearing the model (it then applies to the session's own),
 * a model survives clearing the level, and a chosen model offers only the
 * levels it supports. The choice itself lives in lib/title-model-preference.ts.
 */

import type { TitleModelPreference } from "./title-model-preference";

/** One model the menu may name with, with the levels `getSupportedThinkingLevels` reports for it. */
export interface TitleMenuModel {
  provider: string;
  modelId: string;
  name: string;
  levels: string[];
}

export type TitleMenuEntry =
  | { kind: "header"; id: "model" | "level" | "unavailable" }
  | { kind: "separator" }
  /** The session's own model; chosen when no model is. */
  | { kind: "session-model"; checked: boolean }
  | { kind: "model"; provider: string; modelId: string; name: string; checked: boolean }
  /** `level` null is "the cheapest the model supports". */
  | { kind: "level"; level: string | null; checked: boolean };

/** Every level pi has, as the menu's fallback when the chosen model's own list is unknown. */
export const TITLE_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Whether the preference names a model, as opposed to following the session's own. */
export function titleModelOf(preference: TitleModelPreference | null): { provider: string; modelId: string } | null {
  return preference?.provider && preference.modelId
    ? { provider: preference.provider, modelId: preference.modelId }
    : null;
}

/** The preference a choice of a model stores; null names with the session's own. The level choice beside it is kept. */
export function preferenceWithModel(
  preference: TitleModelPreference | null,
  model: { provider: string; modelId: string } | null,
): TitleModelPreference | null {
  const level = preference?.thinkingLevel;
  const next: TitleModelPreference = {
    ...(model ? { provider: model.provider, modelId: model.modelId } : {}),
    ...(level ? { thinkingLevel: level } : {}),
  };
  return Object.keys(next).length > 0 ? next : null;
}

/** The preference a choice of a level stores; null asks for the model's cheapest. The model choice beside it is kept. */
export function preferenceWithLevel(
  preference: TitleModelPreference | null,
  level: string | null,
): TitleModelPreference | null {
  const model = titleModelOf(preference);
  const next: TitleModelPreference = {
    ...(model ? { provider: model.provider, modelId: model.modelId } : {}),
    ...(level ? { thinkingLevel: level } : {}),
  };
  return Object.keys(next).length > 0 ? next : null;
}

/**
 * The menu in order: the choice of model, then the levels the effective one
 * supports. `models` is null until the list has been read; `failed` says that
 * it could not be, which the menu says outright rather than showing no models.
 */
export function titleMenuEntries(input: {
  preference: TitleModelPreference | null;
  models: TitleMenuModel[] | null;
  failed: boolean;
}): TitleMenuEntry[] {
  const { preference, models, failed } = input;
  const chosen = titleModelOf(preference);
  const entries: TitleMenuEntry[] = [
    { kind: "header", id: "model" },
    {
      kind: "session-model",
      checked: chosen === null,
    },
  ];
  if (models === null) {
    if (failed) entries.push({ kind: "header", id: "unavailable" });
  } else {
    for (const model of models) {
      entries.push({
        kind: "model",
        provider: model.provider,
        modelId: model.modelId,
        name: model.name,
        checked: chosen?.provider === model.provider && chosen.modelId === model.modelId,
      });
    }
  }

  // A model's own levels, or every level while the session's own model names the
  // session: that one's list is not part of this menu.
  const effective = chosen
    ? models?.find((model) => model.provider === chosen.provider && model.modelId === chosen.modelId)
    : undefined;
  const levels = effective?.levels.length ? effective.levels : TITLE_THINKING_LEVELS;
  const chosenLevel = preference?.thinkingLevel ?? null;
  entries.push(
    { kind: "separator" },
    { kind: "header", id: "level" },
    { kind: "level", level: null, checked: chosenLevel === null },
    ...levels.map((level): TitleMenuEntry => ({ kind: "level", level, checked: chosenLevel === level })),
  );
  return entries;
}
