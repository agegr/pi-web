"use client";

import { useMemo } from "react";
import { AnsiUp } from "ansi_up";

/**
 * Renders ANSI SGR escape sequences (as emitted by pi extension widgets such
 * as pi-lens / nano-context / rpiv-todo) as colored/styled HTML.
 *
 * Uses the battle-tested `ansi_up` library, which supports the full SGR
 * set (16/256/24-bit colors, bold/italic/underline/strikethrough, links,
 * reset codes) so any extension's widget output renders faithfully.
 * `ansi_up` escapes HTML entities by default, so widget text cannot inject
 * markup.
 *
 * The 16 palette colors (also 256-color indices 0-15) render as classes, drawn
 * in the app's light or dark scheme (`--ansi-*` in app/globals.css): extension
 * UI is themed with them, and one rendering must read on every app theme.
 * 256-color and 24-bit colors stay the exact color asked for.
 *
 * OSC 8 hyperlinks open in a new tab, like the links in chat Markdown, so a
 * click never navigates away from the session (#1374). `ansi_up` only emits
 * http(s) links, and with HTML escaped, `<a href="` can only come from it.
 */

export function AnsiText({ text }: { text: string }) {
  const html = useMemo(() => {
    const ansiUp = new AnsiUp();
    ansiUp.use_classes = true;
    return ansiUp.ansi_to_html(text).replaceAll('<a href="', '<a target="_blank" rel="noopener noreferrer" href="');
  }, [text]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
