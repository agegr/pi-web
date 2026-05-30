/**
 * Hashline 客户端帮助函数
 * 
 * 提供在浏览器端使用 hashline 工具的便捷方法
 */

// ============================================================================
// 类型定义
// ============================================================================

export interface HashlineReadResult {
  content: string;
  header: string;
  tag: string;
  formatted: string;
}

export interface HashlineEditResult {
  success: boolean;
  results: Array<{
    path: string;
    op: string;
  }>;
  error?: string;
}

export interface HashlineToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  details?: {
    diff?: string;
    [key: string]: unknown;
  };
}

// 客户端不需要导入服务端模块

// ============================================================================
// API 调用函数
// ============================================================================

/**
 * 读取文件并返回带哈希头的内容
 */
export async function hashlineRead(
  filePath: string,
  cwd?: string
): Promise<HashlineToolResult> {
  const res = await fetch("/api/hashline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "read",
      path: filePath,
      cwd,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: HashlineToolResult;
    error?: string;
  };

  if (!res.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return body.data as HashlineToolResult;
}

/**
 * 应用 hashline 补丁
 */
export async function hashlineEdit(
  patchInput: string,
  cwd?: string
): Promise<HashlineToolResult> {
  const res = await fetch("/api/hashline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "edit",
      input: patchInput,
      cwd,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: HashlineToolResult;
    error?: string;
  };

  if (!res.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return body.data as HashlineToolResult;
}

// ============================================================================
// 工具定义（兼容 pi-coding-agent 格式）
// ============================================================================

export const hashlineReadTool = {
  name: "hashline-read",
  description:
    "Read a file and return content with hashline header for precise editing",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to read",
      },
    },
    required: ["path"],
  },
  execute: hashlineRead,
};

export const hashlineEditTool = {
  name: "hashline-edit",
  description:
    "Edit a file using hashline format for precise, unambiguous references",
  parameters: {
    type: "object",
    properties: {
      input: {
        type: "string",
        description:
          'Hashline patch input (¶PATH#TAG\\nA B\\n+TEXT)',
      },
    },
    required: ["input"],
  },
  execute: hashlineEdit,
};

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 生成简单的补丁
 */
export function generateHashlinePatch(
  filePath: string,
  tag: string,
  edits: Array<{
    startLine: number;
    endLine: number;
    newText?: string;
    keepLines?: boolean;
  }>
): string {
  let patch = `¶${filePath}#${tag}\n`;

  for (const edit of edits) {
    patch += `${edit.startLine} ${edit.endLine}\n`;

    if (edit.keepLines) {
      // 保留原始行
      for (let i = edit.startLine; i <= edit.endLine; i++) {
        patch += `&${i}\n`;
      }
    }

    if (edit.newText) {
      // 添加新行
      const newLines = edit.newText.split("\n");
      for (const line of newLines) {
        patch += `+${line}\n`;
      }
    }
  }

  return patch;
}

/**
 * 解析 hashline 头
 */
export function parseHashlineHeader(header: string): {
  path: string;
  tag: string;
} | null {
  const match = header.match(/^¶(.+)#([0-9A-F]{3})$/);
  if (!match) return null;
  return { path: match[1], tag: match[2] };
}
