"use client";

import { PlanMarkdownBody } from "../PlanMarkdownBody";

export function PlanList({
  title,
  items,
  color,
}: {
  title: string;
  items: string[];
  color: string;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color, marginBottom: 2 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--text)" }}>
        {items.map((it, i) => (
          <li key={i} style={{ marginBottom: 2 }}>
            <PlanMarkdownBody>{it}</PlanMarkdownBody>
          </li>
        ))}
      </ul>
    </div>
  );
}
