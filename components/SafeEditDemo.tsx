/**
 * 安全编辑演示组件
 * 
 * 展示如何使用安全编辑系统防止自修改导致崩溃
 */

"use client";

import { useState } from "react";
import { useSafeEdit, type SafeEditResult, type BackupInfo } from "@/hooks/useSafeEdit";

export function SafeEditDemo() {
  const {
    loading,
    error,
    clearError,
    checkSafety,
    safeEditFile,
    listBackups,
    cleanupBackups,
  } = useSafeEdit();

  const [filePath, setFilePath] = useState("components/SafeEditDemo.tsx");
  const [newContent, setNewContent] = useState("");
  const [safetyResult, setSafetyResult] = useState<{
    safe: boolean;
    warnings: string[];
    suggestions: string[];
  } | null>(null);
  const [editResult, setEditResult] = useState<SafeEditResult | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);

  // 检查安全性
  const handleCheckSafety = async () => {
    if (!newContent.trim()) {
      alert("请输入新内容");
      return;
    }

    const result = await checkSafety(filePath, newContent);
    setSafetyResult(result);
  };

  // 安全编辑
  const handleSafeEdit = async () => {
    if (!newContent.trim()) {
      alert("请输入新内容");
      return;
    }

    const result = await safeEditFile(filePath, newContent, {
      autoBackup: true,
      runTypeCheck: true,
      autoRestore: true,
    });

    setEditResult(result);

    if (result?.success) {
      alert("编辑成功！");
    }
  };

  // 列出备份
  const handleListBackups = async () => {
    const result = await listBackups();
    if (result) {
      setBackups(result);
    }
  };

  // 清理备份
  const handleCleanupBackups = async () => {
    const result = await cleanupBackups(10);
    if (result) {
      alert(`已清理 ${result.deletedCount} 个备份`);
      await handleListBackups();
    }
  };

  return (
    <div
      style={{
        padding: 20,
        maxWidth: 800,
        margin: "0 auto",
      }}
    >
      <h1
        style={{
          fontSize: 24,
          fontWeight: 700,
          marginBottom: 20,
          color: "var(--text)",
        }}
      >
        安全编辑演示
      </h1>

      <div
        style={{
          marginBottom: 20,
          padding: 16,
          background: "var(--bg-panel)",
          borderRadius: 8,
          border: "1px solid var(--border)",
        }}
      >
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            marginBottom: 12,
            color: "var(--text)",
          }}
        >
          文件编辑
        </h2>

        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              marginBottom: 4,
              fontSize: 14,
              color: "var(--text-muted)",
            }}
          >
            文件路径：
          </label>
          <input
            type="text"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="文件路径"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 14,
            }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              marginBottom: 4,
              fontSize: 14,
              color: "var(--text-muted)",
            }}
          >
            新内容：
          </label>
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="输入新的文件内容"
            rows={10}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 14,
              fontFamily: "var(--font-mono)",
              resize: "vertical",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleCheckSafety}
            disabled={loading}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "white",
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "检查中..." : "检查安全性"}
          </button>
          <button
            onClick={handleSafeEdit}
            disabled={loading}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: "rgb(34,197,94)",
              color: "white",
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "编辑中..." : "安全编辑"}
          </button>
        </div>
      </div>

      {safetyResult && (
        <div
          style={{
            marginBottom: 20,
            padding: 16,
            background: safetyResult.safe
              ? "rgba(34,197,94,0.1)"
              : "rgba(239,68,68,0.1)",
            borderRadius: 8,
            border: `1px solid ${safetyResult.safe ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
          }}
        >
          <h3
            style={{
              fontSize: 16,
              fontWeight: 600,
              marginBottom: 8,
              color: safetyResult.safe ? "rgb(34,197,94)" : "rgb(239,68,68)",
            }}
          >
            {safetyResult.safe ? "✅ 安全检查通过" : "⚠️ 安全检查警告"}
          </h3>

          {safetyResult.warnings.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <strong style={{ color: "var(--text)" }}>警告：</strong>
              <ul style={{ margin: "4px 0 0 20px", color: "var(--text-muted)" }}>
                {safetyResult.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {safetyResult.suggestions.length > 0 && (
            <div>
              <strong style={{ color: "var(--text)" }}>建议：</strong>
              <ul style={{ margin: "4px 0 0 20px", color: "var(--text-muted)" }}>
                {safetyResult.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {editResult && (
        <div
          style={{
            marginBottom: 20,
            padding: 16,
            background: editResult.success
              ? "rgba(34,197,94,0.1)"
              : "rgba(239,68,68,0.1)",
            borderRadius: 8,
            border: `1px solid ${editResult.success ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
          }}
        >
          <h3
            style={{
              fontSize: 16,
              fontWeight: 600,
              marginBottom: 8,
              color: editResult.success ? "rgb(34,197,94)" : "rgb(239,68,68)",
            }}
          >
            {editResult.success ? "✅ 编辑成功" : "❌ 编辑失败"}
          </h3>

          {editResult.backupPath && (
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
              备份路径：{editResult.backupPath}
            </p>
          )}

          {editResult.errors && editResult.errors.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <strong style={{ color: "var(--text)" }}>错误：</strong>
              <ul style={{ margin: "4px 0 0 20px", color: "rgb(239,68,68)" }}>
                {editResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {editResult.warnings && editResult.warnings.length > 0 && (
            <div>
              <strong style={{ color: "var(--text)" }}>警告：</strong>
              <ul style={{ margin: "4px 0 0 20px", color: "var(--text-muted)" }}>
                {editResult.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div
        style={{
          marginBottom: 20,
          padding: 16,
          background: "var(--bg-panel)",
          borderRadius: 8,
          border: "1px solid var(--border)",
        }}
      >
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            marginBottom: 12,
            color: "var(--text)",
          }}
        >
          备份管理
        </h2>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            onClick={handleListBackups}
            disabled={loading}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "white",
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            列出备份
          </button>
          <button
            onClick={handleCleanupBackups}
            disabled={loading}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: "rgb(239,68,68)",
              color: "white",
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            清理旧备份
          </button>
        </div>

        {backups.length > 0 && (
          <div
            style={{
              padding: 12,
              background: "var(--bg)",
              borderRadius: 6,
              border: "1px solid var(--border)",
              maxHeight: 200,
              overflowY: "auto",
            }}
          >
            {backups.map((backup, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 0",
                  borderBottom:
                    i < backups.length - 1
                      ? "1px solid var(--border)"
                      : "none",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    color: "var(--text)",
                    fontSize: 14,
                  }}
                >
                  {backup.file}
                </div>
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 12,
                  }}
                >
                  {backup.timestamp}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: 16,
            background: "rgba(239,68,68,0.1)",
            borderRadius: 8,
            border: "1px solid rgba(239,68,68,0.3)",
            color: "rgb(239,68,68)",
            fontSize: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{error}</span>
            <button
              onClick={clearError}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                border: "none",
                background: "rgba(239,68,68,0.2)",
                color: "rgb(239,68,68)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              关闭
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: 20,
          padding: 16,
          background: "var(--bg-panel)",
          borderRadius: 8,
          border: "1px solid var(--border)",
        }}
      >
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            marginBottom: 12,
            color: "var(--text)",
          }}
        >
          功能说明
        </h2>

        <div
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--text-muted)",
          }}
        >
          <p style={{ marginBottom: 8 }}>
            <strong>1. 安全检查：</strong>编辑前检查是否是关键文件，评估风险
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong>2. 自动备份：</strong>编辑前自动创建备份，崩溃后可恢复
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong>3. 类型检查：</strong>编辑后自动运行 TypeScript 类型检查
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong>4. 自动恢复：</strong>类型检查失败时自动恢复备份
          </p>
          <p>
            <strong>5. 备份管理：</strong>列出和清理旧备份
          </p>
        </div>
      </div>
    </div>
  );
}
