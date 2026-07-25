"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type AuthStatus = { initialized: boolean; authenticated: boolean };

/** 在认证状态确认前阻止业务 UI 挂载，并提供登录或初始化表单。
 * @param props 组件属性。
 * @param props.children 已认证后显示的业务界面。
 * @returns 认证分流界面。
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState("");

  async function refreshStatus() {
    const response = await fetch("/api/auth/status", { cache: "no-store" });
    if (!response.ok) throw new Error("认证状态读取失败");
    setStatus(await response.json() as AuthStatus);
  }

  useEffect(() => {
    refreshStatus().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "认证状态读取失败"));
  }, []);

  useEffect(() => {
    if (!status || status.authenticated) return;
    const target = status.initialized ? "/login" : "/setup";
    if (pathname !== target) router.replace(target);
  }, [pathname, router, status]);

  if (status?.authenticated) return children;
  if (error) return <main className="auth-page"><p className="auth-form-error" role="alert">认证状态读取失败，请刷新页面重试</p></main>;
  return <main className="auth-page"><p>正在跳转...</p></main>;
}
