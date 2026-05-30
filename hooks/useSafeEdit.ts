/**
 * 安全编辑 React Hook
 * 
 * 提供安全的文件编辑功能，防止自修改导致崩溃
 */

"use client";

import { useState, useCallback } from "react";

// ============================================================================
// 类型定义
// ============================================================================

export interface SafetyCheckResult {
  safe: boolean;
  warnings: string[];
  suggestions: string[];
}

export interface SafeEditResult {
  success: boolean;
  backupPath?: string;
  errors?: string[];
  warnings?: string[];
}

export interface BackupInfo {
  file: string;
  timestamp: string;
  path: string;
}

export interface SafeEditOptions {
  autoBackup?: boolean;
  runTypeCheck?: boolean;
  runLint?: boolean;
  autoRestore?: boolean;
}

// ============================================================================
// API 调用函数
// ============================================================================

async function callSafeEditAPI<T>(
  action: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch("/api/safe-edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
  };

  if (!res.ok || data.error) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }

  return data.data as T;
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useSafeEdit() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * 检查编辑安全性
   */
  const checkSafety = useCallback(
    async (
      filePath: string,
      newContent: string
    ): Promise<SafetyCheckResult | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await callSafeEditAPI<SafetyCheckResult>("check", {
          filePath,
          newContent,
        });
        return result;
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        setError(errorMessage);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * 安全编辑文件
   */
  const safeEditFile = useCallback(
    async (
      filePath: string,
      newContent: string,
      options?: SafeEditOptions
    ): Promise<SafeEditResult | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await callSafeEditAPI<SafeEditResult>("edit", {
          filePath,
          newContent,
          options,
        });
        return result;
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        setError(errorMessage);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * 批量安全编辑
   */
  const safeBatchEdit = useCallback(
    async (
      edits: Array<{ filePath: string; newContent: string }>,
      options?: SafeEditOptions
    ): Promise<SafeEditResult[] | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await callSafeEditAPI<SafeEditResult[]>("batch-edit", {
          edits,
          options,
        });
        return result;
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        setError(errorMessage);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * 列出备份
   */
  const listBackups = useCallback(async (): Promise<BackupInfo[] | null> => {
    setLoading(true);
    setError(null);

    try {
      const result = await callSafeEditAPI<BackupInfo[]>("list-backups", {});
      return result;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 清理备份
   */
  const cleanupBackups = useCallback(
    async (keepCount: number = 10): Promise<{ deletedCount: number } | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await callSafeEditAPI<{ deletedCount: number }>(
          "cleanup",
          { keepCount }
        );
        return result;
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        setError(errorMessage);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    loading,
    error,
    clearError,
    checkSafety,
    safeEditFile,
    safeBatchEdit,
    listBackups,
    cleanupBackups,
  };
}
