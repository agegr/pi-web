// extensions/git-status/index.ts (降级版 — 方案C，手动编译产物)
// 手动维护；改 index.ts 须同步本文件。项目无自动构建脚本。
var React = window.React;
var gitStatusExtension = {
  apiVersion: 1,
  name: "Git Status",
  activate: () => ({
    actions: [
      {
        id: "show-status",
        title: "Show Git Status",
        description: "Open the Git panel (inspector)",
        enabled: (ctx) => !!ctx.state.selectedCwd,
        disabledReason: (ctx) => (ctx.state.selectedCwd ? void 0 : "No project selected"),
        run: (ctx) => {
          ctx.openExtensionPanel("pi-web-builtin:inspector", "Git");
        },
      },
    ],
    workspaceLabels: [
      {
        id: "branch-label",
        items: (ctx) => {
          const session = ctx.session;
          const branch = session?.worktreeBranch;
          if (!branch) return [];
          return [
            {
              type: "text",
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
var index_default = gitStatusExtension;
export { index_default as default };
