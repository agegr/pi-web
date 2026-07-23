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
  /** Custom data URL / image source. When provided, overlays the letter
   *  avatar with the image and keeps the letter as a hidden fallback. */
  src?: string | null;
}

/**
 * Shared avatar renderer used by chat messages and tool call block headers.
 * Renders the role-keyed default avatar by default; a custom `src` overlays
 * the same circular surface with the supplied image while preserving the
 * default letter for screen readers and broken-image fallbacks.
 */
export const Avatar = memo(function Avatar({ role, size, title, src }: AvatarProps) {
  const config = ROLE_DEFAULTS[role];
  const diameter = size ?? (role === "tool" ? 16 : 28);
  const fontSize = Math.max(9, Math.round(diameter * 0.45));
  const accessibleTitle = title ?? `${role} avatar`;
  const hasCustomSrc = Boolean(src);
  return (
    <span
      role="img"
      aria-label={accessibleTitle}
      title={accessibleTitle}
      data-avatar-role={role}
      data-avatar-source={hasCustomSrc ? "custom" : "default"}
      style={{
        position: "relative",
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
        overflow: "hidden",
      }}
    >
      <span
        aria-hidden={hasCustomSrc ? true : undefined}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
        }}
      >
        {config.letter}
      </span>
      {hasCustomSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt=""
          aria-hidden={true}
          title={accessibleTitle}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            objectFit: "cover",
          }}
        />
      )}
    </span>
  );
});
