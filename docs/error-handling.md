# 聊天错误提示

## 概述

当模型请求失败（余额不足、限流、鉴权失败、网络异常等）时，向用户展示清晰、可操作的中文错误提示，而不是让界面卡在"运行中"或只显示一条空白消息。

此前的问题：模型返回错误时前端无任何反馈，用户长时间不知道发生了什么。

## 错误如何贯穿事件流

pi 框架（`@earendil-works/pi-ai`）的流式协议约定：一次助手消息要么以成功结束，要么以错误结束，错误时返回的 `AssistantMessage` 带有 `stopReason: "error"`（或 `"aborted"`）和 `errorMessage` 字段。

错误经过两条路径之一抵达前端：

1. **模型返回错误消息**（最常见，含余额不足）
   - pi 通过 `message_end` 事件推送一条 `stopReason:"error"` + `errorMessage` 的助手消息（`content` 通常为空）。
   - 后端 `app/api/agent/[id]/events/route.ts` 将其原样转为 SSE 推给前端。
   - 前端 `hooks/useAgentSession.ts` 的 `message_end` 分支将该消息加入消息列表。
   - `components/MessageView.tsx` 的 `AssistantMessageView` 检测到 `stopReason === "error"` 时渲染 `ErrorBanner`。

2. **`prompt()` 在产生任何事件前直接抛错**（如调用层异常）
   - `lib/rpc-manager.ts` 的 `prompt` 分支捕获该 reject，打印到 stderr 并向订阅者推送一个 `{ type: "error", message }` 事件。
   - 前端 `useAgentSession.ts` 的 `error` 分支复位运行状态，并插入一条错误助手消息。

> 设计要点：`prompt()` 是 fire-and-forget（事件经由 `subscribe` 异步到达），因此它的 reject **必须**被显式转成事件，否则 SSE 流会静默空等到超时，表现为"聊天没反应"。

## 错误分类

`ErrorBanner`（`components/MessageView.tsx`）根据 `errorMessage` 文本归类，给出对应的友好提示，并始终保留原始错误信息供排查：

| 类别 | 匹配关键词（不区分大小写） | 提示 |
|------|---------------------------|------|
| 余额不足 | `insufficient` / `balance` / `quota` / `credit` / `payment` / `余额` / `额度` / `欠费` / `arrears` / `402` | 余额不足或额度用尽，请充值后重试，或切换其它模型 |
| 限流 | `rate limit` / `too many requests` / `429` | 请求过于频繁，请稍候再试 |
| 鉴权失败 | `unauthorized` / `invalid key` / `api key` / `forbidden` / `401` / `403` | API Key 可能无效或已过期，请检查密钥 |
| 网络/超时 | `timeout` / `timed out` / `econnreset` / `network` / `fetch failed` / `enotfound` | 网络异常或请求超时，请检查网络后重试 |
| 其它 | （兜底） | 模型请求失败 |

## 涉及文件

| 文件 | 职责 |
|------|------|
| `lib/rpc-manager.ts` | `prompt()` 失败时推送 `error` 事件，不再静默吞错 |
| `hooks/useAgentSession.ts` | 处理 `error` 事件并复位运行状态；`message_end` 透传错误消息 |
| `components/MessageView.tsx` | `ErrorBanner` 组件：错误分类与展示 |

## 验证

- 错误分类逻辑覆盖中英文余额、402、429、401、网络超时等场景。
- 端到端：用无效 API Key 触发真实 `401`，确认 `errorMessage` 完整贯穿 `message_end`，UI 正确展示。
