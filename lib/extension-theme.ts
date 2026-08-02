import { Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";

// `ThemeBg` is the only Theme-color type the public entry point does
// not re-export. It's a 6-string union; mirror it locally so we don't
// reach into pi-coding-agent's internal module path.
type ThemeBg =
  | "selectedBg"
  | "userMessageBg"
  | "customMessageBg"
  | "toolPendingBg"
  | "toolSuccessBg"
  | "toolErrorBg";

/**
 * Extensions written for pi's TUI call methods like `theme.bold(text)`,
 * `theme.fg("accent", text)`, etc. when implementing custom UIs via
 * `ctx.ui.custom((tui, theme, …) => …)`. pi-web has no terminal concept,
 * but the extension factory still receives `theme` and stores it on its
 * component, then crashes inside `render(width)` if `theme` is undefined
 * — surfacing as
 *   "Extension custom UI render failed: Cannot read properties of
 *    undefined (reading 'bold')".
 *
 * Provide a real Theme instance so those code paths work. The theme
 * colors mirror pi's bundled `dark.json` so the resulting ANSI escapes
 * are reasonable and pi-web's ansi renderer can style them.
 */
export function createDefaultExtensionTheme(): Theme {
  const fg = buildFgColors();
  const bg = buildBgColors();
  return new Theme(fg, bg, "truecolor", { name: "pi-web-default" });
}

// --- color tables (kept in sync with pi's dark.json; only what's needed
// for extension render to not throw). Values can be ANSI 256 indices or
// hex/truecolor strings — Theme normalizes them via chalk. ----

function buildFgColors(): Record<ThemeColor, string | number> {
  return {
    accent: "#8abeb7",
    border: "#5f87ff",
    borderAccent: "#00d7ff",
    borderMuted: "#505050",
    success: "#b5bd68",
    error: "#cc6666",
    warning: "#ffff00",
    muted: "#808080",
    dim: "#666666",
    text: "#d4d4d4",
    thinkingText: "#808080",
    userMessageText: "#d4d4d4",
    customMessageText: "#d4d4d4",
    customMessageLabel: "#9575cd",
    toolTitle: "#d4d4d4",
    toolOutput: "#808080",
    mdHeading: "#f0c674",
    mdLink: "#81a2be",
    mdLinkUrl: "#666666",
    mdCode: "#8abeb7",
    mdCodeBlock: "#b5bd68",
    mdCodeBlockBorder: "#808080",
    mdQuote: "#808080",
    mdQuoteBorder: "#808080",
    mdHr: "#808080",
    mdListBullet: "#8abeb7",
    toolDiffAdded: "#b5bd68",
    toolDiffRemoved: "#cc6666",
    toolDiffContext: "#808080",
    syntaxComment: "#6A9955",
    syntaxKeyword: "#569CD6",
    syntaxFunction: "#DCDCAA",
    syntaxVariable: "#9CDCFE",
    syntaxString: "#CE9178",
    syntaxNumber: "#B5CEA8",
    syntaxType: "#4EC9B0",
    syntaxOperator: "#D4D4D4",
    syntaxPunctuation: "#D4D4D4",
    thinkingOff: "#505050",
    thinkingMinimal: "#6e6e6e",
    thinkingLow: "#5f87af",
    thinkingMedium: "#81a2be",
    thinkingHigh: "#b294bb",
    thinkingXhigh: "#d183e8",
    thinkingMax: "#e0a3f0",
    bashMode: "#b5bd68",
  };
}

function buildBgColors(): Record<ThemeBg, string | number> {
  return {
    selectedBg: "#3a3a4a",
    userMessageBg: "#343541",
    customMessageBg: "#2d2838",
    toolPendingBg: "#282832",
    toolSuccessBg: "#283228",
    toolErrorBg: "#3c2828",
  };
}
