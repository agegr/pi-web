"use client";

import { useState, useEffect, useCallback } from "react";

interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
}

function sourceLabel(skill: Skill): string {
  const src = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
      {children}
    </div>
  );
}

function Toggle({ enabled, loading, onToggle }: { enabled: boolean; loading: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      disabled={loading}
      title={enabled ? "Visible in model prompt — click to disable" : "Hidden from model prompt — click to enable"}
      style={{
        flexShrink: 0, width: 40, height: 22, borderRadius: 11,
        border: "none", padding: 0,
        cursor: loading ? "wait" : "pointer",
        background: enabled ? "var(--accent)" : "var(--border)",
        position: "relative",
        transition: "background 0.18s",
        outline: "none",
      }}
    >
      <span style={{
        position: "absolute",
        top: 3, left: enabled ? 21 : 3,
        width: 16, height: 16, borderRadius: "50%",
        background: "#fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
        transition: "left 0.18s cubic-bezier(.4,0,.2,1)",
      }} />
    </button>
  );
}

function SkillDetail({ skill, onToggle, toggling, saveError }: {
  skill: Skill;
  onToggle: (skill: Skill) => void;
  toggling: boolean;
  saveError: string | null;
}) {
  const label = sourceLabel(skill);
  const enabled = !skill.disableModelInvocation;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Path + tag + toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{
          fontSize: 10, padding: "1px 5px", borderRadius: 3, flexShrink: 0,
          background: label === "project" ? "rgba(99,102,241,0.12)" : "rgba(120,120,120,0.12)",
          color: label === "project" ? "rgba(99,102,241,0.8)" : "var(--text-dim)",
        }}>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{skill.filePath}</span>
        <Toggle enabled={enabled} loading={toggling} onToggle={() => onToggle(skill)} />
        {saveError && <span style={{ fontSize: 12, color: "#f87171", flexShrink: 0 }}>{saveError}</span>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>Name</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text)" }}>{skill.name}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>Description</span>
        <span style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>{skill.description}</span>
      </div>
    </div>
  );
}

export function SkillsConfig({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => r.json())
      .then((d: { skills?: Skill[]; error?: string }) => {
        if (d.error) { setError(d.error); return; }
        const list = d.skills ?? [];
        setSkills(list);
        if (list.length > 0) setSelected(list[0].filePath);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [cwd]);

  const toggle = useCallback(async (skill: Skill) => {
    const next = !skill.disableModelInvocation;
    setToggling((s) => new Set(s).add(skill.filePath));
    setSaveError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: skill.filePath, disableModelInvocation: next }),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) { setSaveError(d.error ?? `HTTP ${res.status}`); return; }
      setSkills((prev) => prev.map((s) => s.filePath === skill.filePath ? { ...s, disableModelInvocation: next } : s));
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setToggling((s) => { const n = new Set(s); n.delete(skill.filePath); return n; });
    }
  }, []);

  const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: 860, height: "78vh", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Skills</span>
            <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cwd}</code>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* Left: skill list */}
          <div style={{ width: 210, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0, background: "var(--bg-panel)" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
              {loading ? (
                <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>Loading…</div>
              ) : error ? (
                <div style={{ padding: "10px 8px", fontSize: 11, color: "#f87171" }}>{error}</div>
              ) : skills.length === 0 ? (
                <div style={{ padding: "10px 8px", fontSize: 11, color: "var(--text-dim)" }}>No skills found</div>
              ) : ((() => {
                const groups: { label: string; skills: typeof skills }[] = [];
                for (const grpLabel of ["project", "global", "path"]) {
                  const grpSkills = skills.filter((s) => sourceLabel(s) === grpLabel);
                  if (grpSkills.length > 0) groups.push({ label: grpLabel, skills: grpSkills });
                }
                return groups.map(({ label: grpLabel, skills: grpSkills }) => (
                  <div key={grpLabel} style={{ marginBottom: 6 }}>
                    <div style={{ padding: "4px 8px 3px", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {grpLabel}
                    </div>
                    {grpSkills.map((skill) => {
                      const isSelected = selected === skill.filePath;
                      const disabled = skill.disableModelInvocation;
                      return (
                        <div
                          key={skill.filePath}
                          onClick={() => setSelected(skill.filePath)}
                          style={{
                            display: "flex", alignItems: "center", gap: 7,
                            padding: "8px 8px", borderRadius: 5, cursor: "pointer",
                            background: isSelected ? "var(--bg-selected)" : "none",
                          }}
                          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "none"; }}
                        >
                          <span style={{
                            flexShrink: 0, width: 7, height: 7, borderRadius: "50%",
                            background: disabled ? "var(--border)" : "var(--accent)",
                            boxShadow: disabled ? "none" : "0 0 4px var(--accent)",
                            transition: "background 0.15s, box-shadow 0.15s",
                          }} />
                          <span style={{
                            fontSize: 12, fontWeight: isSelected ? 600 : 400,
                            color: disabled ? "var(--text-dim)" : "var(--text)",
                            fontFamily: "var(--font-mono)", flex: 1,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {skill.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ));
              })())}
            </div>
          </div>

          {/* Right: detail */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {loading ? null : selectedSkill ? (
              <SkillDetail
                key={selectedSkill.filePath}
                skill={selectedSkill}
                onToggle={toggle}
                toggling={toggling.has(selectedSkill.filePath)}
                saveError={saveError}
              />
            ) : (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 13 }}>
                Select a skill
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "10px 18px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: "6px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
