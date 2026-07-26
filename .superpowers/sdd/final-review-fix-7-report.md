# Final Review Fix 7

## Status

已修复 `575c345` reviewer 指出的两个 Important，未修改 Agent lifecycle 生产语义。

## OAuth GET

- request 在 `ModelRuntime.create()` 期间 abort 会立即设置 closed，并执行幂等 cleanup。
- create 完成后重新检查 abort/closed，已取消请求不会调用 `login`。
- cleanup 统一清理 active callback、auth subscription、stream 和内部 abort signal。
- 已保留 login 期间 abort、late prompt/auth_url、session invalidation、client abort 和 pre-abort 行为。

## Agent SSE GET

- 在 `resolveSessionPath` 返回后和 `startRpcSession` 返回后重新检查 request signal。
- abort 后不会创建 SSE stream、heartbeat 或 Agent subscription。
- 如果 Agent 已经启动，abort 只结束请求侧流程，不调用 Agent 的 destroy、abort 或 shutdown。

## Tests

- 新增真实 deferred `ModelRuntime.create()` abort 测试。
- 新增真实 deferred `startRpcSession()` abort 测试。
- `node --test lib/*.test.mjs components/*.test.mjs`: 191 passed, 0 failed。
- `node --test lib/provider-oauth-route.test.mjs lib/rpc-manager.test.mjs`: 7 passed, 0 failed。
- `node_modules/.bin/tsc --noEmit`: passed。
- `npm run lint`: passed。
- `git diff --check`: passed。

## Concerns

- Node test runner 仍输出既有 `MODULE_TYPELESS_PACKAGE_JSON` performance warning；不影响测试结果，本次未修改 package module 配置。
- 按项目要求未运行 `next build`，避免污染 `.next/` 并破坏开发环境。
