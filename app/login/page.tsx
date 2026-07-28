"use client";

import { useRouter } from "next/navigation";
import { AuthForms } from "@/components/AuthForms";
import { useI18n } from "@/hooks/useI18n";

/** Render the login page. * @returns Login page. */
export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-mark" aria-hidden="true">π</div>
        <p className="auth-kicker">PI WEB</p>
        <h1>{t("auth.login.title")}</h1>
        <p className="auth-description">{t("auth.login.description")}</p>
        <AuthForms mode="login" onSuccess={() => router.replace("/")} />
      </section>
    </main>
  );
}
