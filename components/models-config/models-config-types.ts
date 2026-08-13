// Shared types for the Models settings surface. These shapes mirror the
// models.json document and the auth provider listings; do not broaden them
// or change serialized fields.

export interface OAuthProvider {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  /** Provider also accepts an API key, so it appears in both picker sections. */
  supportsApiKey?: boolean;
}

export interface ApiKeyProvider {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  /** Provider also supports OAuth, so it appears in both picker sections. */
  supportsOAuth?: boolean;
}

export interface ModelEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; tiers?: unknown };
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
}

export interface ProviderEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: ModelEntry[];
  modelOverrides?: Record<string, unknown>;
}

export interface ModelsJson {
  providers?: Record<string, ProviderEntry>;
}

export type Selection =
  | { type: "provider"; name: string }
  | { type: "model"; providerName: string; index: number }
  | { type: "oauth"; providerId: string }
  | { type: "apikey"; providerId: string };

/** Row shown under the Accounts group in the models navigator. */
export interface ModelsAccountItem {
  kind: "oauth" | "apikey";
  id: string;
  name: string;
  connected: boolean;
  modelCount: number;
}

/** Row shown under the Custom providers group, with its model rows. */
export interface ModelsCustomProviderItem {
  name: string;
  baseUrl?: string;
  api?: string;
  modelCount: number;
  models: { id: string; name?: string; reasoning?: boolean; index: number }[];
}

/**
 * Settings integration contract. ModelsConfig reports this controller to
 * SettingsPage; SettingsPage combines it with its dirty-exit dialog and
 * registers one back handler with AppShell.
 */
export interface ModelsDraftController {
  dirty: boolean;
  discard(): void;
  /** Consumes Models-owned back layers (picker, confirmation, detail). */
  handleBack(): boolean;
  mobileDetailOpen: boolean;
}
