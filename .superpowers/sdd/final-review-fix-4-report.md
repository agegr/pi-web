# Final Review Fix 4

## Status

已修复 whole-branch reviewer 指出的两个 Important，未触碰原工作区，也未改变 Agent lifecycle 生产语义。

## 认证初始化限速

- `POST /api/auth/setup` 复用登录使用的 `loginRateKey`、来源桶和全局桶。
- 无效 setup token 进入相同的渐进延迟、来源临时拒绝和全局临时拒绝流程，并返回 `429` 与 `Retry-After`。
- 只有 token 验证失败会记录失败；密码校验、配置写入和成功初始化不会污染失败计数。
- 错误响应仍使用非敏感的通用信息。

## SSE 认证失效

- `pi-web-auth.ts` 新增 `subscribeSessionInvalidation`，按 session token 哈希订阅失效事件。
- 单 session logout、密码修改、`revokeAllSessions`、初始化导致的 session 清理和 TTL 到期都会通知订阅者。
- Agent SSE 在认证失效时幂等地清理 Agent 事件订阅、认证订阅和心跳并关闭 stream；不调用 Agent wrapper 的 `destroy`、`abort` 或 `shutdown`。
- client abort 与认证失效竞态共用幂等 cleanup。
- provider OAuth SSE 复用同一失效订阅并通过既有 abort 信号停止旧 OAuth 流和清理待处理 callback。

## 验证

- RED：新增 setup 限速和认证失效 SSE 测试在修复前分别以 `401 !== 429` 和未发生 SSE unsubscribe 失败；原测试还因旧 SSE 未关闭而超时。
- GREEN：修复后目标认证与 RPC 测试全部通过。
- 全量测试：`183` passed，`0` failed。
- TypeScript：`node_modules/.bin/tsc --noEmit` 通过。
- Lint：`npm run lint` 通过，无 warning。
- Diff 检查：`git diff --check` 通过。
- 未运行 `next build`。

## 未纳入范围

- 未修改 Agent lifecycle 生产逻辑。
- 未处理与本次共享认证入口无关的 provider logout Minor。
- 工作区原有的 `package-lock.json` 修改未纳入本次提交。
