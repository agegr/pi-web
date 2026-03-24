"use client";

import { useEffect, useState } from "react";

interface Props {
  filePath: string;
}

interface FileData {
  content: string;
  language: string;
  size: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileViewer({ filePath }: Props) {
  const [data, setData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    setPreviewMode(false);
    const encoded = filePath.split("/").filter(Boolean).join("/");
    fetch(`/api/files/${encoded}?type=read`)
      .then((r) => r.json())
      .then((d: FileData & { error?: string }) => {
        if (d.error) { setError(d.error); return; }
        setData(d);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [filePath]);

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (!data) return null;

  const isHtml = data.language === "html";
  const lines = data.content.split("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Status bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }}>{filePath}</span>
        <span style={{ marginLeft: "auto" }}>{data.language}</span>
        {!previewMode && <span>{lines.length} lines</span>}
        <span>{formatSize(data.size)}</span>
        {isHtml && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setPreviewMode(false)}
              style={{
                padding: "2px 8px",
                fontSize: 11,
                border: "none",
                cursor: "pointer",
                background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: !previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: !previewMode ? 600 : 400,
              }}
            >
              Source
            </button>
            <button
              onClick={() => setPreviewMode(true)}
              style={{
                padding: "2px 8px",
                fontSize: 11,
                border: "none",
                borderLeft: "1px solid var(--border)",
                cursor: "pointer",
                background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: previewMode ? 600 : 400,
              }}
            >
              Preview
            </button>
          </div>
        )}
      </div>

      {/* Content area */}
      {isHtml && previewMode ? (
        <iframe
          srcDoc={data.content}
          sandbox="allow-scripts"
          style={{ flex: 1, border: "none", background: "#fff" }}
          title="HTML preview"
        />
      ) : (
        <div style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>
          <table
            style={{
              borderCollapse: "collapse",
              width: "100%",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx} style={{ verticalAlign: "top" }}>
                  <td
                    style={{
                      padding: "0 12px 0 16px",
                      textAlign: "right",
                      color: "var(--text-dim)",
                      userSelect: "none",
                      minWidth: 48,
                      fontSize: 12,
                      lineHeight: 1.6,
                      borderRight: "1px solid var(--border)",
                      background: "var(--bg-panel)",
                    }}
                  >
                    {idx + 1}
                  </td>
                  <td
                    style={{
                      padding: "0 16px",
                      whiteSpace: "pre",
                      color: "var(--text)",
                      width: "100%",
                    }}
                  >
                    {line || "\u00a0"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
