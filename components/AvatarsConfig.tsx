"use client";

import { useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  AVATAR_CONFIG_ROLES,
  createEmptyAvatarConfig,
  normalizeAvatarConfig,
  type AvatarConfig,
  type AvatarConfigRole,
} from "@/lib/avatar-config";
import { Avatar } from "./Avatar";

const ROLE_LABELS: Record<AvatarConfigRole, string> = {
  user: "User",
  assistant: "Assistant",
  tool: "Tool",
};

function displayConfigPath(cwd: string): string {
  const shortened = cwd
    .replace(/^\/(?:Users|home)\/[^/]+/, "~")
    .replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/, "~");
  return `${shortened.replace(/[\\/]+$/, "")}/.pi/avatars.json`;
}

function responseError(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const error = (value as { error?: unknown }).error;
  return typeof error === "string" ? error : null;
}

function AvatarPreview({
  role,
  source,
}: {
  role: AvatarConfigRole;
  source: string | null;
}) {
  const label = ROLE_LABELS[role];
  const hasCustomSource = Boolean(source);

  return (
    <div
      data-avatar-preview-role={role}
      data-avatar-source={hasCustomSource ? "custom" : "default"}
      style={{
        position: "relative",
        width: 72,
        height: 72,
        flexShrink: 0,
      }}
    >
      <span aria-hidden={hasCustomSource ? true : undefined}>
        <Avatar role={role} size={72} title={`${label} avatar`} />
      </span>
      {hasCustomSource && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source!}
          alt={`${label} avatar`}
          title={`${label} avatar`}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: 72,
            height: 72,
            borderRadius: "50%",
            objectFit: "cover",
            background: "var(--bg-panel)",
          }}
        />
      )}
    </div>
  );
}

export function AvatarsConfig({
  cwd,
  onClose,
}: {
  cwd: string;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const [config, setConfig] = useState<AvatarConfig>(() =>
    createEmptyAvatarConfig(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setConfig(createEmptyAvatarConfig());
    setLoading(true);
    setError(null);

    void fetch(`/api/avatars?cwd=${encodeURIComponent(cwd)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as unknown;
        if (!response.ok) {
          throw new Error(responseError(data) ?? `HTTP ${response.status}`);
        }
        setConfig(normalizeAvatarConfig(data));
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [cwd]);

  return (
    <div
      data-avatars-settings-modal
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatars-settings-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 720,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : 450,
          maxHeight: "calc(100dvh - 16px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              minWidth: 0,
            }}
          >
            <span
              id="avatars-settings-title"
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "var(--text)",
                flexShrink: 0,
              }}
            >
              Avatars
            </span>
            <code
              title={displayConfigPath(cwd)}
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {displayConfigPath(cwd)}
            </code>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close avatars settings"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: isMobile ? 16 : 24,
          }}
        >
          <div
            aria-live="polite"
            style={{
              minHeight: 20,
              marginBottom: 12,
              fontSize: 12,
              color: error ? "#f87171" : "var(--text-muted)",
            }}
          >
            {loading ? "Loading..." : error ? `Could not load avatars: ${error}` : ""}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "1fr"
                : "repeat(3, minmax(0, 1fr))",
              gap: 14,
            }}
          >
            {AVATAR_CONFIG_ROLES.map((role) => {
              const source = config[role];
              return (
                <div
                  key={role}
                  data-avatar-setting-role={role}
                  style={{
                    minWidth: 0,
                    padding: "22px 16px",
                    border: "1px solid var(--border)",
                    borderRadius: 9,
                    background: "var(--bg-panel)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <AvatarPreview role={role} source={source} />
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text)",
                    }}
                  >
                    {ROLE_LABELS[role]}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    {source ? "Custom" : "Default"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 14px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
