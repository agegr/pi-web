"use client";

import { useState, type FormEvent } from "react";
import { submitAuthForm } from "@/lib/auth-form";
import { useI18n } from "@/hooks/useI18n";

/** 认证表单的工作模式。 */
export type AuthFormMode = "login" | "setup";

type AuthFormsProps = {
  mode: AuthFormMode;
  onSuccess: () => void;
};

/**
 * 渲染登录或初始化认证表单。
 * @param props 表单模式和成功回调。
 * @param props.mode 当前表单模式。
 * @param props.onSuccess 请求成功后的回调。
 * @returns 认证表单元素。
 */
export function AuthForms({ mode, onSuccess }: AuthFormsProps) {
  const { t } = useI18n();
  const isSetup = mode === "setup";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (isSetup && values.password !== values.confirmPassword) {
      setError(t("auth.error.AUTH_PASSWORD_MISMATCH"));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await submitAuthForm({ mode, values, request: fetch, onSuccess: () => {
      form.reset();
      onSuccess();
      } });
      if (!result.ok) setError(t(`auth.error.${result.errorCode}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate={false}>
      {isSetup && (
        <label>
          {t("auth.token")}
          <input name="token" type="password" autoComplete="one-time-code" required />
        </label>
      )}
      <label>
        {t("auth.password")}
        <input name="password" type="password" autoComplete={isSetup ? "new-password" : "current-password"} required />
      </label>
      {isSetup && (
        <label>
          {t("auth.confirmPassword")}
          <input name="confirmPassword" type="password" autoComplete="new-password" required />
        </label>
      )}
      {error && <p className="auth-form-error" role="alert">{error}</p>}
      <button className="auth-form-submit" type="submit" disabled={busy}>
        {busy ? t("auth.processing") : isSetup ? t("auth.setup.submit") : t("auth.login.submit")}
      </button>
    </form>
  );
}
