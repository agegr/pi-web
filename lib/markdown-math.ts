const DISPLAY_MATH_PARAGRAPH = /^\$\$([\s\S]+)\$\$$/;
const DISPLAY_MATH_BLOCK = /^\$\$\s*\n[\s\S]*\n\s*\$\$$/;

export function normalizeDisplayMath(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed || DISPLAY_MATH_BLOCK.test(trimmed)) return paragraph;

      const match = trimmed.match(DISPLAY_MATH_PARAGRAPH);
      if (!match) return paragraph;

      const body = match[1]?.trim();
      if (!body) return paragraph;

      return paragraph.replace(trimmed, () => `$$\n${body}\n$$`);
    })
    .join("\n\n");
}
