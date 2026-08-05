"use client";

import type { ReactNode } from "react";

interface FrontmatterCardProps {
  data: Record<string, unknown> | null;
}

const TAG_KEYS = ["tags", "categories", "keywords", "tag", "category"];

function isUrl(value: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(value);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function renderValue(value: unknown): ReactNode {
  const text = formatValue(value);
  if (!text) return null;
  if (typeof value === "string" && isUrl(value)) {
    // Only safe schemes — values come from the user's own file but stay escaped
    // by React regardless; this just prevents javascript: hrefs.
    return (
      <a href={value} target="_blank" rel="noopener noreferrer">
        {text}
      </a>
    );
  }
  // Arrays are rendered as inline text; anything else keeps its plain text form.
  return text;
}

export function FrontmatterCard({ data }: FrontmatterCardProps) {
  if (!data) return null;
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  const title =
    typeof data.title === "string" && data.title.trim() ? data.title.trim() : null;

  const tagKey = TAG_KEYS.find((key) => Array.isArray(data[key]));
  const tags = tagKey
    ? (data[tagKey] as unknown[]).map(formatValue).filter(Boolean)
    : [];

  const rows = entries.filter(([key]) => key !== "title" && key !== tagKey);

  return (
    <div className="markdown-frontmatter">
      {title && <div className="markdown-frontmatter-title">{title}</div>}
      {tags.length > 0 && (
        <div className="markdown-frontmatter-tags">
          {tags.map((tag, index) => (
            <span className="markdown-frontmatter-tag" key={`${tag}-${index}`}>
              {tag}
            </span>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <dl className="markdown-frontmatter-rows">
          {rows.map(([key, value]) => (
            <div className="markdown-frontmatter-row" key={key}>
              <dt>{key}</dt>
              <dd>{renderValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
