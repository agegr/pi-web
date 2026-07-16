"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import { displayCwd } from "@/lib/session-sidebar";
import { PathLabel } from "./PathLabel";
import { AnimatedDropdown } from "./AnimatedDropdown";

interface ProjectPickerProps {
  dropdownRef: RefObject<HTMLDivElement | null>;
  dropdownOpen: boolean;
  setDropdownOpen: Dispatch<SetStateAction<boolean>>;
  selectedProject: string | null;
  selectedCwd: string | null;
  homeDir: string;
  initialSessionId?: string | null;
  restoredRef: RefObject<boolean>;
  showProjectFilter: boolean;
  projectFilter: string;
  setProjectFilter: Dispatch<SetStateAction<string>>;
  visibleProjects: string[];
  setSelectedCwd: Dispatch<SetStateAction<string | null>>;
  customPathOpen: boolean;
  setCustomPathOpen: Dispatch<SetStateAction<boolean>>;
  customPathValue: string;
  setCustomPathValue: Dispatch<SetStateAction<string>>;
  customPathError: string | null;
  setCustomPathError: Dispatch<SetStateAction<string | null>>;
  customPathValidating: boolean;
  customPathInputRef: RefObject<HTMLInputElement | null>;
  handleDefaultCwd: () => void;
  handleCustomPathClick: () => void;
  commitCustomPath: (candidate?: string) => void | Promise<void>;
}

/** The project (cwd) selector button and its dropdown. Purely presentational:
 *  all state, refs, effects, and handlers live in SessionSidebar and are passed
 *  in, so the shared outside-click effect there keeps owning dropdownRef. */
export function ProjectPicker({
  dropdownRef,
  dropdownOpen,
  setDropdownOpen,
  selectedProject,
  selectedCwd,
  homeDir,
  initialSessionId,
  restoredRef,
  showProjectFilter,
  projectFilter,
  setProjectFilter,
  visibleProjects,
  setSelectedCwd,
  customPathOpen,
  setCustomPathOpen,
  customPathValue,
  setCustomPathValue,
  customPathError,
  setCustomPathError,
  customPathValidating,
  customPathInputRef,
  handleDefaultCwd,
  handleCustomPathClick,
  commitCustomPath,
}: ProjectPickerProps) {
  return (
    <div ref={dropdownRef} style={{ position: "relative" }}>
      <button
        onClick={() => setDropdownOpen((v) => !v)}
        title={selectedProject ?? selectedCwd ?? ""}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          padding: "6px 10px",
          background: selectedCwd ? "var(--bg-hover)" : "rgba(37,99,235,0.06)",
          border: selectedCwd ? "1px solid var(--border)" : "1px solid rgba(37,99,235,0.4)",
          borderRadius: 7,
          cursor: "pointer",
          fontSize: 12,
          color: "var(--text)",
          textAlign: "left",
          transition: "border-color 0.15s, background 0.15s",
        }}
      >
        {selectedCwd ? (
          <PathLabel
            text={displayCwd(selectedProject ?? selectedCwd, homeDir)}
            style={{
              flex: 1,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text)",
            }}
          />
        ) : (
          <span
            style={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-dim)",
            }}
          >
            {initialSessionId && !restoredRef.current ? "" : "Select project…"}
          </span>
        )}
      </button>

      <AnimatedDropdown
        open={dropdownOpen}
        style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          right: 0,
          zIndex: 100,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
          overflow: "hidden",
        }}
      >
          {showProjectFilter && (
            <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
              <input
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setProjectFilter("");
                    setDropdownOpen(false);
                  }
                }}
                placeholder="Filter projects…"
                autoFocus
                style={{
                  width: "100%",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  padding: "5px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  outline: "none",
                  background: "var(--bg)",
                  color: "var(--text)",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}
          <div style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto" }}>
            {visibleProjects.map((project) => (
              <button
                key={project}
                onClick={() => {
                  setSelectedCwd(project);
                  setProjectFilter("");
                  setCustomPathOpen(false);
                  setCustomPathValue("");
                  setCustomPathError(null);
                  setDropdownOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  padding: "8px 10px",
                  background: "var(--bg)",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  color: project === selectedProject ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={project}
              >
                {project === selectedProject && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <polyline points="1.5 5 4 7.5 8.5 2.5" />
                  </svg>
                )}
                {project !== selectedProject && <span style={{ width: 10, flexShrink: 0 }} />}
                <PathLabel text={displayCwd(project, homeDir)} style={{ flex: 1 }} />
              </button>
            ))}
            {visibleProjects.length === 0 && projectFilter.trim() && (
              <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>No matching projects</div>
            )}
          </div>

          {/* Default cwd shortcut */}
          {!customPathOpen && (
            <button
              onClick={(e) => { e.stopPropagation(); handleDefaultCwd(); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                width: "100%",
                padding: "8px 10px",
                background: "none",
                border: "none",
                borderTop: visibleProjects.length > 0 ? "1px solid var(--border)" : "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 11,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
              </svg>
              <span>Use default directory</span>
            </button>
          )}

          {/* Custom path entry */}
          {!customPathOpen ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void handleCustomPathClick();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                width: "100%",
                padding: "8px 10px",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 11,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                <line x1="5" y1="1" x2="5" y2="9" />
                <line x1="1" y1="5" x2="9" y2="5" />
              </svg>
              <span>Custom path…</span>
            </button>
          ) : (
            <div style={{ padding: "6px 8px", borderTop: visibleProjects.length > 0 ? "none" : undefined }}>
              <input
                ref={customPathInputRef}
                value={customPathValue}
                onChange={(e) => {
                  setCustomPathValue(e.target.value);
                  setCustomPathError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitCustomPath();
                  }
                  if (e.key === "Escape") {
                    setCustomPathOpen(false);
                    setCustomPathValue("");
                    setCustomPathError(null);
                  }
                }}
                placeholder="/path/to/project"
                style={{
                  width: "100%",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  padding: "5px 8px",
                  border: "1px solid var(--accent)",
                  borderRadius: 5,
                  outline: "none",
                  background: "var(--bg)",
                  color: "var(--text)",
                  boxSizing: "border-box",
                }}
              />
              {customPathError && (
                <div style={{
                  marginTop: 5,
                  color: "#dc2626",
                  fontSize: 11,
                  lineHeight: 1.35,
                  overflowWrap: "anywhere",
                }}>
                  {customPathError}
                </div>
              )}
              <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                <button
                  onClick={() => void commitCustomPath()}
                  disabled={customPathValidating || !customPathValue.trim()}
                  style={{
                    flex: 1,
                    padding: "4px 0",
                    background: "var(--accent)",
                    border: "none",
                    borderRadius: 5,
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: customPathValidating || !customPathValue.trim() ? "not-allowed" : "pointer",
                    opacity: customPathValidating || !customPathValue.trim() ? 0.65 : 1,
                  }}
                >
                  {customPathValidating ? "Checking…" : "Open"}
                </button>
                <button
                  onClick={() => { setCustomPathOpen(false); setCustomPathValue(""); setCustomPathError(null); }}
                  style={{
                    flex: 1,
                    padding: "4px 0",
                    background: "var(--bg-hover)",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    color: "var(--text-muted)",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
      </AnimatedDropdown>
    </div>
  );
}
