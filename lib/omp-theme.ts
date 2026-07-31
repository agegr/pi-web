import {
  getAvailableThemes,
  getResolvedThemeColors,
  getThemeExportColors,
  isLightTheme,
} from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { Settings } from "@oh-my-pi/pi-coding-agent";
import type { WebThemeConfig, WebThemePalette } from "@/lib/settings-api";

function firstColor(...values: Array<string | undefined>): string {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? "transparent";
}

type Rgb = [red: number, green: number, blue: number];

function parseHex(value: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return null;
  const hex = match[1];
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

function mixHex(from: string, to: string, amount: number): string {
  const fromRgb = parseHex(from);
  const toRgb = parseHex(to);
  if (!fromRgb || !toRgb) return from;
  const mixed = fromRgb.map((channel, index) => Math.round(channel + (toRgb[index] - channel) * amount));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(value: string): number | null {
  const rgb = parseHex(value);
  if (!rgb) return null;
  const [red, green, blue] = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number | null {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) return null;
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function ensureContrast(color: string, target: string, backgrounds: string[], minimum: number): string {
  const hasContrast = (candidate: string) => backgrounds.every((background) => {
    const ratio = contrastRatio(candidate, background);
    return ratio === null || ratio >= minimum;
  });
  if (hasContrast(color)) return color;
  if (!hasContrast(target)) return target;

  let low = 0;
  let high = 1;
  for (let index = 0; index < 12; index += 1) {
    const midpoint = (low + high) / 2;
    if (hasContrast(mixHex(color, target, midpoint))) high = midpoint;
    else low = midpoint;
  }
  return mixHex(color, target, high);
}

export async function getWebThemePalette(name: string): Promise<WebThemePalette> {
  const [colors, exported] = await Promise.all([
    getResolvedThemeColors(name),
    getThemeExportColors(name),
  ]);
  const colorScheme = isLightTheme(name) ? "light" : "dark";
  const pageBg = firstColor(exported.pageBg, colors.userMessageBg, colorScheme === "light" ? "#ffffff" : "#111318");
  const panelBg = firstColor(exported.cardBg, colors.statusLineBg, colors.toolPendingBg, pageBg);
  const hoverBg = firstColor(colors.borderMuted, colors.border, panelBg);
  const selectedBg = firstColor(colors.selectedBg, colors.borderAccent, hoverBg);
  const text = firstColor(colors.text, colorScheme === "light" ? "#17191d" : "#e5e7eb");
  const rawMuted = firstColor(colors.muted, text);
  const rawDim = firstColor(colors.dim, rawMuted);
  const muted = ensureContrast(rawMuted, text, [pageBg, panelBg], 6);
  const dim = ensureContrast(rawDim, text, [pageBg, panelBg], 5);
  const accent = firstColor(colors.accent, colors.borderAccent, text);

  return {
    name,
    colorScheme,
    variables: {
      "--bg": pageBg,
      "--bg-panel": panelBg,
      "--bg-hover": hoverBg,
      "--bg-selected": selectedBg,
      "--border": firstColor(colors.borderMuted, colors.border, hoverBg),
      "--text": text,
      "--text-muted": muted,
      "--text-dim": dim,
      "--accent": accent,
      "--accent-hover": mixHex(accent, text, 0.16),
      "--user-bg": firstColor(colors.userMessageBg, panelBg),
      "--assistant-bg": pageBg,
      "--tool-bg": firstColor(colors.toolPendingBg, panelBg),
      "--bg-subtle": firstColor(exported.infoBg, colors.customMessageBg, hoverBg),
      "--success": firstColor(colors.success, colors.toolDiffAdded, accent),
      "--danger": firstColor(colors.error, colors.toolDiffRemoved, "#dc2626"),
      "--warning": firstColor(colors.warning, "#d97706"),
      "--omp-md-heading": firstColor(colors.mdHeading, accent),
      "--omp-md-link": firstColor(colors.mdLink, accent),
      "--omp-md-code": firstColor(colors.mdCode, colors.syntaxString, accent),
    },
  };
}

export async function getWebThemeConfig(settings: Settings): Promise<WebThemeConfig> {
  const dark = settings.get("theme.dark") ?? "titanium";
  const light = settings.get("theme.light") ?? "light";
  const [darkPalette, lightPalette] = await Promise.all([
    getWebThemePalette(dark),
    getWebThemePalette(light),
  ]);
  return {
    names: { dark, light },
    palettes: { dark: darkPalette, light: lightPalette },
  };
}

export async function getAvailableWebThemes(): Promise<Array<{ name: string; colorScheme: "dark" | "light" }>> {
  const names = await getAvailableThemes();
  return names.map((name) => ({ name, colorScheme: isLightTheme(name) ? "light" : "dark" }));
}
