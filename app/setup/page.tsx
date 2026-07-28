"use client";

import { useRouter } from "next/navigation";
import { AuthForms } from "@/components/AuthForms";
import { useI18n } from "@/hooks/useI18n";

/** Render the first-run setup page. * @returns Setup page. */
export default function SetupPage() {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-mark" aria-hidden="true">π</div>
        <p className="auth-kicker">PI WEB / FIRST RUN</p>
        <h1>{t("auth.setup.title")}</h1>
        <p className="auth-description">{t("auth.setup.description")}</p>
        <AuthForms mode="setup" onSuccess={() => router.replace("/login")} />
      </section>
    </main>
  );
}
