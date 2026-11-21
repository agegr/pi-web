import {
  parseTerminalTheme,
  TERMINAL_THEME_DEFAULT,
  TERMINAL_THEME_STORAGE_KEY,
  type TerminalTheme,
} from "@/lib/terminal-theme";
import { createStoredChoice } from "./useStoredChoice";

const theme = createStoredChoice(TERMINAL_THEME_STORAGE_KEY, parseTerminalTheme, TERMINAL_THEME_DEFAULT);

export function setTerminalTheme(next: TerminalTheme): void {
  theme.set(next);
}

/** Every open terminal shares one choice, kept per browser. */
export function useTerminalTheme(): TerminalTheme {
  return theme.use();
}
