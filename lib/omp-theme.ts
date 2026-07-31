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
  const muted = firstColor(colors.muted, text);
  const dim = firstColor(colors.dim, muted);
  const accent = firstColor(colors.accent, colors.borderAccent, text);

  return {
    name,
    colorScheme,
    variables: {
      "--bg": pageBg,
      "--bg-panel": panelBg,
      "--bg-hover": hoverBg,
      "--bg-selected": selectedBg,
      "--border": firstColor(colors.border, colors.borderMuted, hoverBg),
      "--text": text,
      "--text-muted": muted,
      "--text-dim": dim,
      "--accent": accent,
      "--accent-hover": firstColor(colors.borderAccent, colors.mdLink, accent),
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
