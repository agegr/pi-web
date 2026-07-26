# Final Review Fix 6

## Scope

- 修复 provider OAuth cleanup 后晚到 `prompt()`/`notify()` 的 pending token 泄漏。
- 修复 provider OAuth SSE 与 Agent SSE 对 pre-aborted Request 的处理。
- 修复同一 session 多个 invalidation listener 覆盖 expiration timer 的问题。
- 未修改 Agent lifecycle 生产语义；Agent pre-abort 在 session lookup/start 前直接返回。

## Tests

- 新增 OAuth cleanup 后晚到 prompt reject、notify no-op、registry 无新 token 测试。
- 新增 OAuth pre-abort 不调用 `ModelRuntime.create()` 测试。
- 新增 Agent SSE pre-abort 不调用 `session.onEvent()` 测试。
- 新增同一 session invalidation subscribers 复用单个 timer 测试。

## Verification

- Targeted tests: 58 passed。
- Full `node --test`: 189 passed, 1 failed；失败是现有 `app/api/models-config/test/route.ts` 被 Node 直接执行时无法解析 `next/server`，与本次变更无关。
- `node_modules/.bin/tsc --noEmit`: passed。
- `npm run lint`: passed，`ESLint: No issues found`。
- `git diff --check`: passed。
- 未运行 `next build`，遵循项目要求。

## Concerns

- 全量测试命令当前会扫描 Next route 文件；Node 直接执行 `app/api/models-config/test/route.ts` 时触发既有 ESM 解析错误。专项测试、TypeScript、lint 均通过。
- 工作区原有 `package-lock.json` 修改未触碰、未纳入本次 commit。
