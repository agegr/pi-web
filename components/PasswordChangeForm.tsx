"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { useI18n } from "@/hooks/useI18n";

/** Props for the access password change form. */
export interface PasswordChangeFormProps {
  /** Callback invoked after the password changes successfully. */
  onSuccess: () => void;
}

/**
 * Renders the access password change form and submits it to the existing authentication API.
 *
 * @param props - Form props.
 * @param props.onSuccess - Callback invoked after the password changes successfully.
 * @returns The password change form element.
 * @throws Does not throw directly; request and validation errors are displayed in the form.
 */
export function PasswordChangeForm({ onSuccess }: PasswordChangeFormProps): ReactElement {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.newPassword !== values.confirmPassword) {
      setError(t("auth.error.AUTH_PASSWORD_MISMATCH"));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const errorCode = body !== null && typeof body === "object" && typeof body.errorCode === "string"
          ? body.errorCode
          : "AUTH_PASSWORD_CHANGE_FAILED";
        setError(t(`auth.error.${errorCode}`));
        return;
      }
      form.reset();
      onSuccess();
    } catch {
      setError(t("auth.error.AUTH_NETWORK_ERROR"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>{t("auth.currentPassword")}<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
      <label>{t("auth.newPassword")}<input name="newPassword" type="password" required autoComplete="new-password" /></label>
      <label>{t("auth.confirmNewPassword")}<input name="confirmPassword" type="password" required autoComplete="new-password" /></label>
      {error && <div className="auth-form-error" role="alert">{error}</div>}
      <button className="auth-form-submit" type="submit" disabled={busy}>
        {busy ? t("auth.processing") : t("auth.saveAndRelogin")}
      </button>
    </form>
  );
}
