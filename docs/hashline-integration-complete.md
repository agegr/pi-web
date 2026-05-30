# Hashline 编辑系统集成完成

## 🎉 集成成功

Hashline 编辑系统已成功集成到 pi-web 项目中，现在可以直接使用。

## 📦 依赖

- `@oh-my-pi/hashline` - 已在 `package.json` 中声明，运行 `npm install` 时自动安装

## 📁 新增文件

| 文件 | 说明 |
|------|------|
| `lib/hashline-tool.ts` | Hashline 工具管理器，提供核心功能 |
| `lib/hashline-client.ts` | 客户端帮助函数，提供浏览器端 API |
| `hooks/useHashline.ts` | React Hook，提供组件级集成 |
| `components/HashlineDemo.tsx` | 演示组件，展示使用方法 |
| `app/api/hashline/route.ts` | API 路由，提供 HTTP 接口 |
| `app/hashline-demo/page.tsx` | 演示页面，访问 `/hashline-demo` |
| `docs/hashline.md` | 使用文档，详细说明 |

## 🚀 使用方法

### 1. 访问演示页面

访问 `http://localhost:3030/hashline-demo` 查看交互式演示。

### 2. 在 React 组件中使用

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

## 📊 Hashline 格式说明

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

## 📈 性能对比

| 指标 | str_replace | Hashline | 提升 |
|------|-------------|----------|------|
| 成功率 | 60% | 80% | **+20%** |
| Token 使用 | 637 | 647 | 相当 |
| 重试次数 | 0 | 0 | 相同 |

## 💡 核心优势

1. **无需精确复制内容** - 通过行号引用，不需要复制空格和缩进
2. **自动冲突检测** - 文件变化时哈希不匹配，自动拒绝
3. **更少的错误** - 避免 "String to replace not found" 错误
4. **更少的重试** - 减少 token 使用和重试循环

## 🔧 API 参考

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

## 📚 参考资源

- [@oh-my-pi/hashline npm](https://www.npmjs.com/package/@oh-my-pi/hashline)
- [oh-my-pi GitHub](https://github.com/can1357/oh-my-pi)
- [The Harness Problem](https://blog.can.ac/2026/02/12/the-harness-problem/)

---

**Hashline 编辑系统已成功集成到 pi-web，现在可以直接使用！** 🎉
