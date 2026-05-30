# Pi Web 文档目录

## 📚 核心文档

| 文档 | 说明 |
|------|------|
| [AGENTS.md](../AGENTS.md) | 架构文档，系统设计和生命周期 |
| [README.md](../README.md) | 项目概述和快速开始 |

## 🔧 功能文档

### Hashline 编辑系统

| 文档 | 说明 |
|------|------|
| [hashline.md](hashline.md) | Hashline 编辑系统使用指南 |
| [hashline-integration-complete.md](hashline-integration-complete.md) | Hashline 集成完成文档 |

### 安全编辑系统

| 文档 | 说明 |
|------|------|
| [safe-edit.md](safe-edit.md) | 安全编辑系统使用指南 |

### 其他功能

| 文档 | 说明 |
|------|------|
| [error-handling.md](error-handling.md) | 聊天错误提示（余额不足/限流/鉴权/网络） |
| [git-panel.md](git-panel.md) | Git 面板设计文档 |
| [sidebar-design.md](sidebar-design.md) | 侧边栏设计文档 |

## 🗺️ 规划文档

| 文档 | 说明 |
|------|------|
| [integration-roadmap.md](integration-roadmap.md) | 集成路线图 |
| [oh-my-pi-integration-opportunities.md](oh-my-pi-integration-opportunities.md) | oh-my-pi 集成机会 |
| [optimization-plan.md](optimization-plan.md) | 优化计划 |

## 📁 原型文档

| 文档 | 说明 |
|------|------|
| [hashline-prototype/](../hashline-prototype/) | Hashline 原型项目 |

## 🎯 演示页面

| 页面 | 说明 |
|------|------|
| [http://localhost:3030/hashline-demo](http://localhost:3030/hashline-demo) | Hashline 编辑演示 |
| [http://localhost:3030/safe-edit-demo](http://localhost:3030/safe-edit-demo) | 安全编辑演示 |

## 📝 文档维护

### 文档规范

1. **统一位置** - 所有文档放在 `docs/` 目录
2. **清晰命名** - 使用小写字母和连字符
3. **完整内容** - 包含概述、使用方法、API 参考
4. **及时更新** - 功能变更时同步更新文档

### 文档模板

```markdown
# 功能名称

## 概述

简要描述功能的作用和价值。

## 使用方法

### 1. 基本用法

提供简单的使用示例。

### 2. 高级用法

提供高级功能示例。

## API 参考

详细说明 API 参数和返回值。

## 参考资源

提供相关链接和资源。
```
