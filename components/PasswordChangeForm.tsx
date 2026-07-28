"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { useI18n } from "@/hooks/useI18n";

/** 访问密码修改表单的属性。 */
export interface PasswordChangeFormProps {
  /** 密码修改成功后的回调。 */
  onSuccess: () => void;
}

/**
 * 渲染访问密码修改表单，并提交到现有认证 API。
 *
 * @param props - 表单属性。
 * @param props.onSuccess - 密码修改成功后的回调。
 * @returns 密码修改表单元素。
 * @throws 不直接抛出异常；请求和校验错误会显示在表单内。
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
