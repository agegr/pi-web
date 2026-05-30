/**
 * 安全编辑保护系统
 * 
 * 防止修改 pi-web 自身代码时导致崩溃
 */

import * as fs from "fs/promises";
import * as path from "path";
import { execSync } from "child_process";

// ============================================================================
// 关键文件列表 - 这些文件修改需要特别小心
// ============================================================================

const CRITICAL_FILES = [
  // 核心配置
  "package.json",
  "next.config.ts",
  "tsconfig.json",
  
  // 核心库文件
  "lib/rpc-manager.ts",
  "lib/session-reader.ts",
  "lib/agent-client.ts",
  
  // 核心组件
  "components/AppShell.tsx",
  "components/ChatWindow.tsx",
  "components/ChatInput.tsx",
  "components/SessionSidebar.tsx",
  
  // 核心 hooks
  "hooks/useAgentSession.ts",
  
  // API 路由
  "app/api/agent/[id]/route.ts",
  "app/api/agent/new/route.ts",
  "app/api/sessions/route.ts",
];

// ============================================================================
// 备份管理
// ============================================================================

const BACKUP_DIR = ".backups";

async function ensureBackupDir(): Promise<string> {
  const backupPath = path.join(process.cwd(), BACKUP_DIR);
  await fs.mkdir(backupPath, { recursive: true });
  return backupPath;
}

async function backupFile(filePath: string): Promise<string> {
  const backupDir = await ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = path.basename(filePath);
  const backupFileName = `${fileName}.${timestamp}.bak`;
  const backupPath = path.join(backupDir, backupFileName);
  
  const content = await fs.readFile(filePath, "utf-8");
  await fs.writeFile(backupPath, content, "utf-8");
  
  return backupPath;
}

async function restoreFile(filePath: string, backupPath: string): Promise<void> {
  const content = await fs.readFile(backupPath, "utf-8");
  await fs.writeFile(filePath, content, "utf-8");
}

// ============================================================================
// 安全检查
// ============================================================================

export interface SafetyCheckResult {
  safe: boolean;
  warnings: string[];
  suggestions: string[];
}

export async function checkEditSafety(
  filePath: string,
  newContent: string
): Promise<SafetyCheckResult> {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  
  const relativePath = path.relative(process.cwd(), filePath);
  
  // 检查是否是关键文件
  const isCritical = CRITICAL_FILES.some((cf) => 
    relativePath === cf || relativePath.endsWith(cf)
  );
  
  if (isCritical) {
    warnings.push(`⚠️ ${relativePath} 是关键文件，修改可能导致系统崩溃`);
    suggestions.push("建议先创建备份");
    suggestions.push("修改后立即运行类型检查");
  }
  
  // 检查语法错误
  if (newContent.includes("undefined.") || newContent.includes("null.")) {
    warnings.push("⚠️ 代码中可能存在空值引用");
  }
  
  // 检查导入语句
  if (newContent.includes("import") && !newContent.includes("from")) {
    warnings.push("⚠️ 导入语句可能不完整");
  }
  
  // 检查循环依赖
  if (newContent.includes("require(") && newContent.includes("module.exports")) {
    warnings.push("⚠️ 可能存在循环依赖");
  }
  
  return {
    safe: warnings.length === 0,
    warnings,
    suggestions,
  };
}

// ============================================================================
// 安全编辑函数
// ============================================================================

export interface SafeEditOptions {
  /** 是否自动备份 */
  autoBackup?: boolean;
  /** 是否在编辑后运行类型检查 */
  runTypeCheck?: boolean;
  /** 是否在编辑后运行 lint */
  runLint?: boolean;
  /** 崩溃后是否自动恢复 */
  autoRestore?: boolean;
}

export interface SafeEditResult {
  success: boolean;
  backupPath?: string;
  errors?: string[];
  warnings?: string[];
}

export async function safeEdit(
  filePath: string,
  newContent: string,
  options: SafeEditOptions = {}
): Promise<SafeEditResult> {
  const {
    autoBackup = true,
    runTypeCheck = true,
    runLint = false,
    autoRestore = true,
  } = options;
  
  const errors: string[] = [];
  const warnings: string[] = [];
  let backupPath: string | undefined;
  
  try {
    // 1. 安全检查
    const safetyCheck = await checkEditSafety(filePath, newContent);
    if (!safetyCheck.safe) {
      warnings.push(...safetyCheck.warnings);
      // 对于关键文件，强制备份
      if (safetyCheck.warnings.some((w) => w.includes("关键文件"))) {
        autoBackup && (backupPath = await backupFile(filePath));
      }
    }
    
    // 2. 创建备份
    if (autoBackup) {
      backupPath = await backupFile(filePath);
      console.log(`📁 备份创建: ${backupPath}`);
    }
    
    // 3. 写入新内容
    await fs.writeFile(filePath, newContent, "utf-8");
    console.log(`✏️ 文件已更新: ${filePath}`);
    
    // 4. 运行类型检查
    if (runTypeCheck) {
      try {
        console.log("🔍 运行类型检查...");
        execSync("node_modules/.bin/tsc --noEmit", { 
          stdio: "pipe",
          timeout: 30000,
        });
        console.log("✅ 类型检查通过");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`类型检查失败: ${errorMsg}`);
        
        // 自动恢复
        if (autoRestore && backupPath) {
          console.log("🔄 类型检查失败，自动恢复备份...");
          await restoreFile(filePath, backupPath);
          console.log("✅ 已恢复到备份版本");
        }
      }
    }
    
    // 5. 运行 lint
    if (runLint && errors.length === 0) {
      try {
        console.log("🔍 运行 lint 检查...");
        execSync("node node_modules/next/dist/bin/next lint", { 
          stdio: "pipe",
          timeout: 30000,
        });
        console.log("✅ lint 检查通过");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        warnings.push(`lint 警告: ${errorMsg}`);
      }
    }
    
    return {
      success: errors.length === 0,
      backupPath,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    errors.push(`编辑失败: ${errorMsg}`);
    
    // 自动恢复
    if (autoRestore && backupPath) {
      try {
        console.log("🔄 编辑失败，自动恢复备份...");
        await restoreFile(filePath, backupPath);
        console.log("✅ 已恢复到备份版本");
      } catch (restoreError) {
        errors.push(`恢复失败: ${restoreError}`);
      }
    }
    
    return {
      success: false,
      backupPath,
      errors,
      warnings,
    };
  }
}

// ============================================================================
// 批量安全编辑
// ============================================================================

export async function safeBatchEdit(
  edits: Array<{ filePath: string; newContent: string }>,
  options: SafeEditOptions = {}
): Promise<SafeEditResult[]> {
  const results: SafeEditResult[] = [];
  const backups: Array<{ filePath: string; backupPath: string }> = [];
  
  try {
    // 1. 创建所有备份
    for (const edit of edits) {
      const backupPath = await backupFile(edit.filePath);
      backups.push({ filePath: edit.filePath, backupPath });
    }
    
    // 2. 执行所有编辑
    for (const edit of edits) {
      const result = await safeEdit(edit.filePath, edit.newContent, {
        ...options,
        autoBackup: false, // 已经备份过了
        autoRestore: false, // 稍后统一恢复
      });
      results.push(result);
    }
    
    // 3. 检查是否有错误
    const hasErrors = results.some((r) => !r.success);
    if (hasErrors && options.autoRestore !== false) {
      console.log("🔄 批量编辑有错误，恢复所有备份...");
      for (const backup of backups) {
        await restoreFile(backup.filePath, backup.backupPath);
      }
      console.log("✅ 已恢复所有备份");
    }
    
    return results;
  } catch (error) {
    // 恢复所有备份
    console.log("🔄 批量编辑失败，恢复所有备份...");
    for (const backup of backups) {
      try {
        await restoreFile(backup.filePath, backup.backupPath);
      } catch (restoreError) {
        console.error(`恢复失败 ${backup.filePath}:`, restoreError);
      }
    }
    
    throw error;
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 列出所有备份
 */
export async function listBackups(): Promise<
  Array<{ file: string; timestamp: string; path: string }>
> {
  const backupDir = await ensureBackupDir();
  const files = await fs.readdir(backupDir);
  
  return files
    .filter((f) => f.endsWith(".bak"))
    .map((f) => {
      const parts = f.split(".");
      const fileName = parts[0];
      const timestamp = parts.slice(1, -1).join(".");
      return {
        file: fileName,
        timestamp,
        path: path.join(backupDir, f),
      };
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * 清理旧备份
 */
export async function cleanupBackups(keepCount: number = 10): Promise<number> {
  const backups = await listBackups();
  
  if (backups.length <= keepCount) {
    return 0;
  }
  
  const toDelete = backups.slice(keepCount);
  for (const backup of toDelete) {
    await fs.unlink(backup.path);
  }
  
  return toDelete.length;
}
