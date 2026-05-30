/**
 * Hashline 工具 - 基于 @oh-my-pi/hashline 的编辑工具
 * 
 * 提供比传统 str_replace 更强大的编辑能力
 */

import * as fs from "fs/promises";
import * as path from "path";

// 动态导入 @oh-my-pi/hashline 以避免 Turbopack 问题
let hashlineModule: any = null;

async function getHashlineModule() {
  if (!hashlineModule) {
    try {
      hashlineModule = await import("@oh-my-pi/hashline");
    } catch (error) {
      console.error("Failed to load @oh-my-pi/hashline:", error);
      throw new Error("Hashline module not available");
    }
  }
  return hashlineModule;
}

// ============================================================================
// 磁盘文件系统实现
// ============================================================================

class NodeFilesystem {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async readText(filePath: string): Promise<string> {
    const absolutePath = this.resolvePath(filePath);
    return await fs.readFile(absolutePath, "utf-8");
  }

  async writeText(filePath: string, content: string) {
    const absolutePath = this.resolvePath(filePath);
    await fs.writeFile(absolutePath, content, "utf-8");
    return { text: content };
  }

  canonicalPath(filePath: string): string {
    return this.resolvePath(filePath);
  }

  async preflightWrite(filePath: string): Promise<void> {
    const absolutePath = this.resolvePath(filePath);
    const dir = path.dirname(absolutePath);
    await fs.mkdir(dir, { recursive: true });
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.resolve(this.cwd, filePath);
  }
}

// ============================================================================
// Hashline 工具管理器
// ============================================================================

export class HashlineToolManager {
  private fs: NodeFilesystem;
  private snapshots: any;
  private patcher: any;
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.fs = new NodeFilesystem(cwd);
    this.snapshots = null;
    this.patcher = null;
  }

  private async init() {
    if (!this.patcher) {
      const { InMemorySnapshotStore, Patcher } = await getHashlineModule();
      this.snapshots = new InMemorySnapshotStore();
      this.patcher = new Patcher({ fs: this.fs, snapshots: this.snapshots });
    }
  }

  /**
   * 读取文件并返回带哈希头的内容
   */
  async readFile(filePath: string): Promise<{
    content: string;
    header: string;
    tag: string;
    formatted: string;
  }> {
    await this.init();
    const { formatHashlineHeader, formatNumberedLines } = await getHashlineModule();
    
    const content = await this.fs.readText(filePath);
    const absolutePath = this.fs.canonicalPath(filePath);
    const lines = content.split("\n");

    const tag = this.snapshots.recordContiguous(absolutePath, 1, lines, {
      fullText: content,
    });
    const header = formatHashlineHeader(filePath, tag);
    const formatted = formatNumberedLines(content);

    return {
      content,
      header,
      tag,
      formatted,
    };
  }

  /**
   * 应用 hashline 补丁
   */
  async applyPatch(patchInput: string): Promise<{
    success: boolean;
    results: Array<{
      path: string;
      op: string;
      diff?: string;
    }>;
    error?: string;
  }> {
    try {
      await this.init();
      const { Patch } = await getHashlineModule();
      
      const patch = Patch.parse(patchInput);
      const result = await this.patcher.apply(patch);

      return {
        success: true,
        results: result.sections.map((s: any) => ({
          path: s.path,
          op: s.op,
        })),
      };
    } catch (error) {
      return {
        success: false,
        results: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 生成简单的补丁
   */
  generatePatch(
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
}

// ============================================================================
// 工具定义
// ============================================================================

export const hashlineReadToolDefinition = {
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
};

export const hashlineEditToolDefinition = {
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
};

// ============================================================================
// 工具执行器
// ============================================================================

export interface ToolExecutionResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  details?: {
    diff?: string;
    [key: string]: unknown;
  };
}

/**
 * 执行 hashline-read 工具
 */
export async function executeHashlineRead(
  args: { path: string },
  cwd: string
): Promise<ToolExecutionResult> {
  try {
    const manager = new HashlineToolManager(cwd);
    const result = await manager.readFile(args.path);

    return {
      content: [
        {
          type: "text",
          text: `${result.header}\n${result.formatted}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

/**
 * 执行 hashline-edit 工具
 */
export async function executeHashlineEdit(
  args: { input: string },
  cwd: string
): Promise<ToolExecutionResult> {
  try {
    const manager = new HashlineToolManager(cwd);
    const result = await manager.applyPatch(args.input);

    if (!result.success) {
      return {
        content: [
          {
            type: "text",
            text: `Error applying patch: ${result.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Successfully applied patch to ${result.results.map((r) => r.path).join(", ")}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error applying patch: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

// ============================================================================
// 导出给 pi-web 使用
// ============================================================================

export {
  NodeFilesystem,
  getHashlineModule,
};
