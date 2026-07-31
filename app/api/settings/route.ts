import { NextResponse } from "next/server";
import {
  getDefault,
  getEnumValues,
  getPathsForTab,
  getType,
  getUi,
  hasUi,
  isCredential,
  SETTINGS_SCHEMA,
  SETTING_TABS,
  TAB_GROUPS,
  TAB_METADATA,
  type SettingPath,
} from "@oh-my-pi/pi-coding-agent/config/settings-schema";
import { getOmpRuntime, getSettingsForCwd } from "@/lib/omp-runtime";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { getAvailableWebThemes, getWebThemeConfig } from "@/lib/omp-theme";
import type {
  SettingsField,
  SettingsFieldType,
  SettingsOption,
  SettingsResponse,
  SettingsValue,
} from "@/lib/settings-api";

export const dynamic = "force-dynamic";

async function validateCwd(cwd: string | null): Promise<string | undefined> {
  if (!cwd) return undefined;
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) throw new Error("Access denied");
  return cwd;
}

function optionsFor(path: SettingPath, runtimeThemes: string[]): SettingsOption[] | undefined {
  const ui = getUi(path);
  if (!ui) return undefined;
  if (ui.options === "runtime") {
    return path === "theme.dark" || path === "theme.light"
      ? runtimeThemes.map((value) => ({ value, label: value }))
      : [];
  }
  if (Array.isArray(ui.options)) return ui.options.map((option) => ({ ...option }));
  const values = getEnumValues(path);
  return values?.map((value) => ({ value, label: value }));
}

function fieldTypeFor(path: SettingPath): SettingsFieldType | null {
  const schemaType = getType(path);
  const ui = getUi(path);
  if (!ui) return null;
  if (schemaType === "boolean") return "boolean";
  if (schemaType === "enum") return "select";
  if (schemaType === "string") return isCredential(path) ? "secret" : ui.options ? "select" : "text";
  if (schemaType === "number") return ui.options ? "select" : null;
  if (schemaType === "array") return ui.options ? "multiselect" : null;
  if (schemaType === "record") return path === "providers.maxInFlightRequests" ? "providerLimits" : "text";
  return null;
}

function serializableValue(value: unknown): SettingsValue {
  if (value === undefined) return null;
  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "string"
    || typeof value === "number"
    || Array.isArray(value)
  ) return value as SettingsValue;
  return value as Record<string, number>;
}

function validateSettingValue(path: SettingPath, value: unknown): SettingsValue {
  const schemaType = getType(path);
  const ui = getUi(path);
  if (!ui) throw new Error("Setting is not exposed by /settings");

  if (schemaType === "boolean") {
    if (typeof value !== "boolean") throw new Error("Expected a boolean");
    return value;
  }
  if (schemaType === "string") {
    if (typeof value !== "string") throw new Error("Expected text");
    const allowed = optionsFor(path, []);
    if (ui.options !== "runtime" && allowed?.length && !allowed.some((option) => option.value === value)) {
      throw new Error("Invalid option");
    }
    return value;
  }
  if (schemaType === "enum") {
    if (typeof value !== "string" || !getEnumValues(path)?.includes(value)) throw new Error("Invalid option");
    return value;
  }
  if (schemaType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected a finite number");
    const allowed = Array.isArray(ui.options) ? ui.options.map((option) => Number(option.value)) : [];
    if (allowed.length && !allowed.includes(value)) throw new Error("Invalid option");
    return value;
  }
  if (schemaType === "array") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("Expected a string list");
    const allowed = Array.isArray(ui.options) ? new Set(ui.options.map((option) => option.value)) : null;
    if (!allowed || value.some((item) => !allowed.has(item))) throw new Error("Invalid list option");
    return [...new Set(value)] as string[];
  }
  if (schemaType === "record" && path === "providers.maxInFlightRequests") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected provider limits");
    const result: Record<string, number> = {};
    for (const [provider, limit] of Object.entries(value)) {
      if (!provider.trim() || typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
        throw new Error("Provider limits must be positive numbers");
      }
      result[provider.trim()] = Math.floor(limit);
    }
    return result;
  }
  throw new Error("Unsupported setting type");
}

export async function GET(req: Request) {
  try {
    const cwd = await validateCwd(new URL(req.url).searchParams.get("cwd"));
    const settings = await getSettingsForCwd(cwd);
    const [availableThemes, theme] = await Promise.all([
      getAvailableWebThemes(),
      getWebThemeConfig(settings),
    ]);
    const themeNames = availableThemes.map(({ name }) => name);
    const fields: SettingsField[] = [];

    for (const tab of SETTING_TABS) {
      for (const path of getPathsForTab(tab)) {
        const fieldType = fieldTypeFor(path);
        const ui = getUi(path);
        if (!fieldType || !ui) continue;
        const secret = isCredential(path);
        fields.push({
          path,
          tab,
          group: ui.group,
          label: ui.label,
          description: ui.description,
          type: fieldType,
          value: secret ? null : serializableValue(settings.get(path)),
          defaultValue: secret ? null : serializableValue(getDefault(path)),
          configured: settings.isConfigured(path),
          options: optionsFor(path, themeNames),
          ordered: ui.ordered === true,
          condition: ui.condition,
        });
      }
    }

    const response: SettingsResponse = {
      tabs: SETTING_TABS.map((id) => ({ id, label: TAB_METADATA[id].label, groups: [...TAB_GROUPS[id]] })),
      fields,
      availableThemes,
      theme,
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { path?: string; value?: unknown };
    if (!body.path || !(body.path in SETTINGS_SCHEMA) || !hasUi(body.path as SettingPath)) {
      return NextResponse.json({ error: "Unknown setting" }, { status: 400 });
    }
    const path = body.path as SettingPath;
    const value = validateSettingValue(path, body.value);
    if (
      (path === "theme.dark" || path === "theme.light")
      && (typeof value !== "string" || !(await getAvailableWebThemes()).some(({ name }) => name === value))
    ) {
      throw new Error("Unknown omp theme");
    }
    const { settings } = await getOmpRuntime();
    settings.set(path, value as never);
    await settings.flush();
    return NextResponse.json({ success: true, value: serializableValue(settings.get(path)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
