# pi-web 与 oh-my-pi 功能对比与集成建议

## 📊 当前状态

### pi-web (v0.6.12)
- **定位**: Next.js Web UI，专为 Pi Agent 对话和工作区管理设计
- **核心依赖**:
  - `@earendil-works/pi-ai` ^0.76.0
  - `@earendil-works/pi-coding-agent` ^0.76.0
  - `@oh-my-pi/hashline` ^15.5.10 ✅ 已集成

### oh-my-pi (v15.5.10)
- **定位**: 功能完整的 coding agent 系统（CLI + SDK + TUI）
- **核心包**: 7 个 npm 包 + 4 个 Rust crates
- **规模**: ~27k 行 Rust + 大量 TypeScript

---

## 🎯 值得集成的功能模块

### 🔥 高优先级（立即可用）

#### 1. **@oh-my-pi/omp-stats** - AI 使用统计仪表板
**价值**: 为 pi-web 添加可观测性和成本追踪

**功能**:
- 📈 实时 AI 使用统计（token、成本、延迟）
- 📊 Chart.js 可视化图表
- 📅 按时间段聚合分析
- 💰 多提供商成本追踪
- 🎨 基于 Tailwind + React 的现代 UI

**集成方案**:
```typescript
// 在 pi-web 中添加新页面/路由
app/stats/page.tsx  // 统计仪表板页面
components/StatsPanel.tsx  // 嵌入式统计面板
```

**工作量**: 1-2 天
- 安装 `@oh-my-pi/omp-stats` 依赖
- 创建统计页面路由
- 在侧边栏添加入口
- 适配 pi-web 的会话数据格式

---

#### 2. **@oh-my-pi/pi-natives** - Rust 原生性能加速
**价值**: 大幅提升文件搜索、语法高亮、shell 执行性能

**核心能力**:
- 🔍 **grep**: 基于 ripgrep 的超快搜索（比 Node.js 快 10-100x）
- 🎨 **highlight**: 语法高亮（50+ 语言）
- 🐚 **shell**: 嵌入式 bash（brush-shell）
- 🖼️ **image**: 图片编解码（PNG/JPEG/WebP）
- 📝 **text**: ANSI 感知的文本处理
- 🌳 **ast**: tree-sitter AST 解析和摘要

**集成方案**:
```typescript
// 替换现有的文件搜索
import { grep } from '@oh-my-pi/pi-natives';

// 在 FileExplorer 中使用原生搜索
const results = await grep({
  pattern: searchQuery,
  path: workspaceRoot,
  glob: '**/*.{ts,tsx,js,jsx}'
});
```

**工作量**: 2-3 天
- 安装 `@oh-my-pi/pi-natives` 依赖
- 替换 FileExplorer 的搜索逻辑
- 在 FileViewer 中集成语法高亮
- 测试跨平台兼容性（Windows/macOS/Linux）

---

#### 3. **多提供商支持** - 从 @oh-my-pi/pi-ai 升级
**价值**: 支持 40+ AI 提供商，而不仅限于当前的几个

**新增提供商**:
- **Frontier APIs**: xAI (Grok), Mistral, Groq, Cerebras, Fireworks, Together, Perplexity
- **Coding Plans**: Cursor, GitHub Copilot, Kimi Code, MiniMax, Qwen
- **本地部署**: Ollama, LM Studio, llama.cpp, vLLM

**集成方案**:
```bash
# 升级依赖
npm install @oh-my-pi/pi-ai@^15.5.10
npm install @oh-my-pi/pi-coding-agent@^15.5.10
```

**工作量**: 1 天
- 升级依赖版本
- 更新 ModelsConfig 组件以支持新提供商
- 测试兼容性
- 更新文档

---

### 🌟 中优先级（需要适配）

#### 4. **web_search 工具** - 14 个搜索提供商
**价值**: Agent 可以搜索网络、读取 arXiv 论文、Stack Overflow

**功能**:
- 🔍 14 个搜索后端（Exa, Brave, Jina, Perplexity, Tavily 等）
- 📄 智能内容提取（GitHub, npm, arXiv, Stack Overflow）
- 🔗 保留链接结构的 Markdown 转换

**集成方案**:
```typescript
// 在 ChatWindow 中添加 web_search 工具卡片
components/tools/WebSearchCard.tsx
```

**工作量**: 3-4 天

---

#### 5. **LSP 集成** - 代码智能
**价值**: Agent 可以使用 IDE 级别的代码导航和重构

**功能**:
- 🔍 定义跳转、引用查找
- 🔄 智能重命名（跨文件）
- 💡 代码诊断和快速修复
- 📝 符号搜索

**集成方案**:
```typescript
// 在 FileViewer 中添加 LSP 功能
components/LSPPanel.tsx  // LSP 诊断面板
lib/lsp-client.ts  // LSP 客户端封装
```

**工作量**: 5-7 天

---

#### 6. **浏览器驱动** - Puppeteer 集成
**价值**: Agent 可以测试 Web 应用、截图、自动化操作

**功能**:
- 🌐 无头浏览器控制
- 📸 截图和 PDF 生成
- 🤖 反检测（stealth mode）
- 🔌 可连接到 Electron 应用

**集成方案**:
```typescript
// 添加浏览器工具面板
components/tools/BrowserPanel.tsx
app/api/browser/route.ts
```

**工作量**: 4-5 天

---

#### 7. **子代理系统 (task)** - 并行工作流
**价值**: 将复杂任务拆分给多个子 Agent 并行处理

**功能**:
- 🔀 并行任务执行
- 🌳 工作区隔离（worktree）
- 📊 结构化结果聚合
- 💬 子代理间通信（IRC）

**集成方案**:
```typescript
// 在 ChatWindow 中显示子代理状态
components/SubagentCard.tsx
components/SubagentTree.tsx
```

**工作量**: 5-7 天

---

### 🔮 低优先级（高级功能）

#### 8. **Hindsight 内存系统**
- Agent 跨会话记忆（retain/recall/reflect）
- 项目级知识库

**工作量**: 7-10 天

#### 9. **DAP 调试器集成**
- 驱动 lldb/gdb/dlv/debugpy
- 断点、单步、变量检查

**工作量**: 10-14 天

#### 10. **代码审查系统 (/review)**
- 自动代码审查
- P0-P3 优先级分类
- 并行审查子代理

**工作量**: 7-10 天

#### 11. **冲突解决 (conflict://)**
- Git 冲突可视化
- 一键选择 @theirs/@ours/@base

**工作量**: 3-5 天

#### 12. **AST 编辑 (ast_edit)**
- 结构化代码重写
- 预览后应用机制

**工作量**: 5-7 天

---

## 📋 推荐集成路线图

### Phase 1: 基础增强（1-2 周）
1. ✅ 升级到 `@oh-my-pi/pi-ai` 和 `@oh-my-pi/pi-coding-agent` v15.5.10
2. ✅ 集成 `@oh-my-pi/omp-stats` 统计仪表板
3. ✅ 集成 `@oh-my-pi/pi-natives` 性能加速

**预期收益**:
- 支持 40+ AI 提供商
- 文件搜索性能提升 10-100x
- 实时成本和使用统计

---

### Phase 2: 工具扩展（2-3 周）
4. ✅ 集成 web_search 工具
5. ✅ 集成 LSP 代码智能
6. ✅ 添加浏览器驱动支持

**预期收益**:
- Agent 可以搜索网络和文档
- IDE 级别的代码导航和重构
- Web 应用测试和自动化

---

### Phase 3: 高级功能（3-4 周）
7. ✅ 子代理系统
8. ✅ Hindsight 内存
9. ✅ 冲突解决
10. ✅ 代码审查

**预期收益**:
- 复杂任务并行处理
- 跨会话知识积累
- 完整的 Git 工作流支持

---

## 🚀 快速开始：集成 omp-stats

### 步骤 1: 安装依赖
```bash
cd C:/A-codes/github/pi-web
npm install @oh-my-pi/omp-stats@^15.5.10
npm install chart.js react-chartjs-2 date-fns lucide-react
```

### 步骤 2: 创建统计页面
```typescript
// app/stats/page.tsx
import { StatsClient } from '@oh-my-pi/omp-stats/client';

export default function StatsPage() {
  return (
    <div className="h-screen">
      <StatsClient />
    </div>
  );
}
```

### 步骤 3: 添加侧边栏入口
```typescript
// components/SessionSidebar.tsx
<Link href="/stats">
  <BarChart3 className="w-4 h-4" />
  统计
</Link>
```

---

## 💡 技术注意事项

### 依赖冲突
- pi-web 使用 `@earendil-works/*` 包（v0.76.0）
- oh-my-pi 使用 `@oh-my-pi/*` 包（v15.5.10）
- 两者可能不完全兼容，需要逐步迁移

### 建议迁移策略
1. **并行运行**: 先保留 `@earendil-works/*`，逐个功能测试 `@oh-my-pi/*`
2. **功能对等验证**: 确保核心功能（会话管理、消息流）正常工作
3. **逐步替换**: 验证通过后，完全切换到 `@oh-my-pi/*`

### Rust 原生模块
- `@oh-my-pi/pi-natives` 需要预编译的二进制文件
- 支持平台: Windows x64, macOS (x64/arm64), Linux (x64/arm64)
- 确保 npm 能正确下载对应平台的二进制

---

## 📊 预期影响

### 性能提升
- 文件搜索: **10-100x** 加速（Rust grep vs Node.js）
- 语法高亮: **5-10x** 加速（原生 vs JS）
- Shell 执行: **2-5x** 加速（嵌入式 vs fork/exec）

### 功能增强
- AI 提供商: **3 → 40+**
- 内置工具: **基础 → 32 个专业工具**
- 代码智能: **无 → LSP/DAP 完整支持**

### 用户体验
- ✅ 实时成本追踪
- ✅ 网络搜索能力
- ✅ 并行任务处理
- ✅ 跨会话记忆

---

## 🎯 总结

**最值得立即集成的 3 个功能**:
1. **@oh-my-pi/omp-stats** - 低成本高价值，1-2 天完成
2. **@oh-my-pi/pi-natives** - 性能提升显著，2-3 天完成
3. **多提供商支持** - 升级依赖即可，1 天完成

**总工作量**: 4-6 天即可完成 Phase 1，显著提升 pi-web 的能力和性能。
