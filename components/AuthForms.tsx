"use client";

import { useState, type FormEvent } from "react";

/** 认证表单的工作模式。 */
export type AuthFormMode = "login" | "setup";

type AuthFormsProps = {
  mode: AuthFormMode;
  onSuccess: () => void;
};

function getErrorMessage(status: number): string {
  if (status === 429) return "操作过于频繁，请稍后再试";
  return "认证失败，请稍后再试";
}

/**
 * 渲染登录或初始化认证表单。
 * @param props 表单模式和成功回调。
 * @param props.mode 当前表单模式。
 * @param props.onSuccess 请求成功后的回调。
 * @returns 认证表单元素。
 */
export function AuthForms({ mode, onSuccess }: AuthFormsProps) {
  const isSetup = mode === "setup";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (isSetup && values.password !== values.confirmPassword) {
      setError("两次密码不一致");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(isSetup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error(getErrorMessage(response.status));
      form.reset();
      onSuccess();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "认证失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate={false}>
      {isSetup && (
        <label>
          初始化 token
          <input name="token" type="password" autoComplete="one-time-code" required />
        </label>
      )}
      <label>
        访问密码
        <input name="password" type="password" autoComplete={isSetup ? "new-password" : "current-password"} required />
      </label>
      {isSetup && (
        <label>
          确认密码
          <input name="confirmPassword" type="password" autoComplete="new-password" required />
        </label>
      )}
      {error && <p className="auth-form-error" role="alert">{error}</p>}
      <button className="auth-form-submit" type="submit" disabled={busy}>
        {busy ? "处理中..." : isSetup ? "初始化" : "登录"}
      </button>
    </form>
  );
}
