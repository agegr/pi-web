/** Web-only, declarative skins. Deliberately not the pi CLI's theme format. */
export const WEB_SKIN_TOKENS = [
  "bg", "bg-panel", "bg-hover", "bg-selected", "border", "text",
  "text-muted", "text-dim", "accent", "accent-hover", "accent-contrast",
  "user-bg", "assistant-bg", "tool-bg", "bg-subtle",
] as const;
export type WebSkinPalette = Record<(typeof WEB_SKIN_TOKENS)[number], string>;
export interface WebSkinManifest {
  version: 1;
  name: string;
  light: WebSkinPalette;
  dark: WebSkinPalette;
  background?: { file: string; opacity: number };
}
export interface WebSkin extends WebSkinManifest { id: string }
export const WEB_SKIN_STORAGE_KEY = "pi-web:external-skin";
export function isWebSkinId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function palette(value: unknown): WebSkinPalette | null {
  if (!object(value) || Object.keys(value).length !== WEB_SKIN_TOKENS.length) return null;
  const out: Partial<WebSkinPalette> = {};
  for (const token of WEB_SKIN_TOKENS) {
    const color = value[token];
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return null;
    out[token] = color.toLowerCase();
  }
  return out as WebSkinPalette;
}
/** A new object is built from allowed fields; never spread untrusted JSON into styles. */
export function parseWebSkinManifest(value: unknown): WebSkinManifest | null {
  if (!object(value) || value.version !== 1 || typeof value.name !== "string") return null;
  if (Object.keys(value).some((key) => !["version", "name", "light", "dark", "background"].includes(key))) return null;
  const name = value.name.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name)) return null;
  const light = palette(value.light), dark = palette(value.dark);
  if (!light || !dark) return null;
  const out: WebSkinManifest = { version: 1, name, light, dark };
  if (value.background !== undefined) {
    const bg = value.background;
    if (!object(bg) || Object.keys(bg).some((key) => !["file", "opacity"].includes(key))) return null;
    if (typeof bg.file !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}\.png$/i.test(bg.file)) return null;
    if (typeof bg.opacity !== "number" || !Number.isFinite(bg.opacity) || bg.opacity < 0 || bg.opacity > 0.25) return null;
    out.background = { file: bg.file, opacity: bg.opacity };
  }
  return out;
}
/** No user-supplied URL or CSS syntax reaches the DOM. */
export function webSkinStyles(skin: WebSkin, dark: boolean): Record<string, string> {
  const styles: Record<string, string> = {};
  for (const [token, color] of Object.entries(dark ? skin.dark : skin.light)) styles[`--${token}`] = color;
  if (skin.background) {
    styles["--web-skin-image"] = `url("/api/web-skins/${encodeURIComponent(skin.id)}/background")`;
    styles["--web-skin-wash"] = `${(1 - skin.background.opacity) * 100}%`;
  }
  return styles;
}
