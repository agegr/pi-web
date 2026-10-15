// Settings shows these as swatches: System, the light row, the dark row, then a row of three:
// the high-contrast pair and Zenburn.
// The rows line up by hue: each light theme sits above its dark counterpart; Rose and Slate have none.
export const THEME_OPTIONS = [
  { id: "auto", label: "settings.themeSystem", scheme: null },
  { id: "light", label: "settings.themeLight", scheme: "light" },
  { id: "mist", label: "settings.themeMist", scheme: "light" },
  { id: "lilac", label: "settings.themeLilac", scheme: "light" },
  { id: "sand", label: "settings.themeSand", scheme: "light" },
  { id: "rose", label: "settings.themeRose", scheme: "light" },
  { id: "dark", label: "settings.themeDark", scheme: "dark" },
  { id: "pine", label: "settings.themePine", scheme: "dark" },
  { id: "dusk", label: "settings.themeDusk", scheme: "dark" },
  { id: "ember", label: "settings.themeEmber", scheme: "dark" },
  { id: "slate", label: "settings.themeSlate", scheme: "dark" },
  { id: "contrast-light", label: "settings.themeContrastLight", scheme: "light" },
  { id: "contrast-dark", label: "settings.themeContrastDark", scheme: "dark" },
  { id: "zenburn", label: "settings.themeZenburn", scheme: "dark" },
  { id: "github-light", label: "settings.themeGitHubLight", scheme: "light" },
  { id: "github-dark", label: "settings.themeGitHubDark", scheme: "dark" },
  { id: "one-half-light", label: "settings.themeOneHalfLight", scheme: "light" },
  { id: "one-half-dark", label: "settings.themeOneHalfDark", scheme: "dark" },
] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number]["id"];
export type ResolvedTheme = Exclude<ThemePreference, "auto">;

export const LIGHT_THEMES: readonly ResolvedTheme[] = THEME_OPTIONS.flatMap((option) => (option.scheme === "light" ? [option.id] : []));
export const DARK_THEMES: readonly ResolvedTheme[] = THEME_OPTIONS.flatMap((option) => (option.scheme === "dark" ? [option.id] : []));

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option.id === value);
}

export function isDarkTheme(theme: ResolvedTheme): boolean {
  return DARK_THEMES.includes(theme);
}

// Apply the saved palette before first paint, including when storage is blocked.
export const THEME_INIT_SCRIPT = `(function(){var t="auto";try{var s=localStorage.getItem("pi-theme");if(${JSON.stringify(THEME_OPTIONS.map((option) => option.id))}.includes(s))t=s}catch(e){}if(t==="auto")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=document.documentElement;r.dataset.theme=t;r.classList.toggle("dark",${JSON.stringify(DARK_THEMES)}.includes(t))})();`;
