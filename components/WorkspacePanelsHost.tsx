"use client";

// 工作区面板宿主：消费上游扩展系统的 getWorkspacePanels()，把通过扩展机制
// 注册的面板渲染成独立的右侧面板列（与文件面板并列）。这是"面板扩展化"的挂载缝，
// 唯一需要落在 AppShell 的改动就是引入并渲染本组件一次。
//
// 面板内容（Todo / Inspector / 后续 Plan / Engine / Prompts）全部由扩展贡献，
// 本组件不持有任何业务逻辑。
//
// 面板控制层（lib/panel-controller.ts，见 docs/PLAN-ENGINE-INTEGRATION.md 2.4）：
//   - activeId 提权到 controller：外部可 navigate 切换（/plan 发起 → plan tab、
//     confirm 交接 → engine tab），并持久化（刷新回到上次 tab）
//   - 可见性：按 controller.getVisibility() 偏好过滤 + engine 的 comet 探测降级
//   - 徽标：badges 在 tab 上显示未读数（讨论结束 / 引擎完成 → +1）
//
// 注意：panel-controller 以「local id」（builtin 面板的简单名，如 "plan"）为 key，
// 而 QualifiedPanel 只暴露 qualifiedId（"pi-web-builtin:plan"）——此处统一用
// panelLocalId() 提取 local id 对接 controller。

import { useEffect, useState } from "react";
import { useExtensions } from "@/hooks/useExtensions";
import { useI18n } from "@/hooks/useI18n";
import { registerBuiltinExtensions } from "@/lib/extensions/builtin";
import { getPanelController, usePanelController, type PanelId } from "@/lib/panel-controller";
import type { QualifiedPanel, WorkspacePanelContext } from "@/lib/extensions/types";

/** qualifiedId（"pi-web-builtin:plan"）→ local id（"plan"）。 */
function panelLocalId(p: QualifiedPanel): string {
  return p.qualifiedId.split(":")[1] ?? p.qualifiedId;
}

export function WorkspacePanelsHost({
  sessionId,
  cwd,
}: {
  sessionId: string | null;
  cwd: string | null;
}) {
  const { getWorkspacePanels } = useExtensions();
  const { t } = useI18n();
  const { activeId, badges, engineAvailable } = usePanelController();
  const controller = getPanelController();
  const [collapsed, setCollapsed] = useState(false);

  // 注册内置面板 + 异步探测 engine 可用性（comet 缺失则不显示 engine tab）。
  useEffect(() => {
    registerBuiltinExtensions();
    void fetch("/api/engine/available")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => controller.setEngineAvailable(d?.available === true))
      .catch(() => controller.setEngineAvailable(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibility = controller.getVisibility();
  // 可见性过滤：开关偏好 + engine 需 comet 可用（engineAvailable 未知时暂不隐藏）。
  const panels = getWorkspacePanels().filter((p) => {
    const localId = panelLocalId(p);
    if (visibility[localId as PanelId] === false) return false;
    if (localId === "engine" && engineAvailable === false) return false;
    return true;
  });
  if (panels.length === 0) return null;

  // 激活面板：持久化的 activeId 若被隐藏/移除，fallback 到第一个可见面板。
  const active = panels.find((p) => panelLocalId(p) === activeId) ?? panels[0];
  if (!active) return null;

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
        {panels.map((p) => {
          const localId = panelLocalId(p);
          const isActive = localId === panelLocalId(active);
          const badge = badges[localId as PanelId] ?? 0;
          return (
            <button
              key={p.qualifiedId}
              onClick={() => {
                controller.navigate(localId as PanelId);
                if (badge > 0) controller.clearBadge(localId as PanelId);
              }}
              style={{
                position: "relative",
                border: "none",
                background: isActive ? "var(--accent)" : "transparent",
                color: isActive ? "var(--accent-text)" : "var(--text-dim)",
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 12,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {t(p.title)}
              {badge > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -2,
                    minWidth: 14,
                    height: 14,
                    padding: "0 3px",
                    borderRadius: 999,
                    background: "var(--accent)",
                    color: "var(--accent-text)",
                    fontSize: 9,
                    fontWeight: 700,
                    lineHeight: "14px",
                    textAlign: "center",
                    boxSizing: "border-box",
                  }}
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </button>
          );
        })}
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
