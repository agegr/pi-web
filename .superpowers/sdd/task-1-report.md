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
