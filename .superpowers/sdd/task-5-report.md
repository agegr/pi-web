# Task 5 报告

## 状态

已完成 Task 5 的文档更新和 Agent lifecycle regression tests。未修改 `rpc-manager.ts` 的 Agent 销毁语义。

## 变更

- `README.md` 和 `README.zh-CN.md` 增加公网部署、首次 token、认证配置路径、24 小时 session、改密、HTTPS/Nginx 反代、SSE 长连接、安全边界和容器挂载说明。
- `lib/rpc-manager.test.mjs` 增加回归测试，确认认证代理、登出、改密、认证状态及 SSE 客户端断开路径不调用 Agent wrapper 的 `destroy`、`abort`、`shutdown` 或 `send`，并保留 running registry API 和 SSE cleanup 断言。

## TDD 证据

先加入回归断言并运行 `node --test lib/rpc-manager.test.mjs`，测试按预期失败，原因是初始断言匹配了不存在的 `getRpcSession(id)?.destroy()` 形式。随后将断言调整为当前实际导出和 running 状态接口，重新运行后 3 个测试全部通过。

## 验证

- `node --test lib/rpc-manager.test.mjs`: 3 通过，0 失败。
- `node --test lib/*.test.mjs components/*.test.mjs`: 129 通过，7 个测试因工作区缺少依赖而启动失败；缺失依赖为 `react`、`jiti`、`@earendil-works/pi-ai`。
- `node_modules/.bin/tsc --noEmit`: 未执行，`node_modules/.bin/tsc` 不存在。
- `npm run lint`: 未得到有效结果；本地 ESLint/runner 依赖不完整，runner 返回 `ESLint output (JSON parse failed: EOF while parsing a value at line 1 column 0)`。
- 未运行 `next build`，符合项目要求。
- `git diff --check`: 通过。
- README 敏感信息检查：未发现实际密码、初始化 token、session token、cookie 或 API key。

## 风险与限制

当前工作区依赖不完整，因此完整测试、TypeScript 和 lint 不能在本地完成。没有安装依赖，因为 Task 5 未授权修改依赖环境，且安装会产生外部副作用。

## Reviewer 修复追加报告

### Status

已修复首启 token 生产输出、RPC lifecycle 测试、README 文档遗漏；未修改 `lib/rpc-manager.ts` 的 Agent 销毁语义。

### RED/GREEN

- RED：先增加启动公告和可执行 RPC 行为测试；启动测试因 `announceSetupToken` 不存在失败，RPC 测试因当前 Node 的 strip-only TypeScript 模式无法直接加载 `rpc-manager.ts` 失败。
- GREEN：增加 `announceSetupToken()` 和 `instrumentation.ts` Node.js 启动钩子；测试改用项目已有 `jiti`（依赖可用时）加载真实 TypeScript 模块，并通过真实 auth route、proxy 401、SSE abort、改密路径断言 lifecycle spy 计数不变。
- 当前环境没有 `jiti`，所以 RPC 行为测试明确 skip；没有将 skip 记录为通过。

### 变更

- 首启 token 使用 32-byte `randomBytes`，只由服务端启动钩子通过 `console.error` 输出一次；不写入 HTTP response、浏览器、cookie 或配置文件。输出在进程内幂等，`bin/pi-web.js` 仅继承服务端 stderr，不接收或转发 token 到客户端。
- `lib/pi-web-auth.test.mjs` 验证只输出一行高熵 token、重复调用不重复输出、stdout/HTTP body/配置文件不泄露 token。
- `lib/rpc-manager.test.mjs` 移除源码正则测试，改为行为测试，覆盖认证过期、API 401、SSE 断开和改密，并断言 `destroy`、`abort`、`shutdown`、`send` 计数不变。
- 中英文 README 增加普通 npm 项目安装说明、Nginx `proxy_buffering off;`，并明确 token 只输出服务端终端 stderr 或服务端日志。

### 验证

- `node --test lib/pi-web-auth.test.mjs lib/rpc-manager.test.mjs`: 38 通过，1 skip，0 失败；skip 原因是缺少 `jiti`。
- `node --test lib/*.test.mjs components/*.test.mjs`: 127 通过，1 skip，7 个测试启动失败；缺少 `react`、`jiti`、`@earendil-works/pi-ai`。
- `node_modules/.bin/tsc --noEmit`: 未执行成功；`node_modules/.bin/tsc` 不存在。
- `npm run lint`: 未得到有效结果；当前 ESLint runner 返回 `ESLint output (JSON parse failed: EOF while parsing a value at line 1 column 0)`。
- `git diff --check`: 通过。
- 未运行 `next build`，符合项目要求。

### Concerns

- 完整验证仍受工作区缺失依赖阻塞；未安装依赖，也未伪造 TypeScript、lint 或完整测试通过。
- `jiti` 可用的完整依赖环境中需要重新运行 RPC 行为测试，确认真实 `AgentSessionWrapper` 类型和 Next 路由加载链路。
