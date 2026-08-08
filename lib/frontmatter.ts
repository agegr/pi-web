import { load as parseYaml } from "js-yaml";

const FRONTMATTER_OPEN_RE = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)/;

export interface FrontmatterResult {
  data: Record<string, unknown> | null;
  rest: string;
}

interface FrontmatterBlock {
  yaml: string;
  rest: string;
}

function extractFrontmatter(markdown: string): FrontmatterBlock | null {
  const opening = FRONTMATTER_OPEN_RE.exec(markdown);
  if (!opening) return null;

  const closingPattern = /^---[ \t]*(?:(?:\r\n|\n|\r)|$)/gm;
  closingPattern.lastIndex = opening[0].length;
  const closing = closingPattern.exec(markdown);
  if (!closing) return null;

  const yaml = markdown
    .slice(opening[0].length, closing.index)
    .replace(/(?:\r\n|\n|\r)$/, "");

  return {
    yaml,
    rest: markdown.slice(closing.index + closing[0].length),
  };
}

export function parseFrontmatter(markdown: string): FrontmatterResult {
  const block = extractFrontmatter(markdown);
  if (!block) return { data: null, rest: markdown };

  try {
    const parsed = parseYaml(block.yaml);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, rest: block.rest };
    }
  } catch {
    // The remark plugin still hides a syntactically fenced malformed block.
  }

  return { data: null, rest: block.rest };
}

export function formatFrontmatterValue(value: unknown): string {
  return formatValue(value, new WeakSet<object>());
}

function formatValue(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    if (ancestors.has(value)) return "[Circular]";
    ancestors.add(value);
    try {
      return value
        .map((item) => formatValue(item, ancestors))
        .filter(Boolean)
        .join(", ");
    } finally {
      ancestors.delete(value);
    }
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? Object.prototype.toString.call(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }

  return String(value);
}

export function getFrontmatterTitle(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}
