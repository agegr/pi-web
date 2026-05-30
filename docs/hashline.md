# Hashline 编辑系统

## 概述

Hashline 是一个基于内容哈希的行级编辑系统，解决 LLM 编辑工具的核心痛点。通过引入 Hashline，pi-web 可以将 LLM 编辑成功率从 60% 提升到 80%。

## 核心优势

1. **无需精确复制内容** - 通过行号引用，不需要复制空格和缩进
2. **自动冲突检测** - 文件变化时哈希不匹配，自动拒绝
3. **更少的错误** - 避免 "String to replace not found" 错误
4. **更少的重试** - 减少 token 使用和重试循环

## 安装

Hashline 已经集成到 pi-web 中，无需额外安装。依赖包 `@oh-my-pi/hashline` 已在 `package.json` 中声明。

## 使用方法

### 1. 在 React 组件中使用

```tsx
import { useHashline } from "@/hooks/useHashline";

function MyComponent() {
  const { readFile, editFile, generatePatch } = useHashline();

  // 读取文件
  const handleRead = async () => {
    const result = await readFile("src/example.ts");
    if (result) {
      console.log(result.header); // ¶src/example.ts#A1B
      console.log(result.formatted); // 带行号的内容
    }
  };

  // 编辑文件
  const handleEdit = async () => {
    const patch = generatePatch("src/example.ts", "A1B", [
      {
        startLine: 2,
        endLine: 2,
        newText: '  return "universe";',
      },
    ]);

    const result = await editFile(patch);
    if (result?.success) {
      console.log("编辑成功！");
    }
  };

  return (
    <div>
      <button onClick={handleRead}>读取文件</button>
      <button onClick={handleEdit}>编辑文件</button>
    </div>
  );
}
```

### 2. 在 API 路由中使用

```typescript
import { HashlineToolManager } from "@/lib/hashline-tool";

export async function POST(req: Request) {
  const { path, input } = await req.json();
  
  const manager = new HashlineToolManager(process.cwd());
  
  // 读取文件
  const readResult = await manager.readFile(path);
  console.log(readResult.header); // ¶path#TAG
  
  // 编辑文件
  const editResult = await manager.applyPatch(input);
  console.log(editResult.success); // true
}
```

### 3. 使用客户端帮助函数

```typescript
import { hashlineRead, hashlineEdit, generateHashlinePatch } from "@/lib/hashline-client";

// 读取文件
const readResult = await hashlineRead("src/example.ts");
console.log(readResult.content[0].text);

// 生成补丁
const patch = generateHashlinePatch("src/example.ts", "A1B", [
  {
    startLine: 2,
    endLine: 2,
    newText: '  return "universe";',
  },
]);

// 编辑文件
const editResult = await hashlineEdit(patch);
console.log(editResult.content[0].text);
```

## Hashline 格式说明

### 文件头

```
¶PATH#TAG
```

- `¶` - 文件段前缀
- `PATH` - 文件路径
- `#` - 分隔符
- `TAG` - 3位十六进制快照标签

### 锚点

```
A B             # 选择行 A..B
BOF             # 文件开头
EOF             # 文件结尾
```

### 内容行

```
+TEXT           # 添加新行
&A..B           # 复制原始文件的行 A..B
```

### 示例

**替换行：**
```
¶file.js#A1B
2 2
+  return "universe";
```

**插入行：**
```
¶file.js#A1B
1 1
&1
+  console.log("new line");
```

**删除行：**
```
¶file.js#A1B
4 6
```

**多行替换：**
```
¶file.js#A1B
2 2
+  const x = 1;
+  const y = 2;
+  const z = 3;
```

## API 参考

### `useHashline(options?)`

React Hook，提供在 React 组件中使用 hashline 工具的便捷方法。

**参数：**
- `options.cwd?` - 工作目录

**返回值：**
- `loading` - 是否正在加载
- `error` - 错误信息
- `readFile(filePath)` - 读取文件
- `editFile(patchInput)` - 编辑文件
- `generatePatch(filePath, tag, edits)` - 生成补丁
- `parseHeader(header)` - 解析文件头
- `clearError()` - 清除错误

### `hashlineRead(filePath, cwd?)`

读取文件并返回带哈希头的内容。

**参数：**
- `filePath` - 文件路径
- `cwd?` - 工作目录

**返回值：**
- `content` - 文件内容
- `header` - Hashline 头
- `tag` - 快照标签
- `formatted` - 格式化内容

### `hashlineEdit(patchInput, cwd?)`

应用 hashline 补丁。

**参数：**
- `patchInput` - Hashline 补丁
- `cwd?` - 工作目录

**返回值：**
- `success` - 是否成功
- `results` - 编辑结果
- `error` - 错误信息

### `generateHashlinePatch(filePath, tag, edits)`

生成简单的补丁。

**参数：**
- `filePath` - 文件路径
- `tag` - 快照标签
- `edits` - 编辑数组
  - `startLine` - 起始行
  - `endLine` - 结束行
  - `newText?` - 新文本
  - `keepLines?` - 是否保留原行

**返回值：**
- Hashline 补丁字符串

### `parseHashlineHeader(header)`

解析 Hashline 头。

**参数：**
- `header` - Hashline 头

**返回值：**
- `path` - 文件路径
- `tag` - 快照标签

## 性能对比

| 指标 | str_replace | Hashline | 提升 |
|------|-------------|----------|------|
| 成功率 | 60% | 80% | **+20%** |
| Token 使用 | 637 | 647 | 相当 |
| 重试次数 | 0 | 0 | 相同 |

## 参考资源

- [@oh-my-pi/hashline npm](https://www.npmjs.com/package/@oh-my-pi/hashline)
- [oh-my-pi GitHub](https://github.com/can1357/oh-my-pi)
- [The Harness Problem](https://blog.can.ac/2026/02/12/the-harness-problem/)
