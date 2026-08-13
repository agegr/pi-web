"use client";

import { useI18n } from "@/hooks/useI18n";
import { ShieldCheck } from "lucide-react";
import { DialogShell } from "./DialogShell";

export function ProjectTrustDialog({
  cwd,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  cwd: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <DialogShell
      size="confirm"
      title={t("trust.dialogTitle")}
      ariaLabel={t("trust.cancel")}
      onClose={onCancel}
      dismissible={!busy}
      backdropDismissible={false}
      footer={(
        <>
          <button type="button" className="codex-dialog-button" onClick={onCancel} disabled={busy}>{t("trust.cancel")}</button>
          <button type="button" className="codex-dialog-button" data-variant="primary" onClick={onConfirm} disabled={busy}>
            {busy ? t("trust.trusting") : t("trust.trustProject")}
          </button>
        </>
      )}
    >
      <div className="codex-dialog-confirm-copy">
        <ShieldCheck size={18} color="#d97706" aria-hidden="true" />
        <span>{t("trust.dialogBody")}</span>
      </div>
      <code className="codex-dialog-inset">{cwd}</code>
      {error && <div role="alert" className="codex-dialog-error">{error}</div>}
    </DialogShell>
  );
}
