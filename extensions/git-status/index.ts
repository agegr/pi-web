// pi-web extension: Git Status (降级版 — 方案C)
//
// inspector 已升格为唯一 Git 面板（见 docs/TODO-INSPECTOR-CLEANUP.md），
// 本扩展降级为「入口」，不再注册 workspacePanels（避免与 inspector 重复）：
//   - actions: "Show Git Status" → 切到 inspector tab (pi-web-builtin:inspector)
//   - workspaceLabels: 会话列表分支名
//
// 注意：actions 链路（CommandPalette 挂载 + ExtensionRuntimeContext 三方法实现）
//       当前未通，action 暂不生效；待该链路修复后自动可用。
//       label 链路独立（SessionItem 消费），P-1 修复 window.React 后即生效。
//
// 本源编译为 index.js（手动维护，项目无自动构建脚本）；改本文件须同步 index.js。

const React = (window as unknown as { React: typeof import("react") }).React;

// Minimal context types (matches pi-web's extension API contract).
interface RuntimeContext {
  state: {
    selectedSession?: { id: string; cwd?: string; name?: string } | null;
    selectedCwd?: string | null;
  };
  focusPrompt: () => void;
  openFilePanel: () => void;
  openExtensionPanel: (qualifiedId: string, title?: string) => void;
}

interface LabelContext {
  session?: { worktreeBranch?: string } | null | undefined;
  cwd?: string;
  state: RuntimeContext["state"];
}

const gitStatusExtension = {
  apiVersion: 1 as const,
  name: "Git Status",
  activate: () => ({
    actions: [
      {
        id: "show-status",
        title: "Show Git Status",
        description: "Open the Git panel (inspector)",
        enabled: (ctx: RuntimeContext) => !!ctx.state.selectedCwd,
        disabledReason: (ctx: RuntimeContext) =>
          ctx.state.selectedCwd ? undefined : "No project selected",
        run: (ctx: RuntimeContext) => {
          ctx.openExtensionPanel("pi-web-builtin:inspector", "Git");
        },
      },
    ],
    workspaceLabels: [
      {
        id: "branch-label",
        items: (ctx: LabelContext) => {
          // Read branch from session data (worktreeBranch field).
          const session = ctx.session as { worktreeBranch?: string } | null | undefined;
          const branch = session?.worktreeBranch;
          if (!branch) return [];
          return [
            {
              type: "text" as const,
              text: branch,
              icon: React.createElement(
                "svg",
                {
                  width: 9,
                  height: 9,
                  viewBox: "0 0 24 24",
                  fill: "none",
                  stroke: "currentColor",
                  strokeWidth: 2.4,
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                },
                React.createElement("line", { x1: 6, y1: 3, x2: 6, y2: 15 }),
                React.createElement("circle", { cx: 18, cy: 6, r: 3 }),
                React.createElement("circle", { cx: 6, cy: 18, r: 3 }),
                React.createElement("path", { d: "M18 9a9 9 0 0 1-9 9" }),
              ),
            },
          ];
        },
      },
    ],
  }),
};

export default gitStatusExtension;
