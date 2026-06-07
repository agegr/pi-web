"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { parseRepo as parseRepoShared } from "@/lib/parse-repo";

interface Props {
  onCloned: (path: string) => void;
  onClose: () => void;
}

export function CloneRepoModal({ onCloned, onClose }: Props) {
  const [repo, setRepo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleClose = () => onClose();

  const parseRepo = useCallback((input: string): string | null => parseRepoShared(input), []);

  const isValidFormat = parseRepo(repo.trim()) !== null;
  const repoPreview = parseRepo(repo.trim());

  const handleClone = async () => {
    const trimmed = repo.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setLogs([]);
    setShowLogs(true);

    try {
      const res = await fetch("/api/github/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: parseRepo(trimmed) }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error || "Clone failed");
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response body");
        setLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6)) as {
              type: string;
              message?: string;
              path?: string;
            };

            if (data.type === "progress" && data.message) {
              setLogs((prev) => [...prev, data.message!]);
            }

            if (data.type === "done" && data.path) {
              setLogs((prev) => [...prev, "✓ Done!"]);
              setLoading(false);
              onCloned(data.path);
              closeTimerRef.current = setTimeout(handleClose, 300);
            }

            if (data.type === "error" && data.message) {
              setError(data.message!);
              setLoading(false);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setLoading(false);
    }
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
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
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
          width: 480,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
          padding: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
            Clone Repository
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            style={{
              background: "none", border: "none", color: "var(--text-muted)",
              cursor: loading ? "default" : "pointer", padding: 4, borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "color 0.12s",
            }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
            Repository
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={inputRef}
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && isValidFormat && !loading) handleClone(); if (e.key === "Escape" && !loading) handleClose(); }}
              placeholder="CodeByZack/z-ai 或 https://github.com/CodeByZack/z-ai.git"
              style={{
                flex: 1,
                height: 36, padding: "0 12px",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 8, color: "var(--text)", fontSize: 13, outline: "none",
              }}
              disabled={loading}
            />
            <button
              onClick={handleClone}
              disabled={loading || !isValidFormat}
              style={{
                height: 36, padding: "0 16px",
                background: loading ? "var(--bg-hover)" : "var(--accent)",
                border: "none", borderRadius: 8,
                color: loading ? "var(--text-muted)" : "#fff",
                fontSize: 13, fontWeight: 600,
                cursor: !isValidFormat && !loading ? "not-allowed" : loading ? "wait" : "pointer",
                opacity: loading ? 0.6 : !isValidFormat ? 0.5 : 1,
              }}
            >
              {loading ? "Cloning..." : "Clone"}
            </button>
          </div>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {!repo
            ? "Accepts owner/repo or full GitHub URL"
            : !repoPreview
              ? "Format: owner/repo or https://github.com/owner/repo"
              : loading
                ? ""
                : `Will clone to ~/.pi/agent/repos/${repoPreview.replace("/", "-")}`}
        </div>

        {showLogs && (
          <div style={{
            marginTop: 12,
            maxHeight: 200,
            overflow: "auto",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 12px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.6,
            color: "var(--text-muted)",
          }}>
            {logs.length === 0 && loading && (
              <span style={{ color: "var(--text-dim)", fontStyle: "italic" }}>Starting clone...</span>
            )}
            {logs.map((line, i) => (
              <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {line}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}

        {error && (
          <div style={{
            marginTop: 8, padding: "8px 12px",
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 6, fontSize: 12, color: "#ef4444",
          }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
