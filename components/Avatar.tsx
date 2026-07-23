"use client";

import { memo } from "react";

export type AvatarRole = "user" | "assistant" | "tool";

interface RoleDefaults {
  letter: string;
  bg: string;
  fg: string;
}

const ROLE_DEFAULTS: Record<AvatarRole, RoleDefaults> = {
  user: { letter: "U", bg: "#3b82f6", fg: "#ffffff" },
  assistant: { letter: "A", bg: "#a855f7", fg: "#ffffff" },
  tool: { letter: "T", bg: "#9ca3af", fg: "#ffffff" },
};

interface AvatarProps {
  role: AvatarRole;
  /** Diameter in px. Defaults vary by role: user/assistant 28, tool 16. */
  size?: number;
  /** Override the accessibility label. Defaults to `"<role> avatar"`. */
  title?: string;
}

/**
 * Shared avatar renderer used by chat messages and tool call block headers.
 * Renders the role-keyed default avatar; custom image support is added by
 * later tickets.
 */
export const Avatar = memo(function Avatar({ role, size, title }: AvatarProps) {
  const config = ROLE_DEFAULTS[role];
  const diameter = size ?? (role === "tool" ? 16 : 28);
  const fontSize = Math.max(9, Math.round(diameter * 0.45));
  const accessibleTitle = title ?? `${role} avatar`;
  return (
    <span
      role="img"
      aria-label={accessibleTitle}
      title={accessibleTitle}
      data-avatar-role={role}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: diameter,
        height: diameter,
        minWidth: diameter,
        minHeight: diameter,
        borderRadius: "50%",
        background: config.bg,
        color: config.fg,
        fontSize,
        fontWeight: 600,
        lineHeight: 1,
        flexShrink: 0,
        userSelect: "none",
        fontFamily: "var(--font-mono)",
        verticalAlign: "middle",
      }}
    >
      {config.letter}
    </span>
  );
});