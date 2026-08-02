"use client";

// 工作区面板宿主：消费上游扩展系统的 getWorkspacePanels()，把通过扩展机制
// 注册的面板渲染成独立的右侧面板列（与文件面板并列）。这是"面板扩展化"的挂载缝，
// 唯一需要落在 AppShell 的改动就是引入并渲染本组件一次。
//
// 面板内容（Todo / Inspector / 后续 Plan / Engine / Prompts）全部由扩展贡献，
// 本组件不持有任何业务逻辑。

import { useEffect, useState } from "react";
import { useExtensions } from "@/hooks/useExtensions";
import { registerBuiltinExtensions } from "@/lib/extensions/builtin";
import type { WorkspacePanelContext } from "@/lib/extensions/types";

export function WorkspacePanelsHost({
  sessionId,
  cwd,
}: {
  sessionId: string | null;
  cwd: string | null;
}) {
  const { getWorkspacePanels } = useExtensions();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    registerBuiltinExtensions();
  }, []);

  const panels = getWorkspacePanels();
  if (panels.length === 0) return null;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="显示工作区面板"
        style={{
          flexShrink: 0,
          width: 28,
          alignSelf: "stretch",
          border: "none",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg-panel)",
          color: "var(--text-dim)",
          cursor: "pointer",
          writingMode: "vertical-rl",
          fontSize: 12,
        }}
      >
        面板
      </button>
    );
  }

  const active = panels.find((p) => p.qualifiedId === activeId) ?? panels[0];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        width: 340,
        borderLeft: "1px solid var(--border)",
        background: "var(--bg)",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          height: 36,
          padding: "0 4px 0 8px",
          gap: 4,
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          overflowX: "auto",
        }}
      >
        {panels.map((p) => (
          <button
            key={p.qualifiedId}
            onClick={() => setActiveId(p.qualifiedId)}
            style={{
              border: "none",
              background: p.qualifiedId === active.qualifiedId ? "var(--accent)" : "transparent",
              color:
                p.qualifiedId === active.qualifiedId ? "var(--accent-text)" : "var(--text-dim)",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {p.title}
          </button>
        ))}
        <button
          onClick={() => setCollapsed(true)}
          title="收起"
          style={{
            marginLeft: "auto",
            border: "none",
            background: "transparent",
            color: "var(--text-dim)",
            cursor: "pointer",
            fontSize: 14,
            padding: "0 6px",
          }}
        >
          ×
        </button>
      </div>
      <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: 8 }}>
        {active.render({
          session: sessionId ? { id: sessionId } : null,
          cwd: cwd ?? undefined,
          state: {} as WorkspacePanelContext["state"],
          requestRender: () => {},
        })}
      </div>
    </div>
  );
}
