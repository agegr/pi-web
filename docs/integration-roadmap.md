# Pi-Web 功能提升路线图

> 基于 oh-my-pi 对比分析和现有优化计划的综合建议

---

## 📊 现状分析

### 当前技术栈
- **框架**: Next.js 16.2.1 + React 19
- **核心依赖**: 
  - `@earendil-works/pi-ai` ^0.76.0
  - `@earendil-works/pi-coding-agent` ^0.76.0
  - `@oh-my-pi/hashline` ^15.5.10 ✅
- **代码规模**: 14 组件 + 18 API 路由
- **技术债**: 4 个超大组件（最大 1700 行）、739 处内联样式、15 处 `any` 类型

### oh-my-pi 生态
- **版本**: v15.5.10（最新稳定版）
- **核心包**: 7 个 npm 包 + 4 个 Rust crates
- **规模**: ~27k 行 Rust + 大量 TypeScript
- **能力**: 32 工具、40+ AI 提供商、LSP/DAP、浏览器驱动、子代理系统

---

## 🎯 集成策略：先优化，再扩展

### 为什么不立即集成？

**依赖冲突风险**:
```
pi-web 使用:     @earendil-works/pi-ai@0.76.0
oh-my-pi 使用:   @oh-my-pi/pi-ai@15.5.10
```

这两个包可能是不同的 fork，API 可能不兼容。在当前代码质量下（4 个超大组件、类型不安全），强行集成会导致：
- 难以定位集成问题
- 回归测试困难
- 技术债进一步累积

**建议策略**: **先重构，再集成**

---

## 📋 三阶段路线图

### 🔧 Phase 1: 代码质量提升（2-3 周）

**目标**: 为集成工作打好基础

#### 1.1 大文件拆分
按照 `optimization-plan.md` 执行：
- [ ] SessionSidebar.tsx (1700 行 → 400 行)
- [ ] ModelsConfig.tsx (1664 行 → 400 行)
- [ ] GitPanel.tsx (1134 行 → 400 行)
- [ ] ChatInput.tsx (1132 行 → 400 行)

**收益**: 代码可维护性提升，便于后续集成新功能

#### 1.2 类型安全
- [ ] 消除所有 `any` 类型（15 处）
- [ ] 补全 API 响应类型
- [ ] 启用 `tsc --strict`

**收益**: 集成新包时能及时发现类型不兼容

#### 1.3 样式系统迁移
- [ ] 引入 CSS Modules
- [ ] 提取公共组件（HoverRow, ToolButton 等）
- [ ] 迁移 739 处内联样式

**收益**: UI 组件可复用，便于添加新面板

---

### 🚀 Phase 2: 渐进式集成（3-4 周）

**策略**: 从低风险、高价值的功能开始

#### 2.1 统计仪表板（独立功能，零风险）

**集成 `@oh-my-pi/omp-stats`**

```bash
npm install @oh-my-pi/omp-stats@^15.5.10
npm install chart.js react-chartjs-2 date-fns
```

**实现**:
```typescript
// app/stats/page.tsx
import { StatsClient } from '@oh-my-pi/omp-stats/client';

export default function StatsPage() {
  return <StatsClient />;
}
```

**工作量**: 1-2 天  
**风险**: 低（独立页面，不影响现有功能）  
**价值**: 高（实时成本追踪、使用统计）

---

#### 2.2 原生性能加速（可选依赖）

**集成 `@oh-my-pi/pi-natives`**

```bash
npm install @oh-my-pi/pi-natives@^15.5.10
```

**实现**:
```typescript
// lib/native-search.ts
import { grep } from '@oh-my-pi/pi-natives';

export async function searchFiles(query: string, cwd: string) {
  try {
    return await grep({ pattern: query, path: cwd });
  } catch {
    // 降级到 Node.js 实现
    return fallbackSearch(query, cwd);
  }
}
```

**工作量**: 2-3 天  
**风险**: 中（需要测试跨平台兼容性）  
**价值**: 高（文件搜索性能提升 10-100x）

**注意**: 作为可选依赖，安装失败时自动降级

---

#### 2.3 依赖升级评估（高风险）

**目标**: 评估从 `@earendil-works/*` 迁移到 `@oh-my-pi/*` 的可行性

**步骤**:
1. 在测试分支安装 `@oh-my-pi/pi-ai` 和 `@oh-my-pi/pi-coding-agent`
2. 运行类型检查，记录所有不兼容的 API
3. 创建兼容层或适配器
4. 全量回归测试

**工作量**: 5-7 天  
**风险**: 高（可能需要大量适配工作）  
**决策点**: 如果不兼容太多，暂缓升级

---

### 🌟 Phase 3: 高级功能扩展（4-6 周）

**前提**: Phase 2.3 依赖升级成功

#### 3.1 多提供商支持
- 支持 40+ AI 提供商（Grok, Mistral, Groq, Ollama 等）
- 更新 ModelsConfig 组件

**工作量**: 3-5 天

#### 3.2 Web 搜索工具
- 集成 14 个搜索提供商
- 添加 WebSearchCard 组件
- 支持 arXiv、Stack Overflow 等专业内容提取

**工作量**: 4-5 天

#### 3.3 LSP 代码智能
- 定义跳转、引用查找
- 智能重命名
- 代码诊断面板

**工作量**: 7-10 天

#### 3.4 浏览器驱动
- Puppeteer 集成
- 截图和自动化测试
- BrowserPanel 组件

**工作量**: 5-7 天

#### 3.5 子代理系统
- 并行任务执行
- SubagentCard 和 SubagentTree 组件
- 工作区隔离

**工作量**: 7-10 天

---

## 🎯 快速胜利：立即可做的 3 件事

### 1. 集成统计仪表板（1-2 天）

**价值**: 为用户提供成本追踪和使用分析  
**风险**: 极低（独立功能）  
**实现**: 见 Phase 2.1

---

### 2. 添加全局快捷键（1 天）

**价值**: 提升操作效率  
**风险**: 低  
**实现**:
```typescript
// components/AppShell.tsx
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openCommandPalette();
    }
    // ... 其他快捷键
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

---

### 3. 提取公共 UI 组件（2-3 天）

**价值**: 减少重复代码，统一视觉风格  
**风险**: 低  
**实现**:
```typescript
// components/ui/HoverRow.tsx
export function HoverRow({ children, onClick }: Props) {
  return (
    <div 
      className="hover-row"
      onClick={onClick}
    >
      {children}
    </div>
  );
}
```

---

## 📊 投入产出分析

### Phase 1: 代码质量提升
- **投入**: 2-3 周
- **产出**: 可维护性提升 3-5x，为后续集成打基础
- **优先级**: ⭐⭐⭐⭐⭐

### Phase 2.1: 统计仪表板
- **投入**: 1-2 天
- **产出**: 成本追踪、使用分析
- **优先级**: ⭐⭐⭐⭐⭐

### Phase 2.2: 原生性能加速
- **投入**: 2-3 天
- **产出**: 搜索性能提升 10-100x
- **优先级**: ⭐⭐⭐⭐

### Phase 2.3: 依赖升级
- **投入**: 5-7 天
- **产出**: 解锁 oh-my-pi 全部功能
- **优先级**: ⭐⭐⭐（高风险，需谨慎评估）

### Phase 3: 高级功能
- **投入**: 4-6 周
- **产出**: 40+ 提供商、LSP、浏览器驱动、子代理
- **优先级**: ⭐⭐⭐（依赖 Phase 2.3 成功）

---

## ⚠️ 风险与缓解

### 风险 1: 依赖不兼容
**概率**: 高  
**影响**: 严重（可能无法升级）  
**缓解**: 
- 先在测试分支验证
- 准备回退方案
- 考虑维护兼容层

### 风险 2: 重构引入 bug
**概率**: 中  
**影响**: 中等  
**缓解**:
- 每次只拆一个文件
- 拆完立即验证
- 增加自动化测试

### 风险 3: 原生模块安装失败
**概率**: 中（Windows 环境）  
**影响**: 低（可降级）  
**缓解**:
- 作为可选依赖
- 提供纯 JS 降级方案
- 预编译二进制文件

---

## 🎯 推荐执行顺序

```
Week 1-2: Phase 1.1-1.2 (拆分 SessionSidebar + ModelsConfig)
Week 3:   Phase 1.3-1.4 (拆分 GitPanel + ChatInput)
Week 4:   Phase 2.1 (集成统计仪表板) ← 快速胜利
Week 5:   Phase 1.2 (类型安全) + Phase 2.2 (原生加速)
Week 6:   Phase 2.3 (依赖升级评估)
Week 7+:  根据 Phase 2.3 结果决定是否进入 Phase 3
```

---

## 💡 关键决策点

### 决策点 1: 是否升级到 @oh-my-pi/* 包？
**时机**: Week 6  
**判断标准**:
- API 兼容性如何？
- 需要多少适配工作？
- 是否有破坏性变更？

**如果不兼容**:
- 继续使用 `@earendil-works/*`
- 仅集成独立功能（stats, natives）
- 等待上游合并或提供兼容层

### 决策点 2: 是否集成 Rust 原生模块？
**时机**: Week 5  
**判断标准**:
- Windows 环境能否正常安装？
- 性能提升是否显著？
- 降级方案是否可靠？

---

## 📚 参考文档

- [oh-my-pi 功能对比](./oh-my-pi-integration-opportunities.md)
- [优化计划](./optimization-plan.md)
- [oh-my-pi 官方文档](https://omp.sh/docs)
- [oh-my-pi GitHub](https://github.com/can1357/oh-my-pi)

---

## 🎯 总结

**核心策略**: 先优化代码质量，再渐进式集成新功能

**立即可做**:
1. ✅ 集成统计仪表板（1-2 天，低风险高价值）
2. ✅ 添加全局快捷键（1 天）
3. ✅ 提取公共 UI 组件（2-3 天）

**中期目标**:
- 完成代码重构（2-3 周）
- 评估依赖升级可行性（1 周）

**长期愿景**:
- 如果依赖兼容，集成 oh-my-pi 全部高级功能
- 如果不兼容，维持现状并选择性集成独立模块

**总投入**: 6-12 周（取决于依赖升级是否成功）
