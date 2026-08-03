"use client";

// 内置工作区面板（我们独有的 UI 增强）通过上游扩展机制挂载，
// 而不是在 AppShell 里直接渲染——这是"解耦"的核心：AppShell 只引入一个
// <WorkspacePanelsHost/>，所有面板逻辑集中在这里与对应组件，跟随上游时零冲突。
//
// 后续接回 PlanPanel / EngineDashboard / PromptsConfig 时，只需在此追加
// workspacePanels 项（或各自注册独立 built-in 扩展），无需再改 AppShell。

import { getExtensionRegistry } from "./registry";
import type { PiWebExtension } from "./types";
import { TodoPanel } from "@/components/TodoPanel";
import { InspectorPanel } from "@/components/InspectorPanel";
import { PromptsConfig } from "@/components/PromptsConfig";
import { PlanPanel } from "@/components/PlanPanel";
import { EngineDashboard } from "@/components/EngineDashboard";

const BUILTIN_ID = "pi-web-builtin";

export function registerBuiltinExtensions(): void {
  const reg = getExtensionRegistry();
  if (reg.list().some((e) => e.id === BUILTIN_ID)) return;

  const ext: PiWebExtension = {
    apiVersion: 1,
    name: "pi-web-builtin",
    activate: () => ({
      workspacePanels: [
        {
          id: "todo",
          title: "todo.panel",
          order: 1100,
          render: () => <TodoPanel />,
        },
        {
          id: "inspector",
          title: "inspector.panel",
          order: 1200,
          render: (ctx) => (
            <InspectorPanel
              sessionId={ctx.session?.id ?? null}
              cwd={ctx.cwd ?? null}
              open
              onToggle={() => {}}
            />
          ),
        },
        {
          id: "prompts",
          title: "prompts.panel",
          order: 1300,
          render: (ctx) => <PromptsConfig cwd={ctx.cwd ?? null} onClose={() => {}} />,
        },
        {
          id: "plan",
          title: "plan.panel",
          order: 1400,
          render: () => <PlanPanel />,
        },
        {
          id: "engine",
          title: "engine.panel",
          order: 1500,
          render: () => <EngineDashboard />,
        },
      ],
    }),
  };

  reg.register(ext, { id: BUILTIN_ID, source: "bundled" });
}
