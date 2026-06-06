# Project Rules

## General
- 使用 TypeScript，不用 JavaScript
- 使用 Next.js App Router（/app/api/xxx/route.ts）
- 组件放在 /components/ 目录，hooks 放 /hooks/，lib 放 /lib/
- 状态若多个组件共享则提至 AppShell，否则就近定义

## Code Style
- 组件函数用 `export function ComponentName()`
- CSS 用行内 style 对象或 globals.css 的 CSS Variables
- 不要引入第三方 UI 库（如 shadcn、antd 等）

## Error Handling
- API routes 统一返回 `Response.json({ error: string }, { status })`
- fetch 请求必须检查 `res.ok`，抛 Error

## Commits
- 提交信息用 conventional commits 格式：feat/fix/chore/docs
- 一个 PR 只做一个功能
