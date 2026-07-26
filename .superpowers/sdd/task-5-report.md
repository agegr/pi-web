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

## Remaining Important 修复

### Status

已处理损坏认证配置的启动恢复策略，补齐已有有效配置不生成 setup token 的测试覆盖，并将 lifecycle 测试改为真实过期 session、真实 password route、proxy API 401 和 SSE 断开路径。未修改 `rpc-manager.ts` 的 Agent 销毁语义。

### RED/GREEN

- RED：新增“已有有效配置不生成 token”和“损坏配置启动输出本地恢复路径”的测试；前者因测试未先创建有效配置而失败，后者因 `announceSetupToken()` 尚未报告损坏配置而失败。lifecycle 测试先验证实际过期 session 的 password route 应为 401，并改用有效 session 通过 route 改密。
- GREEN：启动时对已有认证文件做结构校验；有效配置静默不生成 token，损坏配置只向 stderr 输出明确的损坏提示和配置路径，绝不把它当作未初始化或自动覆盖。proxy 读取认证状态异常时不再重定向到 setup，避免进入误导性的初始化流程；README 中同步记录人工恢复边界。已有有效配置测试先写入完整配置后重新启动子进程，验证不会生成 setup token。

### 变更

- `lib/pi-web-auth.ts`：`announceSetupToken()` 识别损坏配置并输出本地恢复提示；有效配置继续不生成或暴露初始化 token。
- `proxy.ts`：认证状态读取失败时改为登录入口，不把损坏配置静默视为未初始化。
- `lib/pi-web-auth.test.mjs`：修正已有配置测试名称和前置条件，增加损坏配置启动恢复测试。
- `lib/rpc-manager.test.mjs`：通过真实过期 session 调用 password route，使用新的有效 session 通过实际 route 改密，并保留 proxy API 401、SSE abort 与 `destroy`/`abort`/`shutdown`/`send` 计数不变断言；移除绕过 route 的底层 `changePassword` 调用。Bun 可用时测试使用 Bun 原生 TypeScript loader，否则仅在缺少 `jiti` 的环境明确 skip。
- `README.md` 和 `README.zh-CN.md`：说明损坏配置不会静默重置，以及停止服务、备份路径后由本机操作者修复或有意删除的恢复边界。

### 验证

- `node --test lib/pi-web-auth.test.mjs`: 40 通过，0 失败，0 skip。
- `node --test lib/pi-web-auth.test.mjs lib/rpc-manager.test.mjs`: 40 通过，1 skip，0 失败；lifecycle skip 原因是当前工作区缺少 `jiti`，且 Node strip-only loader 不支持 `rpc-manager.ts` 的 parameter property。
- `bun test lib/rpc-manager.test.mjs`: 无法加载真实 Agent 依赖，失败原因为缺少 `@earendil-works/pi-coding-agent`；未将该运行结果记为通过。
- `node --test lib/*.test.mjs components/*.test.mjs`: 129 通过，7 个测试因工作区缺少 `react`、`jiti`、`@earendil-works/pi-ai` 启动失败，1 个 lifecycle 测试明确 skip。
- `node_modules/.bin/tsc --noEmit`: 未执行，`node_modules/.bin/tsc` 不存在。
- `npm run lint`: 未得到有效结果；当前 ESLint runner 返回 `ESLint output (JSON parse failed: EOF while parsing a value at line 1 column 0)`。
- `git diff --check`: 通过。
- 未运行 `npm install` 或 `next build`。

### Concerns

- 当前工作区依赖不完整，真实 `AgentSessionWrapper` lifecycle 测试仍需在含 `jiti` 和 Pi Agent 依赖的环境重新运行；本次没有伪造通过结果，也没有安装依赖。
- 损坏配置的恢复仍是本地人工操作，不提供公网重置接口；服务不会覆盖原文件。

## 最终 reviewer 修复追加报告

### Status

已修复 Task 5 最终 reviewer 指出的配置隔离、非普通文件、Agent lifecycle spy、过期 SSE proxy 测试和 README Nginx 缩进问题。未修改 `lib/rpc-manager.ts` 的 Agent 生命周期语义。

### RED/GREEN

- RED：新增目录配置路径测试后，`consumeSetupToken("setup-token")` 错误返回 `true`，证明存在但非普通文件仍被当作未初始化；新增 lifecycle 测试在 auth 模块加载前设置临时配置路径，并移除 `resetAuthStateForTests()`。
- GREEN：增加配置路径存在性判定，目录等非普通文件现在视为损坏，不能生成或消费 setup token；lifecycle 测试通过真实 login 失败、过期 password、proxy API/SSE 401、真实 password route 和 SSE abort 验证 wrapper 的 `send`、底层 `prompt`、`destroy`、`abort`、`shutdown` 计数不变。

### 变更

- `lib/pi-web-auth.ts`：区分路径不存在与路径存在但非普通文件；后者拒绝 setup token，并通过测试辅助抛出明确损坏配置错误。
- `lib/pi-web-auth.test.mjs`：补充目录配置路径损坏回归测试。
- `lib/rpc-manager.test.mjs`：加载 auth 模块前设置独立临时 `PI_WEB_AUTH_CONFIG_PATH`，测试结束在 `finally` 清理路径和环境变量；不再调用会删除配置的 `resetAuthStateForTests()`；增加真实 wrapper `send` spy、底层 `prompt` 计数、错误登录和过期 SSE 经 proxy 返回 401 的断言。
- `README.md`：修正 Nginx 示例中 `proxy_set_header X-Forwarded-Proto` 和 `proxy_buffering` 的缩进。

### 验证

- `node --test lib/pi-web-auth.test.mjs lib/rpc-manager.test.mjs`：41 通过，1 skip，0 失败；skip 原因是当前工作区缺少 `jiti`，无法加载真实 TypeScript `AgentSessionWrapper`。
- `git diff --check`：通过。
- 未安装依赖，未运行 `next build`。

### Concerns

- 当前环境仍缺少 `jiti` 及 Pi Agent 依赖，因此 lifecycle 行为测试的真实 wrapper 分支需要在完整依赖环境再次执行；本次明确记录为 skip，未伪造通过。

## Task 5 最终 reviewer Important 修复追加报告

### Status

已修复认证配置路径对 broken symlink 的误判；目录、符号链接和其他非普通文件均按损坏配置处理，不生成或消费 setup token，也不会在初始化时覆盖原路径。未修改默认用户配置。

### RED/GREEN

- RED：新增 broken symlink 回归测试后，`consumeSetupToken("setup-token")` 错误返回 `true`，证明原 `statSync` 跟随符号链接并将 broken symlink 当作不存在。
- GREEN：配置路径检查改用 `lstatSync`，并在异步配置读取和同步 generation 读取前拒绝非普通文件；broken symlink 测试通过，且初始化不会替换符号链接。目录测试同步修正为新的损坏配置语义。

### 变更

- `lib/pi-web-auth.ts`：用 `lstatSync` 检查路径本身；仅 `ENOENT` 表示不存在，存在但不是普通文件的路径抛出损坏配置错误。
- `lib/pi-web-auth.test.mjs`：增加 broken symlink 回归测试，验证 token 拒绝、初始化拒绝和符号链接保留；将目录测试断言更新为损坏配置错误。

### 验证

- `node --test lib/pi-web-auth.test.mjs lib/rpc-manager.test.mjs`：认证测试 42 通过；RPC 测试因当前 `jiti` 无法解析 `@/lib/session-reader` 别名失败，另有 1 个旧目录断言已修正后未重新计入该次结果。
- `git diff --check`：通过。

### Concerns

- 当前环境的 RPC 测试运行器无法解析项目 `@/` 路径别名；未安装依赖或修改运行环境，因此无法在本地完成该测试的真实 wrapper 分支验证。

## Task 5 最终验证修复追加报告

### Status

已修复 lifecycle 测试的 TypeScript 与 `@/` alias 加载、失败安全清理、有效配置静默验证、logout route 生命周期调用和中文 README Nginx 缩进。未修改生产 Agent lifecycle 语义。

### RED/GREEN

- RED：直接运行 `node --test lib/rpc-manager.test.mjs` 暴露 `@/lib/session-reader` 无法解析；启用 `tsconfigPaths` 后新增 logout 调用先以 415 暴露测试请求缺少 JSON `Content-Type`；有效配置静默断言则被 Node 的 `.ts` module warning 污染。
- GREEN：使用项目已有 `jiti` 并开启 `{ tsconfigPaths: true }`；将真实 wrapper、原 registry、`Date.now`、临时配置和环境变量恢复放入 `finally`；补齐 logout route 的真实 JSON 请求；子进程静默断言设置 `NODE_NO_WARNINGS=1` 后通过。

### 变更

- `lib/rpc-manager.test.mjs`：移除缺少依赖时 skip 分支，使用项目 `jiti` 的 tsconfig paths loader；在 `finally` 中销毁真实 wrapper、恢复 registry、时间和环境；补充真实 logout route 生命周期调用。
- `lib/pi-web-auth.test.mjs`：有效配置启动测试同时断言 stderr 为空，并排除 Node module warning 对业务输出的干扰。
- `README.zh-CN.md`：修正 Nginx `proxy_set_header X-Forwarded-Proto` 与 `proxy_buffering` 缩进。

### 验证

- `node --test lib/rpc-manager.test.mjs`：1 通过，0 失败，0 skip。
- `node --test lib/rpc-manager.test.mjs lib/pi-web-auth.test.mjs`：43 通过，0 失败，0 skip。
- `git diff --check`：通过。
- 未运行 `next build`，符合项目要求。

### Concerns

- Node 仍会对直接加载 `.ts` 模块输出一个外层 `MODULE_TYPELESS_PACKAGE_JSON` warning；该 warning 不影响测试结果，静默业务输出的子进程测试已通过 `NODE_NO_WARNINGS=1` 隔离。
- 工作区已有未由本次任务修改的 `package-lock.json` 变更，未纳入本次提交。

## Task 5 最终 reviewer 测试缺口修复

### Status

已补齐最终 reviewer 指出的 logout 生命周期断言顺序、Agent SSE cleanup、running registry 监听移除和中文 Nginx 示例缩进。未修改生产 Agent lifecycle 语义。

### 变更

- `lib/rpc-manager.test.mjs`：将真实 logout route 调用移到完整 `send`、底层 `prompt`、`destroy`、`abort`、`shutdown` 计数及 wrapper 存活状态断言之前；logout 后再次完整断言计数和状态不变。
- `lib/rpc-manager.test.mjs`：为 Agent SSE 的 `onEvent()` cleanup 建立 spy，abort 后断言只清理 SSE 监听；为 running SSE 记录全局 registry listener 数量，abort 后断言订阅移除、Agent 仍存活且 running 状态不变。
- `README.zh-CN.md`：修正 Nginx `proxy_set_header X-Forwarded-Proto` 和 `proxy_buffering` 的缩进。

### TDD 证据

- RED：先加入 logout 后生命周期完整断言、Agent SSE cleanup spy 和 running registry 监听数量断言，验证这些 reviewer 要求被测试直接覆盖。
- GREEN：现有 SSE route 的最小 cleanup 已满足断言，因此未修改生产 Agent lifecycle 或新增注入接口。

### 验证

- `node --test lib/rpc-manager.test.mjs lib/pi-web-auth.test.mjs`：43 通过，0 失败，0 skip。
- `git diff --check`：通过。

### Concerns

- Node 仍会输出外层 `MODULE_TYPELESS_PACKAGE_JSON` warning；不影响测试结果，业务测试无失败。
- 工作区已有未由本次任务修改的 `package-lock.json` 变更，未纳入本次提交。
