"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  AVATAR_CONFIG_ROLES,
  normalizeAvatarConfig,
  type AvatarConfig,
  type AvatarConfigRole,
} from "@/lib/avatar-config";
import {
  AVATAR_IMAGE_MAX_SIZE,
  resizeAvatarDataUrl,
} from "@/lib/avatar-image";
import { processAvatarUpload } from "@/lib/avatar-upload";
import { responseError } from "@/lib/response-error";
import { useAvatarConfig } from "./AvatarConfigProvider";
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read file as data URL"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

function resizeAvatar(dataUrl: string): Promise<string> {
  return resizeAvatarDataUrl(dataUrl, AVATAR_IMAGE_MAX_SIZE);
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
      <Avatar role={role} size={72} title={`${label} avatar`} src={source} />
    </div>
  );
}

interface RoleCardProps {
  role: AvatarConfigRole;
  savedSource: string | null;
  draftSource: string | null;
  uploading: boolean;
  uploadError: string | null;
  onUpload: (file: File) => void;
  onClearDraft: () => void;
  onReset: () => void;
}

function RoleCard({
  role,
  savedSource,
  draftSource,
  uploading,
  uploadError,
  onUpload,
  onClearDraft,
  onReset,
}: RoleCardProps) {
  const label = ROLE_LABELS[role];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasDraft = draftSource !== savedSource;
  const hasSaved = Boolean(savedSource);
  const source = draftSource;
  const hasCustomSource = Boolean(source);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset the input so re-picking the same file fires onChange again.
    event.target.value = "";
    if (!file) return;
    onUpload(file);
  };

  const handlePickClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div
      key={role}
      data-avatar-setting-role={role}
      data-avatar-dirty={hasDraft ? "true" : "false"}
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
      <div
        style={{
          fontSize: 11,
          color: hasCustomSource ? "var(--accent)" : "var(--text-dim)",
        }}
      >
        {hasDraft
          ? "Edited (unsaved)"
          : hasSaved
            ? "Custom"
            : "Default"}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleFileChange}
        data-avatar-upload-input={role}
        style={{ display: "none" }}
      />
      <div
        style={{
          display: "flex",
          gap: 6,
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={handlePickClick}
          disabled={uploading}
          data-avatar-upload-button={role}
          style={{
            padding: "5px 10px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            cursor: uploading ? "wait" : "pointer",
            fontSize: 12,
            opacity: uploading ? 0.6 : 1,
          }}
        >
          {uploading ? "Processing..." : "Upload image"}
        </button>
        {hasDraft && (
          <button
            type="button"
            onClick={onClearDraft}
            disabled={uploading}
            data-avatar-revert-button={role}
            style={{
              padding: "5px 10px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: uploading ? "not-allowed" : "pointer",
              fontSize: 12,
            }}
          >
            Revert
          </button>
        )}
        {hasSaved && (
          <button
            type="button"
            onClick={onReset}
            disabled={uploading}
            data-avatar-reset-button={role}
            style={{
              padding: "5px 10px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: uploading ? "not-allowed" : "pointer",
              fontSize: 12,
            }}
          >
            Reset
          </button>
        )}
      </div>
      {uploadError && (
        <div
          role="alert"
          data-avatar-upload-error={role}
          style={{
            fontSize: 11,
            color: "#f87171",
            textAlign: "center",
            wordBreak: "break-word",
          }}
        >
          {uploadError}
        </div>
      )}
      {/* Hidden label region used by tests to identify the role card. */}
      <span data-avatar-role-label={role} style={{ display: "none" }}>
        {label}
      </span>
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
  const { config: savedConfig, setConfig: setSavedConfig } = useAvatarConfig();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftConfig, setDraftConfig] = useState<AvatarConfig>(() => ({
    ...savedConfig,
  }));
  const [uploadingRole, setUploadingRole] = useState<AvatarConfigRole | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<AvatarConfigRole, string | null>>({
    user: null,
    assistant: null,
    tool: null,
  });
  const [saveState, setSaveState] = useState<
    { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  useEffect(() => {
    const controller = new AbortController();
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
        const normalized = normalizeAvatarConfig(data);
        setSavedConfig(normalized);
        setDraftConfig({ ...normalized });
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [cwd, setSavedConfig]);

  const hasDirtyChanges = useMemo(() => {
    return AVATAR_CONFIG_ROLES.some((role) => draftConfig[role] !== savedConfig[role]);
  }, [draftConfig, savedConfig]);

  /**
   * Validate and apply an uploaded avatar for a single role. The pure
   * `processAvatarUpload` helper guarantees:
   * - SVG / unsupported MIME files are rejected before the draft changes.
   * - Undecodable images are rejected before the draft changes.
   * - Encoded data URLs over the 2 MB limit are rejected before the draft
   *   changes.
   * On any rejection the draft (and therefore the saved config on disk)
   * remain unchanged - only the per-role error string is updated.
   */
  const handleUpload = async (role: AvatarConfigRole, file: File) => {
    setUploadingRole(role);
    setUploadErrors((prev) => ({ ...prev, [role]: null }));
    try {
      const result = await processAvatarUpload(file, {
        readDataUrl: readFileAsDataUrl,
        resizeDataUrl: resizeAvatar,
      });
      if (!result.ok) {
        setUploadErrors((prev) => ({ ...prev, [role]: result.reason }));
        return;
      }
      setDraftConfig((prev) => ({ ...prev, [role]: result.dataUrl }));
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
      setUploadErrors((prev) => ({ ...prev, [role]: message }));
    } finally {
      setUploadingRole(null);
    }
  };

  const handleClearDraft = (role: AvatarConfigRole) => {
    setDraftConfig((prev) => ({ ...prev, [role]: savedConfig[role] }));
    setUploadErrors((prev) => ({ ...prev, [role]: null }));
  };

  const handleReset = (role: AvatarConfigRole) => {
    setDraftConfig((prev) => ({ ...prev, [role]: null }));
    setUploadErrors((prev) => ({ ...prev, [role]: null }));
  };

  const handleSave = async () => {
    setSaveState({ kind: "saving" });
    try {
      const response = await fetch("/api/avatars", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, ...draftConfig }),
      });
      const data = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        throw new Error(responseError(data) ?? `HTTP ${response.status}`);
      }
      const normalized = normalizeAvatarConfig(data);
      setSavedConfig(normalized);
      setDraftConfig({ ...normalized });
      setSaveState({ kind: "saved" });
      setTimeout(() => {
        setSaveState((current) => (current.kind === "saved" ? { kind: "idle" } : current));
      }, 2000);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setSaveState({ kind: "error", message });
    }
  };

  const handleCancel = () => {
    setDraftConfig({ ...savedConfig });
    setUploadErrors({ user: null, assistant: null, tool: null });
    setSaveState({ kind: "idle" });
  };

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
          height: isMobile ? "calc(100dvh - 16px)" : 540,
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
            data-avatars-settings-status
            style={{
              minHeight: 20,
              marginBottom: 12,
              fontSize: 12,
              color: error ? "#f87171" : "var(--text-muted)",
            }}
          >
            {loading
              ? "Loading..."
              : error
                ? `Could not load avatars: ${error}`
                : saveState.kind === "saved"
                  ? "Saved."
                  : saveState.kind === "error"
                    ? `Could not save: ${saveState.message}`
                    : ""}
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
            {AVATAR_CONFIG_ROLES.map((role) => (
              <RoleCard
                key={role}
                role={role}
                savedSource={savedConfig[role]}
                draftSource={draftConfig[role]}
                uploading={uploadingRole === role}
                uploadError={uploadErrors[role]}
                onUpload={(file) => void handleUpload(role, file)}
                onClearDraft={() => handleClearDraft(role)}
                onReset={() => handleReset(role)}
              />
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            PNG, JPEG, or WebP. Images are resized before saving.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={handleCancel}
              disabled={!hasDirtyChanges || saveState.kind === "saving"}
              data-avatars-settings-cancel
              style={{
                padding: "6px 14px",
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-muted)",
                cursor: hasDirtyChanges ? "pointer" : "default",
                fontSize: 13,
                opacity: hasDirtyChanges ? 1 : 0.45,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!hasDirtyChanges || saveState.kind === "saving"}
              data-avatars-settings-save
              style={{
                padding: "6px 14px",
                background: "var(--accent)",
                border: "1px solid var(--accent)",
                borderRadius: 6,
                color: "#ffffff",
                cursor: hasDirtyChanges ? "pointer" : "default",
                fontSize: 13,
                opacity: hasDirtyChanges ? 1 : 0.45,
              }}
            >
              {saveState.kind === "saving" ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
