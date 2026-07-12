"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Incorrect password");
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          width: "100%",
          maxWidth: 380,
          padding: 28,
          border: "1px solid var(--border)",
          borderRadius: 16,
          background: "color-mix(in srgb, var(--bg-panel) 72%, var(--bg))",
          boxShadow: "0 10px 30px rgba(0,0,0,0.10)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, white))",
                display: "grid",
                placeItems: "center",
                color: "white",
                fontWeight: 700,
                fontSize: 16,
                boxShadow: "0 8px 18px color-mix(in srgb, var(--accent) 25%, transparent)",
              }}
            >
              π
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.2 }}>Pi Web</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Enter password to continue</div>
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            background: "var(--bg-subtle)",
            color: "var(--text-muted)",
            fontSize: 12,
            lineHeight: 1.55,
            border: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
          }}
        >
          This instance is protected with a password.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label htmlFor="password" style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            placeholder="Enter password"
            style={{
              width: "100%",
              height: 42,
              padding: "0 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              outline: "none",
              fontSize: 14,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
            }}
          />
        </div>

        {error ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: "color-mix(in srgb, #ef4444 10%, var(--bg))",
              border: "1px solid color-mix(in srgb, #ef4444 35%, var(--border))",
              color: "color-mix(in srgb, #ef4444 82%, var(--text))",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading || !password}
          style={{
            height: 42,
            border: 0,
            borderRadius: 10,
            background: loading || !password ? "color-mix(in srgb, var(--accent) 55%, var(--bg-panel))" : "var(--accent)",
            color: "white",
            fontWeight: 650,
            fontSize: 14,
            cursor: loading || !password ? "not-allowed" : "pointer",
            transition: "all 0.15s ease",
            boxShadow: "0 10px 22px color-mix(in srgb, var(--accent) 26%, transparent)",
          }}
        >
          {loading ? "Checking..." : "Enter Pi Web"}
        </button>
      </div>
    </form>
  );
}
