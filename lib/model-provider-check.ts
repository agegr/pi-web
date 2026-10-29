/**
 * Client/server check of the models.json provider entries Settings › Models
 * saves. pi composes every provider when it loads models.json; an entry that
 * breaks one of its rules loses that provider and shows in every chat's model
 * error banner, while the others keep working (#1353). Only the rules an entry
 * breaks on its own are mirrored (the top of `applyModelsJson()` in
 * pi-coding-agent's provider-composer.js); what depends on pi's catalog, such
 * as a custom model's inherited Base URL, is left to pi's own report.
 */

export type ProviderEntryProblem = "empty" | "baseUrl";

const PROBLEM_MESSAGES: Record<ProviderEntryProblem, (provider: string) => string> = {
  empty: (provider) => `Provider ${provider} needs a Base URL or at least one model`,
  baseUrl: (provider) => `Provider ${provider} needs a Base URL`,
};

/** `provider` is the entry's id, so a refused save can select it. */
export class ProviderEntryError extends Error {
  readonly provider: string;
  readonly problem: ProviderEntryProblem;

  constructor(provider: string, problem: ProviderEntryProblem) {
    super(PROBLEM_MESSAGES[problem](provider));
    this.name = "ProviderEntryError";
    this.provider = provider;
    this.problem = problem;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The store drops models with a blank id before writing, so pi never sees them. */
function isWrittenModel(model: unknown): boolean {
  return !isRecord(model) || typeof model.id !== "string" || model.id.trim().length > 0;
}

/** Throws a ProviderEntryError for the first provider entry pi would refuse to load. */
export function checkProviderEntries(config: { providers?: unknown }): void {
  if (!isRecord(config.providers)) return;
  for (const [providerId, entry] of Object.entries(config.providers)) {
    // Anything else fails pi's schema, which models.json readers report on their own.
    if (!isRecord(entry)) continue;
    if (entry.oauth && !entry.baseUrl) throw new ProviderEntryError(providerId, "baseUrl");
    const hasModels = Array.isArray(entry.models) && entry.models.some(isWrittenModel);
    const hasOverrides = isRecord(entry.modelOverrides) && Object.keys(entry.modelOverrides).length > 0;
    if (!hasModels && !entry.baseUrl && !entry.headers && !entry.compat && !hasOverrides
      && !entry.apiKey && !entry.oauth && entry.authHeader === undefined) {
      throw new ProviderEntryError(providerId, "empty");
    }
  }
}
