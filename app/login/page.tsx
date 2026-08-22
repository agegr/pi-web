"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useTransition,
  Suspense,
} from "react";
import { useTheme } from "@/hooks/useTheme";
import { useI18n, I18nProvider } from "@/hooks/useI18n";
import type { Locale } from "@/lib/i18n/types";

function getSafeRedirectUrl(): string {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const redirect = urlParams.get("redirect");
    if (
      redirect &&
      redirect.startsWith("/") &&
      !redirect.startsWith("//") &&
      !redirect.includes("\\")
    ) {
      return redirect;
    }
  } catch {
    // 忽略异常
  }
  return "/";
}

function LoginForm() {
  const { preference, toggleTheme } = useTheme();
  const { locale, setLocale, t, supportedLocales } = useI18n();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const themeLabelKey =
    preference === "light"
      ? "theme.light"
      : preference === "dark"
        ? "theme.dark"
        : "theme.auto";

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!password.trim()) return;

      setError(null);
      startTransition(async () => {
        try {
          const res = await fetch("/api/auth/web/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: username.trim(), password }),
          });

          const data = await res.json();
          if (res.ok && data.success) {
            const safeRedirect = getSafeRedirectUrl();
            window.location.replace(safeRedirect);
          } else {
            setError(t("auth.invalidPassword"));
          }
        } catch {
          setError(t("auth.networkError"));
        }
      });
    },
    [username, password, t],
  );

  const toggleLanguage = useCallback(() => {
    const nextLocale: Locale = locale === "zh-CN" ? "en" : "zh-CN";
    setLocale(nextLocale);
  }, [locale, setLocale]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 顶部控制工具栏（语言、主题切换） */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: "16px 24px",
          gap: 12,
          zIndex: 10,
        }}
      >
        {/* 语言切换按钮 */}
        <button
          type="button"
          onClick={toggleLanguage}
          title={t("common.language")}
          aria-label={t("common.language")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 34,
            padding: "0 12px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
            transition: "all 0.15s ease",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m5 8 6 6" />
            <path d="m4 14 6-6 2-3" />
            <path d="M2 5h12" />
            <path d="M7 2h1" />
            <path d="m22 22-5-10-5 10" />
            <path d="M14 18h6" />
          </svg>
          <span>
            {supportedLocales.find((l) => l.id === locale)?.label ||
              (locale === "zh-CN" ? "中文" : "English")}
          </span>
        </button>

        {/* 主题切换按钮 */}
        <button
          type="button"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            toggleTheme({
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            });
          }}
          title={t(themeLabelKey)}
          aria-label={t(themeLabelKey)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 34,
            height: 34,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {preference === "dark" ? (
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            ) : preference === "light" ? (
              <>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2" />
                <path d="M12 20v2" />
                <path d="m4.93 4.93 1.41 1.41" />
                <path d="m17.66 17.66 1.41 1.41" />
                <path d="M2 12h2" />
                <path d="M20 12h2" />
                <path d="m6.34 17.66-1.41 1.41" />
                <path d="m19.07 4.93-1.41 1.41" />
              </>
            ) : (
              <>
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
              </>
            )}
          </svg>
        </button>
      </header>

      {/* 主登录表单卡片区域 */}
      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 16px 64px 16px",
          zIndex: 1,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 400,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.08)",
            padding: "36px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          {/* Logo & 标题 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                background:
                  "color-mix(in srgb, var(--accent, #6366f1) 12%, transparent)",
                color: "var(--accent, #6366f1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
                border:
                  "1px solid color-mix(in srgb, var(--accent, #6366f1) 25%, transparent)",
              }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "var(--text)",
              }}
            >
              {t("auth.title")}
            </h1>
            <p
              style={{
                margin: "8px 0 0 0",
                fontSize: 13,
                color: "var(--text-muted)",
                lineHeight: 1.5,
              }}
            >
              {t("auth.description")}
            </p>
          </div>

          {/* 登录表单 */}
          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 16 }}
          >
            {/* 用户名输入 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                htmlFor="username-input"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--text-muted)",
                }}
              >
                {t("auth.usernameLabel")}
              </label>
              <input
                id="username-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("auth.usernamePlaceholder")}
                disabled={isPending}
                autoComplete="username"
                style={{
                  width: "100%",
                  height: 42,
                  padding: "0 14px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text)",
                  fontSize: 14,
                  fontFamily: "var(--font-sans, system-ui)",
                  outline: "none",
                  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "var(--accent, #6366f1)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "var(--border)";
                }}
              />
            </div>

            {/* 密码输入 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                htmlFor="password-input"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--text-muted)",
                }}
              >
                {t("auth.passwordLabel")}
              </label>

              <div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <input
                  id="password-input"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.passwordPlaceholder")}
                  autoFocus
                  disabled={isPending}
                  autoComplete="current-password"
                  style={{
                    width: "100%",
                    height: 42,
                    padding: "0 40px 0 14px",
                    background: "var(--bg)",
                    border: `1px solid ${error ? "var(--error, #ef4444)" : "var(--border)"}`,
                    borderRadius: 8,
                    color: "var(--text)",
                    fontSize: 14,
                    fontFamily: showPassword
                      ? "var(--font-sans, system-ui)"
                      : "var(--font-mono, monospace)",
                    outline: "none",
                    transition:
                      "border-color 0.15s ease, box-shadow 0.15s ease",
                  }}
                  onFocus={(e) => {
                    if (!error)
                      e.target.style.borderColor = "var(--accent, #6366f1)";
                  }}
                  onBlur={(e) => {
                    if (!error) e.target.style.borderColor = "var(--border)";
                  }}
                />

                {/* 显隐密码切换按钮 */}
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={t(
                    showPassword ? "auth.hidePassword" : "auth.showPassword",
                  )}
                  style={{
                    position: "absolute",
                    right: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    background: "none",
                    border: "none",
                    borderRadius: 4,
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {showPassword ? (
                      <>
                        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                        <line x1="2" x2="22" y1="2" y2="22" />
                      </>
                    ) : (
                      <>
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                </button>
              </div>

              {/* 错误提示 */}
              {error && (
                <div
                  role="alert"
                  aria-live="polite"
                  style={{
                    fontSize: 12,
                    color: "var(--error, #ef4444)",
                    marginTop: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" x2="12" y1="8" y2="12" />
                    <line x1="12" x2="12.01" y1="16" y2="16" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* 提交按钮 */}
            <button
              type="submit"
              disabled={isPending || !password.trim()}
              style={{
                height: 42,
                marginTop: 6,
                background: "var(--accent, #6366f1)",
                color: "#ffffff",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor:
                  isPending || !password.trim() ? "not-allowed" : "pointer",
                opacity: isPending || !password.trim() ? 0.65 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                transition: "all 0.15s ease",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
              }}
            >
              {isPending && (
                <svg
                  className="animate-spin"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              )}
              <span>
                {isPending ? t("auth.loggingIn") : t("auth.loginButton")}
              </span>
            </button>
          </form>
        </div>
      </main>

      {/* 底部信息 */}
      <footer
        style={{
          padding: "16px",
          textAlign: "center",
          fontSize: 12,
          color: "var(--text-muted)",
          zIndex: 1,
        }}
      >
        <span>Pi Web</span>
      </footer>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <I18nProvider>
        <LoginForm />
      </I18nProvider>
    </Suspense>
  );
}
