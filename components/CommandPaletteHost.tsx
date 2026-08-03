"use client";

import { useEffect, useState, useMemo } from "react";
import { useExtensions } from "@/hooks/useExtensions";
import { useAgentRuntime } from "@/lib/agent-runtime-store";
import { getPanelController, type PanelId } from "@/lib/panel-controller";
import { CommandPalette } from "./CommandPalette";
import type { ExtensionRuntimeContext } from "@/lib/extensions/types";

/**
 * CommandPalette 宿主——挂载 Cmd+K 命令面板并构建 ExtensionRuntimeContext。
 *
 * 历史缺陷（Bug-C）：CommandPalette 组件存在但从未被任何组件渲染（孤儿），
 * 且 ExtensionRuntimeContext 三方法（openExtensionPanel/focusPrompt/openFilePanel）
 * 全项目零实现，导致所有扩展 actions 无法触发。
 *
 * 本组件修复该链路：
 *   - 绑定 Cmd+K / Ctrl+K 开关命令面板
 *   - 构建 context：openExtensionPanel→panel-controller.navigate(localId)，
 *     focusPrompt/openFilePanel 由 AppShell 注入（避免本组件耦合共享核心状态）
 *   - 从 useExtensions 取 actions 渲染 CommandPalette
 *
 * AppShell 仅加一行渲染 + 传入 focusPrompt/openFilePanel 闭包，余皆在本独有文件。
 */

export function CommandPaletteHost({
  session,
  cwd,
  focusPrompt,
  openFilePanel,
}: {
  session: { id: string; cwd?: string; name?: string } | null;
  cwd: string | null;
  focusPrompt: () => void;
  openFilePanel: () => void;
}) {
  const { getActions, getActionDisabledReason } = useExtensions();
  const runtime = useAgentRuntime();
  const [open, setOpen] = useState(false);

  // Cmd+K (macOS) / Ctrl+K (Win/Linux) 开关。全项目此前无此快捷键占用。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const context = useMemo<ExtensionRuntimeContext>(
    () => ({
      state: {
        selectedSession: session ?? undefined,
        selectedCwd: cwd ?? undefined,
        agentRunning: runtime.agentRunning,
        activeTools: runtime.tools.map((t) => t.name),
        sessionStats: runtime.sessionStats,
      },
      focusPrompt,
      openFilePanel,
      openExtensionPanel: (qualifiedId: string) => {
        // qualifiedId 形如 "pi-web-builtin:inspector" → localId "inspector"
        const localId = qualifiedId.split(":")[1] as PanelId | undefined;
        if (localId) getPanelController().navigate(localId);
      },
    }),
    [
      session,
      cwd,
      runtime.agentRunning,
      runtime.tools,
      runtime.sessionStats,
      focusPrompt,
      openFilePanel,
    ],
  );

  const actions = getActions(context);

  return (
    <CommandPalette
      open={open}
      onClose={() => setOpen(false)}
      actions={actions}
      getDisabledReason={getActionDisabledReason}
      context={context}
    />
  );
}
