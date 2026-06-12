"use client";

import { useState, useEffect } from "react";
import type { ToolEntry } from "./ToolPanel";

interface Props {
  cwd: string | null;
  onClose: () => void;
}

export function ToolsConfig({ cwd, onClose }: Props) {
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Fetch tools via the tools API (doesn't need active session)
  useEffect(() => {
    if (!cwd) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/tools?cwd=${encodeURIComponent(cwd)}`);
        const d = await res.json();
        if (d.tools && Array.isArray(d.tools) && d.tools.length > 0) {
          setTools(d.tools);
          setActive(new Set(d.tools.filter((t: ToolEntry) => t.active).map((t: ToolEntry) => t.name)));
        }
      } catch (e) {
        console.error("Failed to fetch tools:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [cwd]);

  // Group tools by category
  const builtinTools = tools.filter(t => ["read", "bash", "edit", "write", "grep", "find", "ls"].includes(t.name));
  const extensionTools = tools.filter(t => !["read", "bash", "edit", "write", "grep", "find", "ls"].includes(t.name));
  const systemExtensions = extensionTools.filter(t => t.sourceInfo?.scope === "user");
  const projectExtensions = extensionTools.filter(t => t.sourceInfo?.scope === "project");
  const otherTools = extensionTools.filter(t => t.sourceInfo?.scope !== "user" && t.sourceInfo?.scope !== "project");

  const toggle = (name: string) => {
    setActive(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const setAll = (enabled: boolean) => {
    if (enabled) {
      setActive(new Set(tools.map(t => t.name)));
    } else {
      setActive(new Set());
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const names = [...active];
      // Save to server config
      await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeTools: names }),
      });
      // Note: tools take effect on the NEXT new session.
      // The saved config is read by startRpcSession on session creation.
      onClose();
    } catch (e) {
      console.error("Failed to save tools config:", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: 480,
          maxHeight: "78vh",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            Tools
          </span>
          {tools.length > 0 && (
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setAll(true)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                Enable all
              </button>
              <button
                onClick={() => setAll(false)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                Disable all
              </button>
            </div>
          )}
        </div>

        {/* Tool list */}
        <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
          {loading ? (
            <div style={{ padding: "40px 18px", textAlign: "center", fontSize: 12, color: "var(--text-dim)" }}>
              Loading tools...
            </div>
          ) : tools.length === 0 ? (
            <div style={{ padding: "40px 18px", textAlign: "center", fontSize: 12, color: "var(--text-dim)" }}>
              No tools available. Select a workspace directory first.
            </div>
          ) : (
            <>
              {builtinTools.length > 0 && (
                <>
                  <div style={{ padding: "4px 18px", fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>
                    Built-in
                  </div>
                  {builtinTools.map(tool => (
                    <ToolRow key={tool.name} tool={tool} active={active.has(tool.name)} onToggle={toggle} />
                  ))}
                </>
              )}
              {systemExtensions.length > 0 && (
                <>
                  <div style={{ padding: "12px 18px 4px", fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>
                    Extensions · System
                  </div>
                  {systemExtensions.map(tool => (
                    <ToolRow key={tool.name} tool={tool} active={active.has(tool.name)} onToggle={toggle} />
                  ))}
                </>
              )}
              {projectExtensions.length > 0 && (
                <>
                  <div style={{ padding: "12px 18px 4px", fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>
                    Extensions · Project
                  </div>
                  {projectExtensions.map(tool => (
                    <ToolRow key={tool.name} tool={tool} active={active.has(tool.name)} onToggle={toggle} />
                  ))}
                </>
              )}
              {otherTools.length > 0 && (
                <>
                  <div style={{ padding: "12px 18px 4px", fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>
                    Extensions · Other
                  </div>
                  {otherTools.map(tool => (
                    <ToolRow key={tool.name} tool={tool} active={active.has(tool.name)} onToggle={toggle} />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
            Takes effect on next new session
          </span>
          <button
            onClick={onClose}
            style={{
              padding: "6px 16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading || tools.length === 0}
            style={{
              padding: "6px 16px",
              borderRadius: 8,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              cursor: saving || loading || tools.length === 0 ? "default" : "pointer",
              fontSize: 12,
              opacity: saving || loading || tools.length === 0 ? 0.6 : 1,
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolRow({ tool, active, onToggle }: { tool: ToolEntry; active: boolean; onToggle: (name: string) => void }) {
  return (
    <div
      onClick={() => onToggle(tool.name)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 18px",
        cursor: "pointer",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
    >
      {/* Toggle switch */}
      <div
        style={{
          width: 32,
          height: 18,
          borderRadius: 10,
          background: active ? "var(--accent)" : "var(--border)",
          position: "relative",
          transition: "background 0.15s",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 2,
            left: active ? 15 : 2,
            width: 14,
            height: 14,
            borderRadius: 7,
            background: "#fff",
            transition: "left 0.15s",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          }}
        />
      </div>
      {/* Name */}
      <span style={{ fontSize: 13, color: active ? "var(--text)" : "var(--text-muted)", fontWeight: active ? 500 : 400 }}>
        {tool.name}
      </span>
      {/* Description */}
      <span style={{ fontSize: 11, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {tool.description}
      </span>
    </div>
  );
}
