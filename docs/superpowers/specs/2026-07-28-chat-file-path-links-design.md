# 聊天正文中的裸文件路径转可点击预览链接

日期：2026-07-28
状态：设计已确认，待实现

## 问题

Agent 在回复正文里提到生成的文件时，给出的是纯文本绝对路径，例如：

```
已生成报告：/Users/me/project/out/report.html
```

这段路径在聊天界面里不可点击。用户想预览，必须去左侧文件树里手动定位同名文件。

管道的两端其实都已就绪：

- `lib/file-links.ts:77` 的 `resolveLocalFileHref()` 已能解析路径并做安全校验（拒绝 `/api/`、`/_next/`、非 file 协议、相对路径越界）
- `components/AppShell.tsx:453` 的 `handleOpenLinkedFile()` 已能开标签页并展开右侧面板
- `components/MarkdownBody.tsx:48-77` 的 `a()` 处理器已把两者接通

缺的只是中间一段：`MarkdownBody` 的 `a()` 只对 Markdown 链接语法 `[x](path)` 生效。裸路径不是链接节点，走不到这段逻辑。因此能否一键预览，取决于模型是否恰好把路径写成了 Markdown 链接。

## 作用域

已确认的边界：

| 维度 | 决定 |
|---|---|
| 位置 | 仅 assistant 回复正文的普通段落文字 |
| 路径类型 | 仅 Unix 绝对路径（`/` 开头）；Windows 盘符路径刻意不链接化（已知限制） |
| 文件类型 | 仅可预览的扩展名白名单 |
| 实现层 | remark 插件（mdast AST 层） |

明确排除（本次不做）：

- 围栏代码块、行内代码内的路径
- 相对路径（`docs/report.md`、`./out/index.html`）
- 工具调用卡片里的 `file_path`（`MessageView.tsx:687` 的 `ToolCallBlock` 未接收 `onOpenFile`，是独立缺口，另行处理）

## 架构

三个改动点，数据流单向：

```
lib/file-path-scan.ts        (新增 · 纯函数 · 零依赖)
    scanFilePaths(text) → [{start, end, path}]
              ↓
lib/remark-file-paths.ts     (新增 · mdast 转换)
    text 节点 → [text, link, text] 切分
              ↓
lib/markdown.ts              (改 1 行 · 注册插件)
              ↓
components/MarkdownBody.tsx  (不改 · 现有 a() 处理器接管)
    resolveLocalFileHref() → onOpenFile() → 右侧 FileViewer
```

核心收益：下游一行不动。点击拦截、安全校验、修饰键放行（`MarkdownBody.tsx:60-73`）原样复用。新代码只负责「把裸路径变成 link 节点」这一件事。

### 为什么放在 remark 层是安全的

mdast 中代码块是 `code` 节点、行内代码是 `inlineCode` 节点，**都不是 `text` 节点**。只遍历 `text` 就天然满足作用域约束：代码块与行内代码自动跳过，无需任何显式判断。

已有 `link` 节点的子节点虽是 `text`，但遍历时不下降进 `link`，即可避免嵌套链接。

### 不引入 unist-util-visit

常规做法会用 `unist-util-visit` 遍历 AST。本设计不采用，理由：

1. 当前 `node_modules` 未安装，无法验证该包可用性
2. 它并非本项目直接依赖，只可能作为 remark 生态的传递依赖存在
3. 依赖传递依赖是脆的——上游一次版本调整即可能断掉
4. 我们只需遍历 `text` 节点，手写递归约 10 行足够

因此 `remark-file-paths.ts` 自行递归遍历 mdast 子树，不新增任何 package.json 依赖。

## 模块设计

### lib/file-path-scan.ts

纯函数，无 I/O 无依赖，可独立测试。

```ts
export interface FilePathMatch {
  start: number;   // 在原字符串中的起始下标
  end: number;     // 结束下标（不含）
  path: string;    // 提取出的路径（已剥离尾部标点）
}

export function scanFilePaths(text: string): FilePathMatch[];
```

识别规则：

| 规则 | 内容 |
|---|---|
| 起始 | `/` 开头 |
| 扩展名 | 必须命中白名单（见下） |
| 行号后缀 | `:42`、`:42:8` 一并纳入匹配范围；`resolveLocalFileHref` 下游会剥离 |
| 尾部标点 | 结尾的 `。，、；：）」』.,;:)]}'"` 等不计入路径 |
| 一行多路径 | 全部返回，按出现顺序 |

扩展名白名单是最重要的一道闸：它使 `/usr/bin`、`and/or`、`n/a` 这类不带可预览后缀的串不被误判。

白名单来源（复用现有定义，不重复维护）：

- `app/api/files/[...path]/route.ts:47` 的 `EXT_TO_LANGUAGE`：ts/tsx/js/py/go/rs/html/css/json/yaml/md/sh/sql/pdf/docx 等
- `lib/file-types.ts:7` 的 `IMAGE_EXT_TO_MIME`：png/jpg/gif/webp/svg/bmp/ico/avif
- `lib/file-types.ts:21` 的 `AUDIO_EXT_TO_MIME`：mp3/wav/ogg/opus/m4a/flac 等

实现时应将白名单抽取到共享位置（建议放入 `lib/file-types.ts`），供 API 路由与本模块共用，避免两处漂移。

### lib/remark-file-paths.ts

mdast 转换插件。

```ts
export function remarkFilePaths(): (tree: Root) => void;
```

行为：

1. 递归遍历 mdast 树
2. 遇到 `code`、`inlineCode`、`link`、`linkReference`、`definition` 节点时**不下降**
3. 对 `text` 节点调用 `scanFilePaths()`
4. 有匹配时，将该 `text` 节点原地替换为 `[text?, link, text?, ...]` 序列
5. 生成的 `link` 节点：`{type: 'link', url: <路径>, children: [{type: 'text', value: <原文>}]}`

生成的 `url` 保持原始路径形态（含行号后缀），交由下游 `resolveLocalFileHref()` 统一规范化。

### lib/markdown.ts

单行改动，在 `markdownRemarkPlugins` 中注册：

```ts
export const markdownRemarkPlugins = [remarkGfm, remarkMath, remarkFilePaths];
```

`markdownPreviewRemarkPlugins`（FileViewer 的 Markdown 预览用）同样注册，使预览内的裸路径也可跳转。

## 边界处理

| 场景 | 行为 | 理由 |
|---|---|---|
| 文件不存在 | 链接照常生成，点击后 `FileViewer` 显示错误态 | 不做存在性预检：需打网络，且流式渲染时路径可能尚未写完 |
| 流式输出中路径被截断 | 不特殊处理 | 每次渲染独立扫描，写完自然完整 |
| 越权路径（如 `/etc/passwd`） | 链接生成，后端 allowed-roots 拦截 | 安全策略集中在后端，前端不重复实现 |
| 不在白名单的扩展名 | 保持纯文本 | 避免点开一片空白 |
| 路径含空格 | 不识别 | 无引号包裹时无法可靠判定边界，误判代价高于收益 |

## 测试

沿用现有约定：`node:test` + `jiti`（参考 `lib/file-links.test.mjs`、`components/MarkdownBody.test.mjs`）。

### lib/file-path-scan.test.mjs

- 识别 Unix 绝对路径
- 不识别 Windows 盘符路径（`C:/`、`C:\`，保持纯文本）
- 扩展名不在白名单时不识别（`/usr/bin`、`/tmp/data.xyz`）
- 剥离中文尾部标点（`路径：/tmp/a.html。`）
- 剥离英文尾部标点（`see /tmp/a.html.`）
- 保留行号后缀（`/tmp/a.ts:42`、`/tmp/a.ts:42:8`）
- 一行多路径全部返回
- 非路径串不误判（`and/or`、`n/a`、`24/7`）
- 空字符串、无匹配返回空数组

### lib/remark-file-paths.test.mjs

- 段落内裸路径转为 link 节点
- 围栏代码块内不转换
- 行内代码内不转换
- 已有 link 节点内不产生嵌套
- 一个 text 节点含多路径时正确切分为交替序列
- 无匹配时树结构不变

### components/MarkdownBody.test.mjs（追加）

- 裸绝对路径渲染出 `<a>` 元素
- 该 `<a>` 不带 `target="_blank"`（即走应用内 `onOpenFile`，与现有「keeps local file markdown links in the app」用例一致）
- 代码块内路径仍渲染为纯文本

## 实现顺序

1. 抽取扩展名白名单到 `lib/file-types.ts`，改 API 路由引用它
2. `lib/file-path-scan.ts` + 测试
3. `lib/remark-file-paths.ts` + 测试
4. `lib/markdown.ts` 注册插件
5. `components/MarkdownBody.test.mjs` 追加端到端用例
6. `npm run lint` + 全量测试

每步测试通过后再进入下一步。
