import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getPackageDir, Theme } from "@earendil-works/pi-coding-agent";

// Extension components, widgets and statuses take a pi Theme; the page renders
// their lines through `AnsiText`. pi-web answers as a terminal that reports no
// colors, so pi's `system` theme gives what such a terminal gets: ANSI palette
// indices for the colored tokens, the default colors for text, and faint (SGR 2)
// for the dim tokens. The page draws that palette in its own light or dark scheme
// (`--ansi-*` in app/globals.css), so one rendering reads on every app theme.
// The generator is not exported; it is loaded from the SDK's file, and until it
// loads, or if an SDK upgrade moved it, extensions get plain text as before.

const SYSTEM_THEME_MODULE = "dist/modes/interactive/theme/system-theme.js";

type ThemeArgs = ConstructorParameters<typeof Theme>;

interface SystemThemeColors {
  colors: Record<string, string | number>;
  dim: string[];
  appearance: "dark" | "light" | undefined;
}

// chalk drops bold and the rest whenever the server's stdout is no TTY;
// a terminal gets them, so the page does too.
const sgr = (open: number, close: number) => (text: string) => `\x1b[${open}m${text}\x1b[${close}m`;
const bold = sgr(1, 22);
const italic = sgr(3, 23);
const underline = sgr(4, 24);
const inverse = sgr(7, 27);
const strikethrough = sgr(9, 29);

class PaletteTheme extends Theme {
  override bold(text: string): string { return bold(text); }
  override italic(text: string): string { return italic(text); }
  override underline(text: string): string { return underline(text); }
  override inverse(text: string): string { return inverse(text); }
  override strikethrough(text: string): string { return strikethrough(text); }
}

/** pi's `system` theme for a terminal that reported no colors. */
export function createPaletteTheme(generated: SystemThemeColors): Theme {
  const fg: Record<string, string | number> = {};
  const bg: Record<string, string | number> = {};
  for (const [token, value] of Object.entries(generated.colors)) {
    (token.endsWith("Bg") ? bg : fg)[token] = value;
  }
  return new PaletteTheme(fg as ThemeArgs[0], bg as ThemeArgs[1], "truecolor", {
    name: "system",
    appearance: generated.appearance,
    dim: generated.dim as NonNullable<ThemeArgs[3]>["dim"],
  });
}

// Extensions require a complete Theme; this one paints nothing.
class PlainTextTheme extends Theme {
  constructor() {
    super(
      { muted: "", text: "", thinkingXhigh: "", searchMatchText: "" } as ThemeArgs[0],
      { selectedBg: "" } as ThemeArgs[1],
      "truecolor",
    );
  }

  override fg(...[, text]: Parameters<Theme["fg"]>): string { return text; }
  override bg(...[, text]: Parameters<Theme["bg"]>): string { return text; }
  override bold(text: string): string { return text; }
  override italic(text: string): string { return text; }
  override underline(text: string): string { return text; }
  override inverse(text: string): string { return text; }
  override strikethrough(text: string): string { return text; }
  override getFgAnsi(): string { return ""; }
  override getBgAnsi(): string { return ""; }
  override getThinkingBorderColor(): (text: string) => string {
    return (text) => text;
  }
  override getBashModeBorderColor(): (text: string) => string { return (text) => text; }
}

export const PLAIN_TEXT_THEME: Theme = new PlainTextTheme();

declare global {
  var __piWebExtensionUiTheme: Theme | undefined;
}

/** The Theme extension UI is rendered with: the palette theme once loaded, plain text until then. */
export function extensionUiTheme(): Theme {
  return globalThis.__piWebExtensionUiTheme ?? PLAIN_TEXT_THEME;
}

async function loadPaletteTheme(): Promise<void> {
  try {
    const path = join(getPackageDir(), SYSTEM_THEME_MODULE);
    // Loaded from the SDK's own file at runtime, never bundled.
    const loaded = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(path).href) as {
      generateSystemThemeColors?: (input: object) => SystemThemeColors;
    };
    if (typeof loaded.generateSystemThemeColors !== "function") throw new Error(`${path} has no generateSystemThemeColors`);
    globalThis.__piWebExtensionUiTheme = createPaletteTheme(loaded.generateSystemThemeColors({}));
  } catch (error) {
    console.warn(`[pi-web] Extension UI stays plain text: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (!globalThis.__piWebExtensionUiTheme) void loadPaletteTheme();
