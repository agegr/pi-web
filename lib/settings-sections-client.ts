"use client";

/**
 * The four requests the dialog makes for a section a pi extension registered
 * (`docs/integrations.md`). One route answers all of them, and the extension's
 * own handlers do the work behind it.
 */

import { isRecord } from "./is-record";
import {
  normalizeSettingsSections,
  normalizeSettingsStatus,
  type SettingsSectionDescriptor,
  type SettingsSectionStatus,
} from "./settings-sections";

const SECTIONS_URL = "/api/settings/sections";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return isRecord(body) ? body : {};
}

/** The sections to list; empty until the extensions have loaded. */
export async function fetchSettingsSections(signal?: AbortSignal): Promise<readonly SettingsSectionDescriptor[]> {
  const body = await readJson(await fetch(SECTIONS_URL, { cache: "no-store", signal }));
  return body.ready === true ? normalizeSettingsSections(body.sections) : [];
}

/** One section's declared values and its status line. */
export async function readSettingsSection(
  id: string,
  signal?: AbortSignal,
): Promise<{ values: Record<string, unknown>; status: SettingsSectionStatus | null }> {
  const body = await readJson(await fetch(`${SECTIONS_URL}?id=${encodeURIComponent(id)}`, { cache: "no-store", signal }));
  return {
    values: isRecord(body.values) ? body.values : {},
    status: normalizeSettingsStatus(body.status),
  };
}

/** The status line alone, for the poll a mounted section runs. */
export async function readSettingsSectionStatus(
  id: string,
  signal?: AbortSignal,
): Promise<SettingsSectionStatus | null> {
  const body = await readJson(await fetch(`${SECTIONS_URL}?status=${encodeURIComponent(id)}`, { cache: "no-store", signal }));
  return normalizeSettingsStatus(body.status);
}

/** Applies the form's values; a rejection carries the message the form shows. */
export async function applySettingsSection(id: string, values: Record<string, unknown>): Promise<void> {
  await readJson(await fetch(SECTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, values }),
  }));
}
