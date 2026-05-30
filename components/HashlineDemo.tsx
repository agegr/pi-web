/**
 * Hashline 演示组件
 * 
 * 展示如何在 pi-web 中使用 hashline 工具
 */

"use client";

import { useState } from "react";
import { useHashline } from "@/hooks/useHashline";

export function HashlineDemo() {
  const { loading, error, readFile, editFile, generatePatch, clearError } =
    useHashline();

  const [filePath, setFilePath] = useState("src/example.ts");
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileHeader, setFileHeader] = useState<string | null>(null);
  const [fileTag, setFileTag] = useState<string | null>(null);
  const [editResult, setEditResult] = useState<string | null>(null);

  // 读取文件
  const handleReadFile = async () => {
    const result = await readFile(filePath);
    if (result) {
      setFileContent(result.formatted);
      setFileHeader(result.header);
      setFileTag(result.tag);
    }
  };

  // 编辑文件
  const handleEditFile = async () => {
    if (!fileHeader || !fileTag) {
      alert("请先读取文件");
      return;
    }

    // 生成补丁：修改第 2 行
    const patch = generatePatch(filePath, fileTag, [
      {
        startLine: 2,
        endLine: 2,
        newText: '  return "universe";',
      },
    ]);

    const result = await editFile(patch);
    if (result) {
      setEditResult(
        result.success ? "编辑成功！" : `编辑失败: ${result.error}`
      );

      // 重新读取文件
      if (result.success) {
        await handleReadFile();
      }
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
        Hashline 演示
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
          读取文件
        </h2>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="文件路径"
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 14,
            }}
          />
          <button
            onClick={handleReadFile}
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
            {loading ? "读取中..." : "读取"}
          </button>
        </div>

        {fileContent && (
          <div
            style={{
              padding: 12,
              background: "var(--bg)",
              borderRadius: 6,
              border: "1px solid var(--border)",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              overflowX: "auto",
            }}
          >
            {fileHeader && (
              <div
                style={{
                  marginBottom: 8,
                  padding: "4px 8px",
                  background: "var(--accent)",
                  color: "white",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {fileHeader}
              </div>
            )}
            {fileContent}
          </div>
        )}
      </div>

      {fileContent && (
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
            编辑文件
          </h2>

          <p
            style={{
              marginBottom: 12,
              fontSize: 14,
              color: "var(--text-muted)",
            }}
          >
            点击按钮修改第 2 行内容
          </p>

          <button
            onClick={handleEditFile}
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
            {loading ? "编辑中..." : "编辑第 2 行"}
          </button>

          {editResult && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                background: editResult.includes("成功")
                  ? "rgba(34,197,94,0.1)"
                  : "rgba(239,68,68,0.1)",
                borderRadius: 6,
                border: `1px solid ${editResult.includes("成功") ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                color: editResult.includes("成功")
                  ? "rgb(34,197,94)"
                  : "rgb(239,68,68)",
                fontSize: 14,
              }}
            >
              {editResult}
            </div>
          )}
        </div>
      )}

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
          Hashline 格式说明
        </h2>

        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--text)",
          }}
        >
          <p style={{ marginBottom: 8 }}>
            <strong>文件头:</strong> ¶PATH#TAG
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong>锚点:</strong> A B (选择行 A..B)
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong>添加行:</strong> +TEXT
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong>复制行:</strong> &A..B
          </p>
          <p>
            <strong>删除行:</strong> 空行
          </p>
        </div>
      </div>
    </div>
  );
}
