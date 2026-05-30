/**
 * Hashline React Hook
 * 
 * 提供在 React 组件中使用 hashline 工具的便捷方法
 */

"use client";

import { useState, useCallback } from "react";
import {
  hashlineRead,
  hashlineEdit,
  generateHashlinePatch,
  parseHashlineHeader,
  type HashlineReadResult,
  type HashlineEditResult,
  type HashlineToolResult,
} from "@/lib/hashline-client";

// ============================================================================
// Hook 类型定义
// ============================================================================

export interface UseHashlineOptions {
  cwd?: string;
}

export interface UseHashlineReturn {
  // 状态
  loading: boolean;
  error: string | null;

  // 操作
  readFile: (filePath: string) => Promise<HashlineReadResult | null>;
  editFile: (patchInput: string) => Promise<HashlineEditResult | null>;
  generatePatch: (
    filePath: string,
    tag: string,
    edits: Array<{
      startLine: number;
      endLine: number;
      newText?: string;
      keepLines?: boolean;
    }>
  ) => string;
  parseHeader: (header: string) => { path: string; tag: string } | null;

  // 工具函数
  clearError: () => void;
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useHashline(options: UseHashlineOptions = {}): UseHashlineReturn {
  const { cwd } = options;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const readFile = useCallback(
    async (filePath: string): Promise<HashlineReadResult | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await hashlineRead(filePath, cwd);

        // 解析结果
        const text = result.content[0]?.text || "";
        const lines = text.split("\n");
        const header = lines[0];
        const formatted = lines.slice(1).join("\n");

        const parsed = parseHashlineHeader(header);
        if (!parsed) {
          throw new Error("Invalid hashline header");
        }

        return {
          content: formatted,
          header,
          tag: parsed.tag,
          formatted,
        };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        setError(errorMessage);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [cwd]
  );

  const editFile = useCallback(
    async (patchInput: string): Promise<HashlineEditResult | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await hashlineEdit(patchInput, cwd);

        // 解析结果
        const text = result.content[0]?.text || "";
        const success = !text.startsWith("Error");

        return {
          success,
          results: [], // 简化处理
          error: success ? undefined : text,
        };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        setError(errorMessage);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [cwd]
  );

  const generatePatch = useCallback(
    (
      filePath: string,
      tag: string,
      edits: Array<{
        startLine: number;
        endLine: number;
        newText?: string;
        keepLines?: boolean;
      }>
    ): string => {
      return generateHashlinePatch(filePath, tag, edits);
    },
    []
  );

  const parseHeader = useCallback(
    (header: string): { path: string; tag: string } | null => {
      return parseHashlineHeader(header);
    },
    []
  );

  return {
    loading,
    error,
    readFile,
    editFile,
    generatePatch,
    parseHeader,
    clearError,
  };
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 格式化 hashline 内容用于显示
 */
export function formatHashlineContent(content: string): string {
  return content;
}

/**
 * 从 hashline 内容中提取行号
 */
export function extractLineNumbers(content: string): number[] {
  const lines = content.split("\n");
  const lineNumbers: number[] = [];

  for (const line of lines) {
    const match = line.match(/^(\d+):/);
    if (match) {
      lineNumbers.push(parseInt(match[1], 10));
    }
  }

  return lineNumbers;
}

/**
 * 从 hashline 内容中提取特定行
 */
export function extractLine(content: string, lineNumber: number): string | null {
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^(\d+):(.*)$/);
    if (match && parseInt(match[1], 10) === lineNumber) {
      return match[2];
    }
  }

  return null;
}
