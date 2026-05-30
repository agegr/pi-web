# 安全编辑系统

## 概述

安全编辑系统是一个防止修改 pi-web 自身代码时导致崩溃的保护机制。它提供了以下功能：

1. **安全检查** - 编辑前检查是否是关键文件，评估风险
2. **自动备份** - 编辑前自动创建备份，崩溃后可恢复
3. **类型检查** - 编辑后自动运行 TypeScript 类型检查
4. **自动恢复** - 类型检查失败时自动恢复备份
5. **备份管理** - 列出和清理旧备份

## 关键文件列表

以下文件修改需要特别小心：

```typescript
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
```

## 使用方法

### 1. 在 React 组件中使用

```tsx
import { useSafeEdit } from "@/hooks/useSafeEdit";

function MyComponent() {
  const { checkSafety, safeEditFile, listBackups, cleanupBackups } = useSafeEdit();

  // 检查安全性
  const handleCheck = async () => {
    const result = await checkSafety("lib/example.ts", newContent);
    if (result && !result.safe) {
      console.log("警告:", result.warnings);
    }
  };

  // 安全编辑
  const handleEdit = async () => {
    const result = await safeEditFile("lib/example.ts", newContent, {
      autoBackup: true,
      runTypeCheck: true,
      autoRestore: true,
    });
    
    if (result?.success) {
      console.log("编辑成功！");
    }
  };

  // 列出备份
  const handleListBackups = async () => {
    const backups = await listBackups();
    console.log("备份列表:", backups);
  };

  // 清理备份
  const handleCleanup = async () => {
    const result = await cleanupBackups(10);
    console.log(`已清理 ${result?.deletedCount} 个备份`);
  };

  return (
    <div>
      <button onClick={handleCheck}>检查安全性</button>
      <button onClick={handleEdit}>安全编辑</button>
      <button onClick={handleListBackups}>列出备份</button>
      <button onClick={handleCleanup}>清理备份</button>
    </div>
  );
}
```

### 2. 使用 API 路由

```typescript
// 检查安全性
const checkResponse = await fetch("/api/safe-edit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "check",
    filePath: "lib/example.ts",
    newContent: "...",
  }),
});

// 安全编辑
const editResponse = await fetch("/api/safe-edit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "edit",
    filePath: "lib/example.ts",
    newContent: "...",
    options: {
      autoBackup: true,
      runTypeCheck: true,
      autoRestore: true,
    },
  }),
});

// 列出备份
const backupsResponse = await fetch("/api/safe-edit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "list-backups",
  }),
});

// 清理备份
const cleanupResponse = await fetch("/api/safe-edit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "cleanup",
    keepCount: 10,
  }),
});
```

### 3. 访问演示页面

访问 `http://localhost:3030/safe-edit-demo` 查看交互式演示。

## API 参考

### `useSafeEdit()`

React Hook，提供安全编辑功能。

**返回值：**
- `loading` - 是否正在加载
- `error` - 错误信息
- `clearError()` - 清除错误
- `checkSafety(filePath, newContent)` - 检查安全性
- `safeEditFile(filePath, newContent, options)` - 安全编辑文件
- `safeBatchEdit(edits, options)` - 批量安全编辑
- `listBackups()` - 列出备份
- `cleanupBackups(keepCount)` - 清理备份

### `checkSafety(filePath, newContent)`

检查编辑安全性。

**参数：**
- `filePath` - 文件路径
- `newContent` - 新内容

**返回值：**
- `safe` - 是否安全
- `warnings` - 警告列表
- `suggestions` - 建议列表

### `safeEditFile(filePath, newContent, options)`

安全编辑文件。

**参数：**
- `filePath` - 文件路径
- `newContent` - 新内容
- `options` - 选项
  - `autoBackup` - 是否自动备份（默认 true）
  - `runTypeCheck` - 是否运行类型检查（默认 true）
  - `runLint` - 是否运行 lint（默认 false）
  - `autoRestore` - 是否自动恢复（默认 true）

**返回值：**
- `success` - 是否成功
- `backupPath` - 备份路径
- `errors` - 错误列表
- `warnings` - 警告列表

### `listBackups()`

列出所有备份。

**返回值：**
- `file` - 文件名
- `timestamp` - 时间戳
- `path` - 备份路径

### `cleanupBackups(keepCount)`

清理旧备份。

**参数：**
- `keepCount` - 保留数量（默认 10）

**返回值：**
- `deletedCount` - 删除数量

## 工作流程

1. **编辑前**
   - 检查是否是关键文件
   - 创建备份
   - 评估风险

2. **编辑中**
   - 写入新内容
   - 运行类型检查
   - 运行 lint（可选）

3. **编辑后**
   - 如果类型检查失败，自动恢复备份
   - 返回编辑结果

## 最佳实践

1. **始终启用自动备份**
   ```typescript
   const result = await safeEditFile(filePath, newContent, {
     autoBackup: true,
   });
   ```

2. **修改关键文件前检查安全性**
   ```typescript
   const safety = await checkSafety(filePath, newContent);
   if (!safety?.safe) {
     console.log("警告:", safety?.warnings);
     return;
   }
   ```

3. **定期清理旧备份**
   ```typescript
   await cleanupBackups(10); // 保留最近 10 个备份
   ```

4. **批量编辑时使用批量函数**
   ```typescript
   const results = await safeBatchEdit([
     { filePath: "file1.ts", newContent: "..." },
     { filePath: "file2.ts", newContent: "..." },
   ]);
   ```

## 故障恢复

如果编辑导致崩溃：

1. **查看备份列表**
   ```bash
   curl -X POST http://localhost:3030/api/safe-edit \
     -H "Content-Type: application/json" \
     -d '{"action": "list-backups"}'
   ```

2. **手动恢复备份**
   ```bash
   cp .backups/文件名.时间戳.bak 原文件路径
   ```

3. **重启服务器**
   ```bash
   npm run dev
   ```

## 参考资源

- [AGENTS.md](../AGENTS.md) - 架构文档
- [安全编辑演示](http://localhost:3030/safe-edit-demo) - 交互式演示
