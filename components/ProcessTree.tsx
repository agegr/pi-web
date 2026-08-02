"use client";

// ProcessTree —— 进程树看板（M5 / Q14）
// 渲染统一状态面的 processTree 切片：父子进程关系 + 状态 + 资源占用（best-effort）。
import { useI18n } from "@/hooks/useI18n";
import type { ProcessNode } from "@/lib/unified-engine/unified-engine-types";

const STATUS_COLOR: Record<ProcessNode["status"], string> = {
  running: "var(--accent)",
  exited: "var(--text-dim)",
  killed: "#EF4444",
};

export function ProcessTree({ processTree }: { processTree: ProcessNode[] }) {
  const { t } = useI18n();

  // 构建 pid → 子节点列表，渲染为缩进树。
  const childrenOf = new Map<number, ProcessNode[]>();
  const roots: ProcessNode[] = [];
  for (const n of processTree) {
    if (n.ppid && n.ppid !== n.pid && processTree.some((p) => p.pid === n.ppid)) {
      const arr = childrenOf.get(n.ppid) ?? [];
      arr.push(n);
      childrenOf.set(n.ppid, arr);
    } else {
      roots.push(n);
    }
  }

  const renderNode = (n: ProcessNode, depth: number): React.ReactNode => (
    <div key={n.pid} style={{ paddingLeft: depth * 14 }}>
      <span style={{ color: STATUS_COLOR[n.status], fontWeight: 600 }}>●</span>{" "}
      <span style={{ color: "var(--text)" }}>{n.title || `pid ${n.pid}`}</span>{" "}
      <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
        pid={n.pid}
        {n.ppid ? ` ppid=${n.ppid}` : ""}
        {typeof n.cpu === "number" ? ` cpu=${n.cpu}%` : ""}
        {typeof n.memMb === "number" ? ` mem=${n.memMb}MB` : ""}
      </span>
      {(childrenOf.get(n.pid) ?? []).map((c) => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 0,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
        {t("engine.processTree")}
      </div>
      <div
        style={{
          overflowY: "auto",
          maxHeight: 240,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {processTree.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            {t("engine.processTreeEmpty")}
          </div>
        ) : (
          roots.map((r) => renderNode(r, 0))
        )}
      </div>
    </div>
  );
}
