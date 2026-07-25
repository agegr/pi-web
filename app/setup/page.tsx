"use client";

import { useRouter } from "next/navigation";
import { AuthForms } from "@/components/AuthForms";

/** 渲染首次初始化页面。 * @returns 初始化页面。 */
export default function SetupPage() {
  const router = useRouter();
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-mark" aria-hidden="true">π</div>
        <p className="auth-kicker">PI WEB / FIRST RUN</p>
        <h1>初始化访问保护</h1>
        <p className="auth-description">使用服务端提供的一次性 token 设置访问密码。</p>
        <AuthForms mode="setup" onSuccess={() => router.replace("/login")} />
      </section>
    </main>
  );
}
