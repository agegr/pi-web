# Pi Web 优化计划

> 基于代码库全面审计，按优先级排序。每个阶段可独立执行，但建议按顺序推进。

---

## 现状概览

| 指标 | 数值 | 健康阈值 |
|------|------|----------|
| 最大组件行数 | 1700 (SessionSidebar) | < 500 |
| 最大 hook 数 | 72 (SessionSidebar) | < 20 |
| 内联样式实例 | 739 | 0 (逐步迁移) |
| `any` 类型使用 | 15 | 0 |
| 组件总数 | 14 | — |
| API 路由总数 | 18 | — |

---

## Phase 1：大文件拆分（代码架构）

**目标**：将 4 个超大组件拆成职责单一的小组件，每个 < 500 行，hook 数 < 20

### 1.1 SessionSidebar.tsx（1700 行 → ~400 行）

当前职责混杂：项目列表、会话树、文件浏览器弹窗、文件资源管理器、拖拽逻辑、URL 恢复。

**拆分方案：**

| 新文件 | 职责 | 来源行范围 |
|--------|------|-----------|
| `BrowseDirectoryModal.tsx` | 文件浏览弹窗（路径栏+搜索+列表+Recent） | ~700-1070 |
| `ProjectList.tsx` | 项目分组列表 + 会话树 | ~1040-1350 |
| `SessionSidebar.tsx` | 仅保留 header + 状态管理 + 组装 | 保留壳 |

**关键依赖：**
- `BrowseDirectoryModal` 需要接收 `onSelect(cwd)` 回调
- `ProjectList` 需要接收 `sessions[]`, `selectedCwd`, `onSelectSession` 等
- 状态上提到 sidebar 或用 context

**验收标准：**
- [ ] `SessionSidebar.tsx` < 500 行
- [ ] 每个新文件 < 400 行
- [ ] 所有现有功能无回归

---

### 1.2 ModelsConfig.tsx（1664 行 → ~400 行）

当前：provider 列表、模型配置表单、连接测试、模型排序全在一个文件。

**拆分方案：**

| 新文件 | 职责 |
|--------|------|
| `ProviderCard.tsx` | 单个 provider 的配置卡片（模型列表+表单） |
| `ModelForm.tsx` | 添加/编辑模型的表单 |
| `ModelsConfig.tsx` | 仅保留 provider 列表 + 全局操作 |

**验收标准：**
- [ ] `ModelsConfig.tsx` < 500 行
- [ ] 表单验证逻辑可独立测试

---

### 1.3 GitPanel.tsx（1134 行 → ~400 行）

当前：文件树构建、树渲染、提交逻辑、分支管理、Diff 查看、通知全在一起。

**拆分方案：**

| 新文件 | 职责 |
|--------|------|
| `GitFileTree.tsx` | 文件树渲染 + 全选/展开折叠 |
| `GitCommitForm.tsx` | 提交表单 + 消息输入 |
| `GitDiffView.tsx` | Diff 展示（目前是简单文本，未来可升级） |
| `GitBranches.tsx` | 分支列表 + 操作 |
| `GitPanel.tsx` | Tab 容器 + 状态协调 |

**验收标准：**
- [ ] `GitPanel.tsx` < 400 行
- [ ] 树构建函数可独立测试

---

### 1.4 ChatInput.tsx（1132 行 → ~400 行）

当前：textarea、Skill 菜单、@提及菜单、工具栏、slash 触发逻辑全在一起。

**拆分方案：**

| 新文件 | 职责 |
|--------|------|
| `ChatToolbar.tsx` | 底部工具栏（模型选择、thinking level 等） |
| `ChatInput.tsx` | 仅 textarea + 事件处理 + 组装 |

**验收标准：**
- [ ] `ChatInput.tsx` < 600 行
- [ ] `forwardRef` 接口不变

---

## Phase 2：样式系统迁移

**目标**：从 739 处内联样式迁移到可维护的样式方案

### 2.1 引入 CSS 变量 + Tailwind（可选）

**推荐方案：CSS Modules + CSS 变量**

理由：
- 零构建配置变更（Next.js 原生支持）
- 与现有 `var(--bg)` 等 CSS 变量完美兼容
- 逐步迁移，不需要一次性改完

**执行策略：**
- 新组件一律使用 CSS Modules
- 旧组件按需迁移（改到哪个文件就顺便迁移）
- 保留现有的 CSS 变量体系（`--bg`, `--accent`, `--border` 等）

### 2.2 提取公共组件

当前多处重复的 UI 模式：

| 模式 | 出现次数 | 建议组件名 |
|------|----------|-----------|
| 行 hover 效果 | ~40 | `<HoverRow>` |
| 工具栏按钮 | ~25 | `<ToolButton>` |
| 面板 section header | ~10 | `<SectionHeader>` |
| 空状态提示 | ~8 | `<EmptyState>` |
| Loading 状态 | ~6 | `<LoadingState>` |

### 2.3 暗色模式支持

当前已经是暗色主题（`--bg` 系列），但硬编码在 `globals.css`。迁移后可以：
- 定义 `[data-theme="dark"]` 和 `[data-theme="light"]` 两套变量
- 在 header 加一个主题切换按钮

**验收标准：**
- [ ] 新组件 100% 使用 CSS Modules
- [ ] 至少 2 个旧组件完成迁移
- [ ] 公共组件库覆盖 80% 的重复模式

---

## Phase 3：类型安全

**目标**：消除所有 `: any`，利用 TypeScript 严格模式

### 3.1 修复 catch 块的 `any`

当前 15 处 `any` 中，11 处在 GitPanel 的 catch 块。

**方案：**
```typescript
// 之前
catch (err: any) { setError(err?.message || String(err)); }

// 之后
catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); }
```

### 3.2 补全 API 响应类型

当前 API 响应大多是内联 `as` 断言。建议：
- 在 `lib/types.ts` 中定义所有 API 响应类型
- 使用 `zod` 做运行时验证（可选，但推荐）

### 3.3 事件处理类型

`ChatInput` 和 `MessageView` 中有几处事件处理器缺少精确类型。

**验收标准：**
- [ ] `any` 使用数 = 0
- [ ] `tsc --strict` 通过（需要逐步开启）

---

## Phase 4：用户体验优化

### 4.1 全局快捷键系统

| 快捷键 | 功能 |
|--------|------|
| `Cmd/Ctrl + K` | 打开命令面板 |
| `Cmd/Ctrl + Shift + P` | 打开 Skill 菜单 |
| `Cmd/Ctrl + B` | 切换侧边栏 |
| `Cmd/Ctrl + J` | 切换 Git 面板 |
| `Cmd/Ctrl + Enter` | 发送消息 |

**实现：** 全局 `useEffect` 监听 `keydown`，在 `AppShell` 中统一管理

### 4.2 命令面板（Command Palette）

统一 `/` Skill 触发 和 `@` 文件提及 为一个搜索面板：
- `Cmd+K` 打开
- 输入关键词搜索 Skills、文件、最近会话
- 上下箭头选择，Enter 执行

### 4.3 Git Diff 视图升级

当前 Diff 是纯文本展示。升级为：
- Unified / Split 视图切换
- 语法高亮
- 行号显示
- 变更行高亮（绿色新增/红色删除）

### 4.4 ChatInput 增强

- 多行输入时自动扩展高度（当前是固定高度）
- Markdown 实时预览（可选）
- 拖拽文件上传

### 4.5 性能优化

- `MessageView` 已用 `memo`，但 `ChatWindow` 的 message 列表没有虚拟化
- 长对话（100+ 消息）建议用 `react-window` 或 `@tanstack/virtual`
- `SessionSidebar` 的 session 列表同理

---

## 执行顺序

```
Phase 1.1 (SessionSidebar 拆分)
    ↓
Phase 1.2 (ModelsConfig 拆分)
    ↓
Phase 1.3 (GitPanel 拆分)
    ↓
Phase 1.4 (ChatInput 拆分)
    ↓
Phase 2.1 (引入 CSS Modules)
    ↓
Phase 2.2 (提取公共组件)
    ↓
Phase 3.1 (修复 any 类型)
    ↓
Phase 4.1 (全局快捷键)
    ↓
Phase 4.2 (命令面板)
    ↓
Phase 4.3 (Diff 视图)
```

每个 Phase 完成后：
1. 跑 `tsc --noEmit` 确认无类型错误
2. 手动验证核心功能无回归
3. 提交 + 推送

---

## 风险提示

| 风险 | 缓解措施 |
|------|----------|
| 拆分时引入 bug | 每次只拆一个文件，拆完立即验证 |
| 样式迁移视觉差异 | 先迁移无视觉变化的组件，再迁移有差异的 |
| 类型修复暴露隐藏 bug | 这是好事，逐一修复 |
| 快捷键冲突 | 先检查浏览器/系统默认快捷键 |
