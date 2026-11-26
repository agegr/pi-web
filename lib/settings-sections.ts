/**
 * Downstream Settings sections (`docs/integrations.md`, "Downstream Settings
 * Sections").
 *
 * A pi extension registers a section in `lib/settings-sections-host.ts`; Pi Web
 * renders the fields that section declares with its own settings blocks, so no
 * component, HTML or CSS ever reaches the page. This module is the contract the
 * server and the panel share: the descriptor shape, the checks that keep a
 * broken descriptor out of the dialog, and the pure helpers both sides call.
 *
 * A descriptor this build cannot render is refused whole: a section never
 * half-renders.
 */

import { isRecord } from "./is-record";
import { SETTINGS_SECTION_VALUES } from "./settings-navigation";

export const MAX_SETTINGS_SECTIONS = 8;
export const MAX_SECTION_FIELDS = 24;
export const MAX_FIELD_OPTIONS = 50;
export const MAX_SECTION_NOTES = 4;

const MAX_TEXT_LENGTH = 200;
const MAX_VALUE_LENGTH = 4096;
const MAX_MESSAGE_LENGTH = 400;
const SECTION_ID_PATTERN = /^ext:[a-z0-9][a-z0-9-]{0,23}$/;
const FIELD_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/;

/** The icons a section may name; anything else uses the default one. */
export const SETTINGS_SECTION_ICON_NAMES = ["sync", "server", "plug"] as const;
export type SettingsSectionIconName = (typeof SETTINGS_SECTION_ICON_NAMES)[number];

export const SETTINGS_STATUS_STATES = ["ok", "warn", "error", "busy", "unknown"] as const;
export type SettingsStatusState = (typeof SETTINGS_STATUS_STATES)[number];

/** A string, or one per UI language; a missing language falls back to `en`. */
export type LocalizedText = string | { en: string; "zh-CN"?: string; "zh-TW"?: string };

export interface SettingsFieldOption {
  value: string;
  label: LocalizedText;
}

/**
 * One row of the form. `readonly` shows a fact (a resolved address, a version);
 * the others collect a value under `key`.
 */
export type SettingsField =
  | { kind: "text"; key: string; label: LocalizedText; placeholder?: string }
  | { kind: "password"; key: string; label: LocalizedText; placeholder?: string }
  | { kind: "switch"; key: string; label: LocalizedText }
  | { kind: "select"; key: string; label: LocalizedText; options: readonly SettingsFieldOption[] }
  | { kind: "readonly"; label: LocalizedText; value: LocalizedText; mono?: boolean };

/** The status line above the form; the extension decides what each state means. */
export interface SettingsSectionStatus {
  state: SettingsStatusState;
  text: LocalizedText;
}

export interface SettingsSectionDescriptor {
  /** `ext:` and a slug; never a built-in section's name. */
  id: string;
  label: LocalizedText;
  icon?: SettingsSectionIconName;
  fields: readonly SettingsField[];
  applyLabel?: LocalizedText;
  notes?: readonly LocalizedText[];
}

export interface SettingsReadResult {
  values?: Record<string, unknown>;
  status?: SettingsSectionStatus;
}

export type SettingsFieldValue = string | boolean;

const EMPTY: readonly SettingsSectionDescriptor[] = Object.freeze([]);

/** The text for the active language, falling back to `en`. */
export function localizedText(value: LocalizedText, locale: string): string {
  if (typeof value === "string") return value;
  if (locale === "zh-TW" && value["zh-TW"]) return value["zh-TW"];
  if (locale === "zh-CN" && value["zh-CN"]) return value["zh-CN"];
  return value.en;
}

function normalizeText(value: unknown): LocalizedText | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text.length > 0 && text.length <= MAX_TEXT_LENGTH ? text : null;
  }
  if (!isRecord(value)) return null;
  const en = typeof value.en === "string" ? value.en.trim() : "";
  if (en.length === 0 || en.length > MAX_TEXT_LENGTH) return null;
  const localized: { en: string; "zh-CN"?: string; "zh-TW"?: string } = { en };
  for (const locale of ["zh-CN", "zh-TW"] as const) {
    const text = value[locale];
    if (typeof text !== "string") continue;
    const trimmed = text.trim();
    if (trimmed.length > 0 && trimmed.length <= MAX_TEXT_LENGTH) localized[locale] = trimmed;
  }
  return localized;
}

function normalizeOption(value: unknown): SettingsFieldOption | null {
  if (!isRecord(value)) return null;
  const label = normalizeText(value.label);
  if (!label || typeof value.value !== "string") return null;
  if (value.value.length === 0 || value.value.length > MAX_TEXT_LENGTH) return null;
  return { value: value.value, label };
}

function normalizeField(value: unknown): SettingsField | null {
  if (!isRecord(value)) return null;
  const label = normalizeText(value.label);
  if (!label) return null;
  if (value.kind === "readonly") {
    const text = normalizeText(value.value);
    if (!text) return null;
    return { kind: "readonly", label, value: text, ...(value.mono === true ? { mono: true } : {}) };
  }
  const key = typeof value.key === "string" && FIELD_KEY_PATTERN.test(value.key) ? value.key : null;
  if (!key) return null;
  const placeholder = typeof value.placeholder === "string" && value.placeholder.length <= MAX_TEXT_LENGTH
    ? value.placeholder
    : undefined;
  if (value.kind === "text" || value.kind === "password") {
    return { kind: value.kind, key, label, ...(placeholder ? { placeholder } : {}) };
  }
  if (value.kind === "switch") return { kind: "switch", key, label };
  if (value.kind === "select") {
    const rawOptions = value.options;
    if (!Array.isArray(rawOptions) || rawOptions.length === 0 || rawOptions.length > MAX_FIELD_OPTIONS) return null;
    const options: SettingsFieldOption[] = [];
    for (const rawOption of rawOptions) {
      const option = normalizeOption(rawOption);
      if (!option) return null;
      options.push(option);
    }
    return { kind: "select", key, label, options };
  }
  return null;
}

/**
 * One descriptor, checked. The host's `register()` and the list both go through
 * this, so the panel only ever sees something it can draw.
 */
export function normalizeSettingsSection(value: unknown): SettingsSectionDescriptor | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  if (!SECTION_ID_PATTERN.test(id)) return null;
  if (SETTINGS_SECTION_VALUES.includes(id as (typeof SETTINGS_SECTION_VALUES)[number])) return null;
  const label = normalizeText(value.label);
  if (!label) return null;
  const rawFields = value.fields;
  if (!Array.isArray(rawFields) || rawFields.length === 0 || rawFields.length > MAX_SECTION_FIELDS) return null;
  const fields: SettingsField[] = [];
  for (const rawField of rawFields) {
    const field = normalizeField(rawField);
    if (!field) return null;
    fields.push(field);
  }
  const notes: LocalizedText[] = [];
  if (value.notes !== undefined) {
    if (!Array.isArray(value.notes) || value.notes.length > MAX_SECTION_NOTES) return null;
    for (const rawNote of value.notes) {
      const note = normalizeText(rawNote);
      if (!note) return null;
      notes.push(note);
    }
  }
  let applyLabel: LocalizedText | undefined;
  if (value.applyLabel !== undefined) {
    const normalized = normalizeText(value.applyLabel);
    if (!normalized) return null;
    applyLabel = normalized;
  }
  const icon = SETTINGS_SECTION_ICON_NAMES.includes(value.icon as SettingsSectionIconName)
    ? value.icon as SettingsSectionIconName
    : undefined;
  return {
    id,
    label,
    ...(icon ? { icon } : {}),
    fields,
    ...(applyLabel ? { applyLabel } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}

/**
 * Keeps the descriptors this build can render and drops the rest, keeping the
 * first of a repeated id. The server already refuses bad ones at `register()`;
 * this also guards a route answer that crossed a process boundary.
 */
export function normalizeSettingsSections(raw: unknown): readonly SettingsSectionDescriptor[] {
  if (!Array.isArray(raw)) return EMPTY;
  const sections: SettingsSectionDescriptor[] = [];
  const ids = new Set<string>();
  for (const entry of raw) {
    if (sections.length >= MAX_SETTINGS_SECTIONS) break;
    const section = normalizeSettingsSection(entry);
    if (!section || ids.has(section.id)) continue;
    ids.add(section.id);
    sections.push(section);
  }
  return sections.length > 0 ? sections : EMPTY;
}

/** The status line an extension returned, or null when it is not one to show. */
export function normalizeSettingsStatus(value: unknown): SettingsSectionStatus | null {
  if (!isRecord(value)) return null;
  if (!SETTINGS_STATUS_STATES.includes(value.state as SettingsStatusState)) return null;
  const text = normalizeText(value.text);
  return text ? { state: value.state as SettingsStatusState, text } : null;
}

/** The form's starting values: declared fields only, switches never truthy by accident. */
export function initialFieldValues(
  descriptor: SettingsSectionDescriptor,
  raw?: Record<string, unknown>,
): Record<string, SettingsFieldValue> {
  const values: Record<string, SettingsFieldValue> = {};
  for (const field of descriptor.fields) {
    if (field.kind === "readonly") continue;
    const given = raw?.[field.key];
    if (field.kind === "switch") {
      values[field.key] = given === true;
    } else {
      values[field.key] = typeof given === "string" ? given.slice(0, MAX_VALUE_LENGTH) : "";
    }
  }
  return values;
}

/** What a rejected read or apply shows: its own message, else the caller's fallback. */
export function describeSettingsError(cause: unknown, fallback: string): string {
  const message = cause instanceof Error
    ? cause.message
    : typeof cause === "string" ? cause : "";
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed.slice(0, MAX_MESSAGE_LENGTH) : fallback;
}
