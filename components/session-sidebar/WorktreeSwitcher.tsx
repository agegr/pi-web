"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import { displayCwd } from "@/lib/session-sidebar";
import { PathLabel } from "./PathLabel";
import { AnimatedDropdown } from "./AnimatedDropdown";
import type { WorktreeState } from "./types";

interface WorktreeSwitcherProps {
  showWorktreeSwitcher: boolean;
  worktreeState: WorktreeState | null;
  selectedCwd: string | null;
  homeDir: string;
  wtDropdownRef: RefObject<HTMLDivElement | null>;
  wtDropdownOpen: boolean;
  setWtDropdownOpen: Dispatch<SetStateAction<boolean>>;
  wtConfirmRemove: string | null;
  setWtConfirmRemove: Dispatch<SetStateAction<string | null>>;
  wtBusy: boolean;
  handleRemoveWorktree: (path: string, force: boolean) => void | Promise<void>;
  setSelectedCwd: Dispatch<SetStateAction<string | null>>;
  wtError: string | null;
  setWtError: Dispatch<SetStateAction<string | null>>;
  wtNewOpen: boolean;
  setWtNewOpen: Dispatch<SetStateAction<boolean>>;
  wtNewInputRef: RefObject<HTMLInputElement | null>;
  wtNewBranch: string;
  setWtNewBranch: Dispatch<SetStateAction<string>>;
  handleCreateWorktree: () => void | Promise<void>;
  inactiveWorktreeSelector: { label: string; title: string } | null;
}

/** The git worktree switcher (and the disabled placeholder shown when the
 *  current cwd is not a worktree-capable checkout). Purely presentational:
 *  state, refs, and handlers live in SessionSidebar so the shared outside-click
 *  effect there keeps owning wtDropdownRef. */
export function WorktreeSwitcher({
  showWorktreeSwitcher,
  worktreeState,
  selectedCwd,
  homeDir,
  wtDropdownRef,
  wtDropdownOpen,
  setWtDropdownOpen,
  wtConfirmRemove,
  setWtConfirmRemove,
  wtBusy,
  handleRemoveWorktree,
  setSelectedCwd,
  wtError,
  setWtError,
  wtNewOpen,
  setWtNewOpen,
  wtNewInputRef,
  wtNewBranch,
  setWtNewBranch,
  handleCreateWorktree,
  inactiveWorktreeSelector,
}: WorktreeSwitcherProps) {
  return (
    <>
      {showWorktreeSwitcher && worktreeState && (() => {
        const currentWt = worktreeState.worktrees.find((w) => w.path === selectedCwd)
          ?? worktreeState.worktrees.find((w) => w.isMain);
        return (
          <div ref={wtDropdownRef} style={{ position: "relative", marginTop: 6 }}>
            <button
              onClick={() => setWtDropdownOpen((v) => !v)}
              title={currentWt ? `Switch worktree: ${currentWt.path}` : "Switch worktree"}
              style={{
                width: "100%",
                height: 29,
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 10px",
                background: "var(--bg-hover)",
                border: "1px solid var(--border)",
                borderRadius: 7,
                cursor: "pointer",
                fontSize: 11,
                lineHeight: 1.35,
                color: "var(--text-muted)",
                textAlign: "left",
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: currentWt && !currentWt.isMain ? "var(--accent)" : "var(--text-dim)" }}>
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              <PathLabel
                text={currentWt ? (currentWt.branch ?? displayCwd(currentWt.path, homeDir)) : "…"}
                style={{ flex: 1, fontFamily: "var(--font-mono)", color: "var(--text)" }}
              />
              {currentWt?.isMain && (
                <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>main</span>
              )}
              {worktreeState.worktrees.length > 1 && (
                <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>
                  {worktreeState.worktrees.length}
                </span>
              )}
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>

            <AnimatedDropdown
              open={wtDropdownOpen}
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
                <div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
                  {worktreeState.worktrees.map((wt) => {
                    const isCurrent = wt.path === selectedCwd || (wt.isMain && !worktreeState.worktrees.some((w) => w.path === selectedCwd));
                    if (wtConfirmRemove === wt.path) {
                      return (
                        <div key={wt.path} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "rgba(239,68,68,0.06)" }}>
                          <span style={{ flex: 1, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            Uncommitted changes. Force remove checkout?
                          </span>
                          <button
                            onClick={() => void handleRemoveWorktree(wt.path, true)}
                            disabled={wtBusy}
                            style={{ padding: "3px 9px", background: "#ef4444", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                          >
                            Force
                          </button>
                          <button
                            onClick={() => setWtConfirmRemove(null)}
                            style={{ padding: "3px 9px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
                          >
                            Cancel
                          </button>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={wt.path}
                        className="wt-row"
                        style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)" }}
                      >
                        <button
                          onClick={() => {
                            setSelectedCwd(wt.path);
                            setWtDropdownOpen(false);
                            setWtError(null);
                          }}
                          title={wt.path}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            padding: "8px 10px",
                            background: "var(--bg)",
                            border: "none",
                            color: isCurrent ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer",
                            textAlign: "left",
                            fontSize: 11,
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {isCurrent ? (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <polyline points="1.5 5 4 7.5 8.5 2.5" />
                            </svg>
                          ) : (
                            <span style={{ width: 10, flexShrink: 0 }} />
                          )}
                          <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} style={{ flex: 1 }} />
                          {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>main</span>}
                        </button>
                        {!wt.isMain && (
                          <button
                            onClick={() => void handleRemoveWorktree(wt.path, false)}
                            disabled={wtBusy}
                            title={`Remove worktree checkout ${wt.path}; the branch is kept`}
                            style={{
                              display: "flex", alignItems: "center", justifyContent: "center",
                              width: 34, height: 28, padding: 0, marginRight: 4,
                              background: "none", border: "none",
                              color: "var(--text-dim)", cursor: "pointer",
                              borderRadius: 5, flexShrink: 0,
                              transition: "color 0.12s, background 0.12s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {!wtNewOpen ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setWtNewOpen(true);
                      setWtError(null);
                      setTimeout(() => wtNewInputRef.current?.focus(), 0);
                    }}
                    title="Create a worktree checkout for a branch"
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
                    <span>New worktree…</span>
                  </button>
                ) : (
                  <div style={{ padding: "6px 8px" }}>
                    <input
                      ref={wtNewInputRef}
                      value={wtNewBranch}
                      onChange={(e) => {
                        setWtNewBranch(e.target.value);
                        setWtError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleCreateWorktree();
                        }
                        if (e.key === "Escape") {
                          setWtNewOpen(false);
                          setWtNewBranch("");
                          setWtError(null);
                        }
                      }}
                      placeholder="branch name"
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
                    <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                      <button
                        onClick={() => void handleCreateWorktree()}
                        disabled={wtBusy || !wtNewBranch.trim()}
                        style={{
                          flex: 1,
                          padding: "4px 0",
                          background: "var(--accent)",
                          border: "none",
                          borderRadius: 5,
                          color: "#fff",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: wtBusy || !wtNewBranch.trim() ? "not-allowed" : "pointer",
                          opacity: wtBusy || !wtNewBranch.trim() ? 0.65 : 1,
                        }}
                      >
                        {wtBusy ? "Creating…" : "Create"}
                      </button>
                      <button
                        onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }}
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
                {wtError && (
                  <div style={{
                    padding: "5px 10px 8px",
                    color: "#dc2626",
                    fontSize: 11,
                    lineHeight: 1.35,
                    overflowWrap: "anywhere",
                  }}>
                    {wtError}
                  </div>
                )}
            </AnimatedDropdown>
          </div>
        );
      })()}
      {inactiveWorktreeSelector && (
        <button
          type="button"
          aria-disabled="true"
          tabIndex={-1}
          title={inactiveWorktreeSelector.title}
          style={{
            width: "100%",
            height: 29,
            boxSizing: "border-box",
            marginTop: 6,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 10px",
            border: "1px solid var(--border)",
            borderRadius: 7,
            background: "var(--bg-hover)",
            color: "var(--text-dim)",
            fontSize: 11,
            lineHeight: 1.35,
            whiteSpace: "nowrap",
            textAlign: "left",
            cursor: "default",
            opacity: 0.82,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{inactiveWorktreeSelector.label}</span>
        </button>
      )}
    </>
  );
}
