"use client";

import { useRouter } from "next/navigation";
import { AuthForms } from "@/components/AuthForms";

/** 渲染登录页面。 * @returns 登录页面。 */
export default function LoginPage() {
  const router = useRouter();
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-mark" aria-hidden="true">π</div>
        <p className="auth-kicker">PI WEB</p>
        <h1>登录 Pi Web</h1>
        <p className="auth-description">输入访问密码以继续使用工作区。</p>
        <AuthForms mode="login" onSuccess={() => router.replace("/")} />
      </section>
    </main>
  );
}
