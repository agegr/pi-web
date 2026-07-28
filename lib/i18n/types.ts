/** The unique identifier of a registered locale plugin. */
export type Locale = string;

/** Simple interpolation parameters used by translated strings. */
export type TranslationParams = Record<string, string | number>;

/** Definition of a locale plugin that can be registered. */
export interface LocalePlugin {
  /** The unique locale plugin identifier. */
  id: string;
  /** The display name used in the locale selection menu. */
  label: string;
  /** Translated messages indexed by stable keys. */
  messages: Record<string, string>;
}
