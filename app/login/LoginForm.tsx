"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "./login.module.css";

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function LoginForm({ configured }: { configured: boolean }) {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(() => searchParams.get("error") ?? "");
  const [submitting, setSubmitting] = useState(false);
  const initializing = !configured;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, initialize: initializing }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setError(data?.error ?? "登录失败，请重试");
        return;
      }

      window.location.replace(safeNextPath(searchParams.get("next")));
    } catch {
      setError("无法连接认证服务，请检查网络后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="login-title">
        <div className={styles.brandMark} aria-hidden="true">π</div>
        <header className={styles.header}>
          <h1 id="login-title">Pi Web</h1>
          <p>{initializing ? "设置访问密码以保护此工作区" : "输入密码以继续访问工作区"}</p>
        </header>

        <form className={styles.form} action="/api/auth/session" method="post" onSubmit={handleSubmit}>
          <input type="text" name="username" autoComplete="username" value="pi-web" readOnly hidden />
          <input type="hidden" name="initialize" value={initializing ? "true" : "false"} />
          <input type="hidden" name="next" value={safeNextPath(searchParams.get("next"))} />
          <div className={styles.field}>
            <label htmlFor="password">{initializing ? "设置密码" : "密码"}</label>
            <input
              id="password"
              name="password"
              type="password"
              minLength={8}
              maxLength={256}
              autoComplete={initializing ? "new-password" : "current-password"}
              autoFocus
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "login-error" : initializing ? "password-hint" : undefined}
            />
            {initializing && !error && (
              <span id="password-hint" className={styles.hint}>至少 8 个字符</span>
            )}
            {error && <span id="login-error" className={styles.error} role="alert">{error}</span>}
          </div>

          <button type="submit" disabled={submitting}>
            {submitting ? "处理中..." : initializing ? "设置并进入" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}
