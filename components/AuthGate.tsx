"use client";

import { FormEvent, useEffect, useState } from "react";

type AuthStatus = { initialized: boolean; authenticated: boolean };

/** 在认证状态确认前阻止业务 UI 挂载，并提供登录或初始化表单。
 * @param props 组件属性。
 * @param props.children 已认证后显示的业务界面。
 * @returns 认证分流界面。
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refreshStatus() {
    const response = await fetch("/api/auth/status", { cache: "no-store" });
    if (!response.ok) throw new Error("认证状态读取失败");
    setStatus(await response.json() as AuthStatus);
  }

  useEffect(() => {
    refreshStatus().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "认证状态读取失败"));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const endpoint = status?.initialized ? "/api/auth/login" : "/api/auth/setup";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "认证失败");
      }
      await refreshStatus();
      if (endpoint === "/api/auth/setup") window.history.replaceState(null, "", "/login");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "认证失败");
    } finally {
      setBusy(false);
    }
  }

  if (status?.authenticated) return children;
  if (!status) return <main style={{ padding: 24 }}>Loading...</main>;

  return (
    <main style={{ maxWidth: 420, margin: "12vh auto", padding: 24 }}>
      <h1>{status.initialized ? "Sign in to Pi Web" : "Set up Pi Web"}</h1>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        {!status.initialized && <input name="token" type="password" placeholder="Setup token" required />}
        <input name="password" type="password" placeholder="Password" required />
        {!status.initialized && <input name="confirmPassword" type="password" placeholder="Confirm password" required />}
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Please wait..." : status.initialized ? "Sign in" : "Initialize"}</button>
      </form>
    </main>
  );
}
