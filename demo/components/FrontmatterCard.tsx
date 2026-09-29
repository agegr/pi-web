"use client";

import type { ReactNode } from "react";
import { formatFrontmatterValue, getFrontmatterTitle } from "@/lib/frontmatter";

interface FrontmatterCardProps {
  data: Record<string, unknown> | null;
}

const TAG_KEYS = ["tags", "categories", "keywords", "tag", "category"];

function isUrl(value: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(value);
}

function renderValue(value: unknown): ReactNode {
  const text = formatFrontmatterValue(value);
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

  const title = getFrontmatterTitle(data.title);

  const tagKey = TAG_KEYS.find((key) => Array.isArray(data[key]));
  const tags = tagKey
    ? (data[tagKey] as unknown[]).map(formatFrontmatterValue).filter(Boolean)
    : [];

  const rows = entries.filter(([key]) => key !== tagKey && (key !== "title" || !title));

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
