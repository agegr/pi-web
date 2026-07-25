# Task 1 报告

## Status

完成 Task 1。仅新增 brief 指定的 `lib/pi-web-auth.ts` 和 `lib/pi-web-auth.test.mjs`。

## TDD 证据

### RED

命令：

```bash
node --test lib/pi-web-auth.test.mjs
```

结果：4 个测试全部失败，失败原因为 `ERR_MODULE_NOT_FOUND`，目标 `lib/pi-web-auth.ts` 尚未实现。

### GREEN

命令：

```bash
node --test lib/pi-web-auth.test.mjs
```

结果：4 个测试通过，0 个失败。

输出摘要：`tests 4`, `pass 4`, `fail 0`。

额外执行：

```bash
node_modules/.bin/tsc --noEmit
```

结果：当前 worktree 没有 `node_modules/.bin/tsc`，无法执行 TypeScript 类型检查。

## 实现内容

- 使用 Node.js 内置 `scrypt`、`randomBytes`、`timingSafeEqual` 完成密码哈希和校验。
- 认证配置按父目录创建、同目录临时文件、`0600` 权限、原子 `rename` 流程写入。
- 配置读取错误和 JSON 损坏错误原样抛出；公开 `AuthState` 不含凭据字段。
- setup token 在模块加载时生成，成功消费后删除；已有配置时不接受初始化。
- session 仅在内存保存 SHA-256 token 哈希、时间和 generation，TTL 为 24 小时。
- 支持全量和单个 session 撤销，以及失败次数达到 5 次后的 15 分钟限速。

## Commit

`0e90161 feat: add pi web auth core`

Self-review 修复提交：`4f0f297 fix: defer auth setup token generation`。

## Concerns

- 运行时测试触发 Node.js 关于 `.ts` ESM 解析的 `MODULE_TYPELESS_PACKAGE_JSON` warning；这是当前项目直接用 `node --test` 加载 TypeScript 文件的环境提示，不影响测试结果。
- 类型检查因 worktree 缺少依赖未执行。

## Reviewer 修复追加

### TDD 证据

#### RED

在修正新增测试的语法错误后运行：

```bash
node --test lib/pi-web-auth.test.mjs
```

结果：13 个测试中 7 个失败。失败准确暴露默认路径错误、损坏配置清理问题，以及初始化后 session/generation、失败重试和配置存在检查尚未满足。

#### GREEN

补充并实现修复后运行：

```bash
node --test lib/pi-web-auth.test.mjs
```

结果：15 个测试通过，0 个失败，覆盖默认路径、0600、原子写入清理、损坏 JSON、24 小时 TTL、单 session 吊销、初始化吊销、重启 session 失效、并发初始化、写入失败可重试、配置存在拒绝和 setup token 高熵。

### 修复内容

- `getAuthConfigPath()` 读取 `PI_WEB_AUTH_CONFIG_PATH`，否则读取 `PI_CODING_AGENT_DIR`，最终默认到 `~/.pi/agent/pi-web-auth.json`。
- `consumeSetupToken()` 每次接受 token 前重新检查配置文件；初始化过程增加并发锁和写入前复查，避免竞态覆盖。
- 初始化成功后清空已有 session 并同步提升 generation；写入失败会清理临时文件并恢复未消费 token，使操作可重试。
- 增加 reviewer 要求的认证路径、权限、损坏 JSON、session 生命周期、初始化并发和 token 安全测试。

### 验证

- `node --test lib/pi-web-auth.test.mjs`：15 pass，0 fail。
- `node_modules/.bin/tsc --noEmit`：未执行成功，当前 worktree 没有 `node_modules/.bin/tsc`。
- `npm run lint`：未执行成功，当前 worktree 的 ESLint 命令没有产生可解析输出。

### Files

- `lib/pi-web-auth.ts`
- `lib/pi-web-auth.test.mjs`
- `.superpowers/sdd/task-1-report.md`

### Concerns

- 当前 worktree 缺少 Node 依赖，类型检查无法执行；ESLint 也无法获得有效输出。
- 仅保留并稳定 brief 已定义的认证接口；新增的 `getSetupTokenForTests()` 仅用于测试熵值验证，不作为后续 API 依赖。

## Important Findings 修复

### TDD 证据

#### RED

新增全局限速、窗口恢复、消费 token 后写入失败重试和严格配置结构测试后运行：

```bash
node --test lib/pi-web-auth.test.mjs
```

结果：18 个测试中 16 个通过、2 个失败。失败准确暴露全局失败桶缺失，以及结构化 JSON 未校验；写入失败测试已覆盖目标路径故障场景。

#### GREEN

实现修复后运行：

```bash
node --test lib/pi-web-auth.test.mjs
```

结果：18 个测试通过，0 个失败。

### 修复内容

- 增加独立全局登录失败桶；`checkLoginRateLimit()` 同时检查来源桶和全局桶，并分别清理过期窗口，轮换来源不能绕过全局限速。
- 初始化失败恢复改为仅在目标路径不存在合法普通配置文件时恢复 token；目标路径临时为目录不会永久消耗 token，修复后可用同一 token 重试，成功落盘后 token 仍失效。
- 对认证配置严格校验必需字段、字段类型、额外字段、hex 格式、hash/salt 长度、generation 和 UTC ISO 时间字段；损坏结构明确抛出 `认证配置结构无效`。
- 为导出的认证接口和公开类型字段补充简体中文 JSDoc，补齐参数、返回值及适用异常说明。

### 验证

- `node --test lib/pi-web-auth.test.mjs`：18 pass，0 fail。
- `git diff --check`：通过。
- `node_modules/.bin/tsc --noEmit`：未执行成功，当前 worktree 没有 `node_modules/.bin/tsc`。

### Concerns

- Node 测试仍提示 `.ts` ESM 的 `MODULE_TYPELESS_PACKAGE_JSON` warning，不影响测试结果。
- 类型检查因 worktree 缺少依赖无法执行。

## Final Reviewer Important 修复

### TDD 证据

#### RED

新增进程重启回归测试后运行：

```bash
node --test lib/pi-web-auth.test.mjs
```

结果：19 个测试中 18 个通过、1 个失败。失败准确显示重启进程创建的 session 使用 `generation: 1`，而持久化配置和 `getAuthState()` 使用 `generation: 2`。

#### GREEN

同步认证代次并补充持久化代次回归测试后运行：

```bash
node --test lib/pi-web-auth.test.mjs
```

结果：19 个测试通过，0 个失败。

### 修复内容

- `getAuthState()` 首次读取合法配置时同步内存 `authGeneration`。
- 新建或校验 session 前，在进程尚未初始化代次时读取并校验持久化 generation；`revokeAllSessions()` 也在提升代次前同步配置，确保相关 session 操作使用一致代次。
- 增加模拟进程重启测试，验证持久化 `generation: 2` 时新 session 返回 `generation: 2`。

### 验证

- `node --test lib/pi-web-auth.test.mjs`：19 pass，0 fail。
- `git diff --check`：通过。

### Commit

待提交：修复进程重启后的认证 generation 同步。

### Concerns

- Node 测试仍提示 `.ts` ESM 的 `MODULE_TYPELESS_PACKAGE_JSON` warning，不影响测试结果。
- 类型检查未执行，当前 worktree 没有 `node_modules/.bin/tsc`；本次用户要求的测试和 diff 检查均已执行。

## Final Reviewer Important 修复：并发全量吊销串行化

### 根因

`revokeAllSessions()` 在异步 `writeConfig()` 前没有进程内互斥。两个并发调用都可能读取相同的持久化 `generation`，并分别写入相同的下一代，导致两次吊销最终只递增一次。

### TDD 证据

#### RED

新增并发全量吊销回归测试后运行：

```bash
node --test lib/pi-web-auth.test.mjs
```

结果：22 个测试中 21 个通过、1 个失败；并发测试实际持久化 `generation: 3`，预期为 `generation: 4`，准确复现丢失递增问题。

#### GREEN

增加进程内 Promise 串行化队列后运行：

```bash
node --test lib/pi-web-auth.test.mjs
```

结果：22 个测试通过，0 个失败。

```bash
git diff --check
```

结果：通过。

### 修复内容

- `revokeAllSessions()` 通过进程内 Promise 队列串行执行完整的读取、generation 递增、原子持久化和内存状态提交事务。
- 队列尾部对成功和失败都恢复为已完成 Promise，因此一次写入失败会保留旧内存状态并且不会阻塞后续吊销调用。
- 保持 `revokeAllSessions(): Promise<void>` 异步接口，调用方和后续 route 可以继续 `await`。
- `resetAuthStateForTests()` 同步重置队列，避免测试状态泄漏。

### Commit

待提交。

### Concerns

- Node 测试仍提示 `.ts` ESM 的 `MODULE_TYPELESS_PACKAGE_JSON` warning，不影响测试结果。
- 类型检查未执行，当前 worktree 没有 `node_modules/.bin/tsc`；本次用户要求的测试和 diff 检查均已执行。

## Final Reviewer 唯一 Important 修复：持久化全量吊销代次

### TDD 证据

#### RED

新增“全量吊销后重启进程使用新的持久化 generation”和“写入失败时不提交内存代次”回归测试后运行：

```bash
node --test lib/pi-web-auth.test.mjs
```

结果：21 个测试中 19 个通过、2 个失败。重启测试显示吊销后 generation 仍为旧值；写入失败场景显示旧实现先同步了路径状态但没有进入配置原子写入。

#### GREEN

实现持久化吊销并重新运行：

```bash
node --test lib/pi-web-auth.test.mjs
```

结果：21 个测试通过，0 个失败。

### 修复内容

- `revokeAllSessions()` 改为异步复用已有 `writeConfig()` 原子写入逻辑，基于磁盘配置递增 generation 并更新 `updatedAt`。
- 只有原子写入成功后才清空 session、提交内存 generation；写入失败会恢复同步前的内存代次和初始化状态，避免内存与磁盘不一致。
- 增加模拟重启测试，确认全量吊销后新进程创建的 session 使用新的持久化 generation。

### 验证

- `node --test lib/pi-web-auth.test.mjs`：21 pass，0 fail。
- `git diff --check`：通过。

### Concerns

- Node 测试仍提示 `.ts` ESM 的 `MODULE_TYPELESS_PACKAGE_JSON` warning，不影响测试结果。
- 类型检查未执行，当前 worktree 没有 `node_modules/.bin/tsc`。

## Task 1 最终审核阻塞修复

### 根因

此前只有 `revokeAllSessions()` 使用 Promise 队列，`initializeAuth()` 使用独立的布尔锁。初始化原子写入完成后、内存提交前，revoke 仍可能读取旧内存代次并完成另一笔写入，造成内存和磁盘 generation 分叉。另一个偏差是 setup token 在首次消费时才生成，而 brief 要求模块首次加载时生成。

### TDD 证据

#### RED

新增初始化与全量吊销交错、失败隔离及 setup token 加载时机回归测试后运行：

```bash
node --test lib/pi-web-auth.test.mjs
```

结果：25 个测试中 19 个通过、6 个失败。交错测试暴露认证变更未共享队列；失败测试首次运行还发现并发失败 Promise 未等待会污染后续测试路径，修正测试等待逻辑后继续实现。

#### GREEN

实现共享认证变更事务队列、恢复模块加载生成 setup token，并重新运行：

```bash
node --test lib/pi-web-auth.test.mjs
```

结果：25 个测试通过，0 个失败。

### 修复内容

- `initializeAuth()` 和 `revokeAllSessions()` 现在共享同一个 `authMutationQueue`，完整覆盖读取、原子持久化和内存状态提交，队列在失败后仍可继续处理后续请求。
- 初始化和吊销交错成功后，磁盘、当前进程 `getAuthState()`、新 session 以及重启进程新 session 均使用同一 generation；失败路径不提交内存状态。
- setup token 改为模块首次加载时生成；配置已存在时不生成、不接受消费。已有写入失败恢复逻辑仍保留，初始化失败后可用同一 token 重试。
- `revokeAllSessions()` 保持 `Promise<void>`，测试和调用方均显式 `await`，避免异步持久化产生未处理 Promise。

### 最终验证

- `node --test lib/pi-web-auth.test.mjs`：25 pass，0 fail。
- `git diff --check`：通过。

### Concerns

- Node 测试仍提示 `.ts` ESM 的 `MODULE_TYPELESS_PACKAGE_JSON` warning，不影响测试结果。
- 类型检查未执行，当前 worktree 没有 `node_modules/.bin/tsc`。
