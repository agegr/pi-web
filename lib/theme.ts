/**
 * Theme system for pi-web.
 *
 * Loads pi CLI theme JSON files (from ~/.pi/agent/themes/, .pi/themes/, etc.),
 * resolves `vars` references, and maps the 51 pi CLI color tokens to pi-web's
 * ~23 CSS custom properties.
 *
 * Themes are organized as **sets** — each set pairs a dark and a light variant
 * (e.g. "gruvbox" → gruvbox-dark.json + gruvbox-light.json). A set may also
 * contain only one variant (single-file theme).
 *
 * pi CLI theme format:
 *   { name, vars: { key: hex|number, ... }, colors: { token: hex|number|varRef|"", ... } }
 *
 * Color values can be:
 *   - Hex string: "#ff0000"
 *   - 256-color index: 242
 *   - Variable reference: "primary" (resolved from vars)
 *   - Empty string "": terminal default (we derive from palette)
 */

import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, basename, extname } from "path";
import { homedir } from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PiTheme {
  name: string;
  vars?: Record<string, string | number>;
  colors: Record<string, string | number>;
}

/** Represents a paired theme set (e.g. "gruvbox" with dark + light variants). */
export interface ThemeSetInfo {
  /** Base name (e.g. "gruvbox") — used as the stable identifier. */
  name: string;
  /** Human-readable display name. */
  displayName: string;
  /** Whether this set has a dark variant. */
  hasDark: boolean;
  /** Whether this set has a light variant. */
  hasLight: boolean;
}

/** A resolved, ready-to-use theme (one variant of a set). */
export interface ResolvedTheme {
  /** Base theme-set name. */
  name: string;
  /** Whether this specific variant is dark. */
  isDark: boolean;
  /** CSS variable name → hex value (e.g. "--bg" → "#282828") */
  cssVars: Record<string, string>;
}

export type ThemeVariant = "dark" | "light";

// ─── 256-color palette → hex ────────────────────────────────────────────────

// Standard xterm 256-color palette. 0-15: ANSI, 16-231: 6x6x6 cube, 232-255: grayscale.
function ansiToHex(code: number): string {
  // 0-15: basic ANSI colors
  const ansi: Record<number, string> = {
    0: "#000000", 1: "#800000", 2: "#008000", 3: "#808000",
    4: "#000080", 5: "#800080", 6: "#008080", 7: "#c0c0c0",
    8: "#808080", 9: "#ff0000", 10: "#00ff00", 11: "#ffff00",
    12: "#0000ff", 13: "#ff00ff", 14: "#00ffff", 15: "#ffffff",
  };
  if (code in ansi) return ansi[code];

  // 16-231: 6×6×6 RGB cube
  if (code >= 16 && code <= 231) {
    const n = code - 16;
    const r = Math.round((Math.floor(n / 36) % 6) * (255 / 5));
    const g = Math.round((Math.floor(n / 6) % 6) * (255 / 5));
    const b = Math.round((n % 6) * (255 / 5));
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  // 232-255: grayscale ramp
  if (code >= 232 && code <= 255) {
    const v = Math.round(((code - 232) / 23) * 255);
    const h = v.toString(16).padStart(2, "0");
    return `#${h}${h}${h}`;
  }

  return "#000000";
}

// ─── Color resolution ───────────────────────────────────────────────────────

/**
 * Resolve a single color value to a hex string.
 * - Hex string: returned as-is (lowercased)
 * - Number: treated as 256-color index, converted to hex
 * - String matching a var name: resolved from vars
 * - Empty string: returns empty (caller should substitute default)
 */
function resolveColor(
  value: string | number | undefined,
  vars: Record<string, string>,
): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return ansiToHex(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return "";
    if (trimmed.startsWith("#")) return trimmed.toLowerCase();
    // Variable reference
    if (vars[trimmed]) return vars[trimmed].toLowerCase();
    // Could be a raw number-as-string: "242"
    const num = Number(trimmed);
    if (!isNaN(num) && trimmed === String(num)) return ansiToHex(num);
    // Unknown reference — return as-is (may be valid hex without #)
    if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
    return trimmed.toLowerCase();
  }
  return "";
}

/** Resolve all `vars` entries to hex strings. */
function resolveVars(vars: Record<string, string | number> | undefined): Record<string, string> {
  const resolved: Record<string, string> = {};
  if (!vars) return resolved;
  for (const [key, value] of Object.entries(vars)) {
    resolved[key] = resolveColor(value, {});
  }
  return resolved;
}

/** Resolve all `colors` entries, expanding var references. */
function resolveColors(
  colors: Record<string, string | number>,
  vars: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    resolved[key] = resolveColor(value, vars);
  }
  return resolved;
}

// ─── Color manipulation helpers ─────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Lighten a hex color by mixing with white. factor 0 = no change, 1 = white. */
function lighten(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return rgbToHex(
    Math.round(r + (255 - r) * factor),
    Math.round(g + (255 - g) * factor),
    Math.round(b + (255 - b) * factor),
  );
}

/** Darken a hex color by mixing with black. factor 0 = no change, 1 = black. */
function darken(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return rgbToHex(
    Math.round(r * (1 - factor)),
    Math.round(g * (1 - factor)),
    Math.round(b * (1 - factor)),
  );
}

/** Mix two hex colors. factor 0 = all a, factor 1 = all b. */
function mix(a: string, b: string, factor: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  return rgbToHex(
    Math.round(ra[0] + (rb[0] - ra[0]) * factor),
    Math.round(ra[1] + (rb[1] - ra[1]) * factor),
    Math.round(ra[2] + (rb[2] - ra[2]) * factor),
  );
}

/** Calculate relative luminance (0-1). Used to determine dark vs light. */
function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [rs, gs, bs] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLum = relativeLuminance(foreground);
  const backgroundLum = relativeLuminance(background);
  return (Math.max(foregroundLum, backgroundLum) + 0.05) / (Math.min(foregroundLum, backgroundLum) + 0.05);
}

/**
 * Preserve a theme status color's hue while making a modest contrast adjustment.
 * Git status has redundant text, dot, and capsule-background signals, so 3:1
 * keeps green and yellow distinguishable in light themes better than forcing
 * every status color to normal-text 4.5:1 contrast.
 */
function ensureContrast(color: string, background: string, minimum = 3): string {
  if (!hexToRgb(color) || !hexToRgb(background) || contrastRatio(color, background) >= minimum) {
    return color;
  }

  const darkenForContrast = relativeLuminance(background) > relativeLuminance(color);
  for (let step = 1; step <= 20; step += 1) {
    const candidate = darkenForContrast
      ? darken(color, step * 0.05)
      : lighten(color, step * 0.05);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return darkenForContrast ? "#000000" : "#ffffff";
}

// ─── pi CLI token → CSS variable mapping ────────────────────────────────────

/**
 * Maps resolved pi CLI theme colors + vars to pi-web CSS custom properties.
 */
function mapToCssVars(
  colors: Record<string, string>,
  vars: Record<string, string>,
): Record<string, string> {
  // ── Extract base palette from vars ──
  const bg0 = vars.bg0 || "#1a1a1a";
  const bg1 = vars.bg1 || "#242424";
  const bg2 = vars.bg2 || "#2e2e2e";
  const bg3 = vars.bg3 || "#383838";
  const fg0 = vars.fg0 || "#e8e8e8";
  const fg3 = vars.fg3 || "#888888";
  const fg4 = vars.fg4 || "#555555";

  // Semantic palette colors
  const red = vars.red || "#dc2626";
  const green = vars.green || "#16a34a";
  const orange = vars.orange || "#d97706";

  // ── Resolve key pi CLI tokens ──
  const accent = colors.accent || orange;
  const text = colors.text || fg0;
  const muted = colors.muted || fg3;
  const dim = colors.dim || fg4;
  const border = colors.border || bg3;
  const success = colors.success || green;
  const error = colors.error || red;
  const warning = colors.warning || orange;
  const toolSuccessBg = colors.toolSuccessBg || bg1;

  // Determine if dark theme
  const isDark = relativeLuminance(bg0) < 0.5;

  // ── Web 适配：强调色 / 边框对比度保障 ──
  // 静止态 accent（链接/图标/按钮）与语法高亮共用 --accent-*，全部过
  // ensureContrast（≥4.5:1），保留色相只调深浅；边框分隔线 ≥3:1。
  const accentSafe = ensureContrast(accent, bg0, 4.5);
  const borderSafe = ensureContrast(border, bg0, 3.0);

  // ── Build CSS variables ──
  const css: Record<string, string> = {};

  // Core backgrounds
  css["--bg"] = bg0;
  css["--bg-panel"] = bg1;
  css["--bg-hover"] = bg2;
  // 选中态：bg2 微染 accent 色相（低浓度），与 hover 区分且带主题气质
  css["--bg-selected"] = mix(bg2, accentSafe, 0.06);
  // 侧边栏专用表面色：向 bg3 加深半档，避免与主区"融为一片"
  // （实测 bg2 与主背景仅 1.3:1，人眼难辨，需 ~1.7:1+）
  css["--bg-sidebar"] = mix(bg2, bg3, 0.5);
  css["--bg-subtle"] = isDark
    ? `rgba(255,255,255,0.035)`
    : `rgba(15,23,42,0.035)`;

  // Borders
  css["--border"] = borderSafe;

  // Text — web 可读性保障：主题色对比度不足时向正确方向微调，
  // 正文/次级 ≥ 4.5:1、弱化层 ≥ 3:1，且层级严格递减（dim < muted < text）。
  // 终端主题（如 solarized）的低对比哲学在小字号 UI 上不适用，这里做适配。
  css["--text"] = ensureContrast(text, bg0, 4.5);
  css["--text-muted"] = ensureContrast(muted, bg0, 4.5);
  css["--text-dim"] = ensureContrast(dim, bg0, 3.0);

  // Accent — 静止态与语法高亮共用，全部保障 ≥4.5:1
  css["--accent"] = accentSafe;
  css["--accent-hover"] = isDark ? lighten(accentSafe, 0.2) : darken(accentSafe, 0.15);
  css["--accent-blue"] = ensureContrast(vars.blue || accent, bg0, 4.5);

  // Semantic colors
  css["--accent-red"] = ensureContrast(error, bg0, 4.5);
  css["--accent-green"] = ensureContrast(success, bg0, 4.5);
  css["--accent-orange"] = ensureContrast(warning, bg0, 4.5);

  // Message bubbles — 用户气泡向 bg3 加深半档（~1.3:1），配 accent 描边，
  // 与面板拉开可辨层级，消息归属清晰
  css["--user-bg"] = mix(bg2, bg3, 0.5);
  css["--assistant-bg"] = bg0;
  css["--tool-bg"] = toolSuccessBg;

  // Kabochar 特有：输入框聚焦背景（.chat-composer:focus-within）。
  // light 从主背景向白派生（聚焦更亮），dark 从面板提亮。
  css["--composer-focus-bg"] = isDark
    ? lighten(bg1, 0.08)
    : mix(bg0, "#ffffff", 0.35);

  return css;
}

// ─── Theme loading ──────────────────────────────────────────────────────────

/** All required pi CLI color tokens (51 tokens). */
const ALL_COLOR_TOKENS = [
  "accent", "border", "borderAccent", "borderMuted",
  "success", "error", "warning", "muted", "dim", "text", "thinkingText",
  "selectedBg", "userMessageBg", "userMessageText",
  "customMessageBg", "customMessageText", "customMessageLabel",
  "toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput",
  "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock",
  "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext",
  "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable",
  "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium",
  "thinkingHigh", "thinkingXhigh", "thinkingMax",
  "bashMode",
];

/**
 * Parse a pi CLI theme JSON file.
 * Validates required fields and fills in missing color tokens with empty strings.
 */
function parseThemeFile(path: string): PiTheme | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const json = JSON.parse(raw);

    if (!json.name || typeof json.name !== "string") return null;
    if (!json.colors || typeof json.colors !== "object") return null;

    // Fill missing tokens with empty strings
    const colors: Record<string, string | number> = {};
    for (const token of ALL_COLOR_TOKENS) {
      colors[token] = json.colors[token] ?? "";
    }

    return {
      name: json.name,
      vars: json.vars,
      colors,
    };
  } catch {
    return null;
  }
}

// ─── File-name convention helpers ───────────────────────────────────────────

/**
 * Detect the base name and variant from a theme filename.
 *
 * Convention:
 *   gruvbox-dark.json  → { base: "gruvbox", variant: "dark" }
 *   gruvbox-light.json → { base: "gruvbox", variant: "light" }
 *   monokai.json       → { base: "monokai", variant: null }
 */
function parseThemeFilename(
  filename: string,
): { base: string; variant: ThemeVariant | null } {
  const stem = basename(filename, extname(filename));

  // Try "-dark" / "-light" suffix (case-insensitive)
  const darkMatch = /^(.+)-dark$/i.exec(stem);
  if (darkMatch) return { base: darkMatch[1], variant: "dark" };

  const lightMatch = /^(.+)-light$/i.exec(stem);
  if (lightMatch) return { base: lightMatch[1], variant: "light" };

  // Single-file theme — variant determined from content later
  return { base: stem, variant: null };
}

/**
 * Scan a directory for pi CLI theme JSON files.
 * Returns an array of { path, base, variant, isDark } records.
 */
interface ScannedFile {
  path: string;
  base: string;
  variant: ThemeVariant | null;
  isDark: boolean;
}

function scanThemeDir(dir: string): ScannedFile[] {
  const results: ScannedFile[] = [];
  try {
    if (!existsSync(dir)) return results;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (extname(entry) !== ".json") continue;
      const fullPath = join(dir, entry);
      try {
        if (!statSync(fullPath).isFile()) continue;
      } catch {
        continue;
      }
      const parsed = parseThemeFilename(entry);
      // Determine actual polarity from file content
      const theme = parseThemeFile(fullPath);
      if (!theme) continue;
      const vars = resolveVars(theme.vars);
      const bg0 = vars.bg0 || "#1a1a1a";
      const isDark = relativeLuminance(bg0) < 0.5;
      // If variant wasn't detected from filename, infer from content
      const variant = parsed.variant ?? (isDark ? "dark" : "light");

      results.push({ path: fullPath, base: parsed.base, variant, isDark });
    }
  } catch {
    // Permission errors, etc.
  }
  return results;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** List all available theme sets from the global theme directory. */
export function listThemeSets(): ThemeSetInfo[] {
  const result: ThemeSetInfo[] = [];
  const seen = new Set<string>();

  // Collect all scanned files
  const allFiles: ScannedFile[] = [];

  // Global themes: ~/.pi/agent/themes/
  const globalDir = join(homedir(), ".pi", "agent", "themes");
  allFiles.push(...scanThemeDir(globalDir));

  // Group by base name
  const groups = new Map<string, ScannedFile[]>();
  for (const f of allFiles) {
    const list = groups.get(f.base) || [];
    list.push(f);
    groups.set(f.base, list);
  }

  // Build ThemeSetInfo for each group
  for (const [base, files] of groups) {
    if (seen.has(base)) continue;
    seen.add(base);

    let hasDark = false;
    let hasLight = false;
    for (const f of files) {
      if (f.variant === "dark") hasDark = true;
      if (f.variant === "light") hasLight = true;
    }

    result.push({
      name: base,
      displayName: themeNameToDisplay(base),
      hasDark,
      hasLight,
    });
  }

  return result;
}

/** Convert a kebab-case theme name to a display-friendly title. */
function themeNameToDisplay(name: string): string {
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Resolve a specific variant of a theme set.
 *
 * Lookup order:
 *   1. `{base}-{variant}.json` (e.g. `gruvbox-dark.json`)
 *   2. `{base}.json` (single-file fallback)
 *   3. The opposite variant (if only one variant exists and user requests the other)
 *
 * @param name  Base theme-set name (e.g. "gruvbox").
 * @param variant  Which variant to load ("dark" or "light").
 */
export function resolveTheme(
  name: string,
  variant: ThemeVariant,
): ResolvedTheme | null {
  if (!name) return null;

  // Global themes: ~/.pi/agent/themes/
  const dirs: string[] = [
    join(homedir(), ".pi", "agent", "themes"),
  ];

  // Candidate filenames in priority order
  const candidates = [
    `${name}-${variant}.json`,  // e.g. gruvbox-dark.json
    `${name}.json`,             // e.g. monokai.json (single-file)
    `${name}-${variant === "dark" ? "light" : "dark"}.json`, // opposite variant fallback
  ];

  for (const dir of dirs) {
    for (const candidate of candidates) {
      const fullPath = join(dir, candidate);
      if (!existsSync(fullPath)) continue;
      const theme = parseThemeFile(fullPath);
      if (!theme) continue;

      const vars = resolveVars(theme.vars);
      const colors = resolveColors(theme.colors, vars);
      const cssVars = mapToCssVars(colors, vars);
      const bg0 = vars.bg0 || "#1a1a1a";

      return {
        name, // Use the base name, not the file's internal name
        isDark: relativeLuminance(bg0) < 0.5,
        cssVars,
      };
    }
  }

  return null;
}
