"use client";

import { useState, useEffect, useCallback } from "react";

interface Props {
  onClose: () => void;
}

interface GitHubStatus {
  configured: boolean;
  loggedIn: boolean;
  user: { login: string; avatar: string } | null;
}

export function SettingsConfig({ onClose }: Props) {
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null);
  const [activeSection, setActiveSection] = useState<"github">("github");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/github/status");
      if (res.ok) {
        const data = (await res.json()) as GitHubStatus;
        setGhStatus(data);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    const onFocus = () => fetchStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchStatus]);

  const handleLogin = () => {
    window.location.href = "/api/github/login";
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/github/logout", { method: "POST" });
      setGhStatus((prev: GitHubStatus | null) => prev ? { ...prev, loggedIn: false, user: null } : null);
    } catch { /* ignore */ }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
        }}
      />

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: 520,
          maxHeight: "80vh",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
            Settings
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", color: "var(--text-muted)",
              cursor: "pointer", padding: 4, borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "color 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Sidebar */}
          <div style={{
            width: 140, flexShrink: 0,
            borderRight: "1px solid var(--border)",
            padding: "8px 0",
          }}>
            {([
              { id: "github" as const, label: "GitHub", icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12 24 5.37 18.63 0 12 0z" />
                </svg>
              )},
            ]).map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  width: "100%", padding: "8px 16px",
                  background: activeSection === id ? "var(--bg-selected)" : "none",
                  border: "none", cursor: "pointer",
                  color: activeSection === id ? "var(--text)" : "var(--text-muted)",
                  fontSize: 13, textAlign: "left", transition: "background 0.1s, color 0.1s",
                }}
                onMouseEnter={(e) => { if (activeSection !== id) { e.currentTarget.style.background = "var(--bg-hover)"; }}}
                onMouseLeave={(e) => { if (activeSection !== id) { e.currentTarget.style.background = "none"; }}}
              >
                <span style={{ flexShrink: 0, opacity: 0.8 }}>{icon}</span>
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, padding: "16px 20px", overflow: "auto" }}>
            {activeSection === "github" && (
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
                  GitHub
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
                  Connect your GitHub account to enable PR creation, code review, and repository management.
                </div>

                {!ghStatus ? (
                  <div style={{ color: "var(--text-dim)", fontSize: 12, fontStyle: "italic" }}>
                    Loading...
                  </div>
                ) : !ghStatus.configured ? (
                  <div style={{
                    padding: "12px 16px", borderRadius: 8,
                    background: "rgba(234,179,8,0.1)",
                    border: "1px solid rgba(234,179,8,0.2)",
                    color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6,
                  }}>
                    <strong style={{ color: "var(--text)" }}>GitHub OAuth not configured.</strong>
                    <br />
                    Set <code style={{ fontFamily: "var(--font-mono)", background: "var(--bg)", padding: "1px 4px", borderRadius: 3 }}>GITHUB_CLIENT_ID</code> and{' '}
                    <code style={{ fontFamily: "var(--font-mono)", background: "var(--bg)", padding: "1px 4px", borderRadius: 3 }}>GITHUB_CLIENT_SECRET</code>{' '}
                    environment variables, then restart.
                  </div>
                ) : ghStatus.loggedIn && ghStatus.user ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <img
                        src={ghStatus.user.avatar}
                        alt=""
                        style={{ width: 40, height: 40, borderRadius: "50%" }}
                      />
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                          {ghStatus.user.login}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          Connected to GitHub
                        </div>
                      </div>
                      <span style={{
                        marginLeft: "auto", display: "flex", alignItems: "center", gap: 4,
                        fontSize: 11, color: "#22c55e",
                      }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
                        Active
                      </span>
                    </div>
                    <button
                      onClick={handleLogout}
                      style={{
                        alignSelf: "flex-start",
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "6px 14px", fontSize: 12,
                        background: "none", border: "1px solid var(--border)",
                        borderRadius: 8, color: "var(--text-muted)", cursor: "pointer",
                        transition: "all 0.12s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "#ef4444"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{
                      padding: "12px 16px", marginBottom: 12,
                      borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)",
                      color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6,
                    }}>
                      <strong style={{ color: "var(--text)" }}>Permissions requested:</strong>
                      <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                        <li><code style={{ fontFamily: "var(--font-mono)" }}>repo</code> — Read and write your repos (clone, push, PRs)</li>
                        <li><code style={{ fontFamily: "var(--font-mono)" }}>read:user</code> — Read your profile info</li>
                      </ul>
                    </div>
                    <button
                      onClick={handleLogin}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "10px 20px", fontSize: 13, fontWeight: 600,
                        background: "#24292e",
                        border: "1px solid #1b1f23",
                        borderRadius: 8,
                        color: "#fff",
                        cursor: "pointer",
                        transition: "opacity 0.12s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.9"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12 24 5.37 18.63 0 12 0z" />
                      </svg>
                      Login with GitHub
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
