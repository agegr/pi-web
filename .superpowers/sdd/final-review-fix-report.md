# Final Review Fix Report

## Status

已修复最终 whole-branch review 中的 Critical/Important findings，并未修改 Agent lifecycle 生产语义或 `lib/rpc-manager.ts`。

## 修改文件

- `lib/pi-web-auth.ts`
- `lib/pi-web-auth.test.mjs`
- `lib/request-security.ts`
- `lib/request-security.test.mjs`
- `app/api/auth/login/route.ts`
- `app/api/auth/login/[provider]/route.ts`
- `app/api/auth/setup/route.ts`
- `app/api/auth/password/route.ts`
- `app/api/auth/providers/route.ts`
- `app/api/auth/all-providers/route.ts`
- `app/api/auth/api-key/[provider]/route.ts`
- `app/api/auth/logout/[provider]/route.ts`

## Findings 处理

### 1. Pi provider OAuth 管理端点匿名公开

- `request-security` 只公开 Pi Web 自身的 status/setup/login API，不再公开 `/api/auth/login/[provider]`。
- provider OAuth `GET`/`POST` 增加有效 `pi_web_session` 校验。
- provider OAuth POST 改用统一 `readAuthJson`，继承精确 media type、body 大小限制和统一 JSON 错误处理。
- `providers`、`all-providers`、API-key 和 provider logout 路由增加服务端 session 防线；API-key POST 和 provider logout 消费统一 JSON body。
- 原有 Origin/Fetch Metadata CSRF 检查继续在公开路径判断前执行。

### 2. setup/password 空密码和弱密码

- 服务端统一执行最小 8、最大 128 个字符的密码长度策略，setup 和 password mutation 都拒绝空值、弱值和超长值。
- setup/password 对密码格式返回统一的 `密码格式无效`，不依赖 HTML `required`。
- 登录、改密错误不再向客户端暴露具体密码失败细节。

### 3. scrypt 配置不可追踪

- 新配置持久化 `algorithm: "scrypt"`、`algorithmVersion: 1` 和完整 `scrypt: { N: 16384, r: 8, p: 1, maxmem: 33554432 }`。
- 读取时校验版本、算法和每个成本参数；成本不允许通过配置降低。
- 保留当前 legacy 配置读取兼容性，并在 password mutation 后迁移为版本化配置。
- 使用显式 callback Promise wrapper，确保 TypeScript 类型检查和运行时参数一致。

### 4. 登录、generation、session 创建与改密并发竞态

- 新增 `authenticateAndCreateSession()`，密码校验、持久化配置读取和 session 创建共享认证 mutation queue。
- `verifyPassword()` 也等待认证 mutation queue，避免旧配置读和 password mutation 交错。
- 增加真实并发回归测试：登录与改密并发时，旧密码不会创建当前有效 session；新密码可以登录。

### 5. 全局限速可被少量请求锁死、缺少渐进延迟和 Retry-After

- 来源阈值保持 5 次/15 分钟；全局阈值独立提高到 100 次/15 分钟，单一攻击来源不会锁死正常来源。
- 来源桶在未拒绝阶段提供最多 500ms 渐进延迟。
- 临时拒绝响应返回 `429` 和 `Retry-After` 秒数。
- 测试覆盖单来源限速、来源轮换全局保护、窗口恢复、正常来源可用性和 route header contract。

### Minor

- setup/password 的服务端错误枚举已收敛为非敏感的统一密码格式错误。
- 保留当前 proxy matcher 的最小范围，不改变 Agent lifecycle；现有静态资源排除和认证路径测试覆盖 matcher 目标行为。

## TDD RED/GREEN

- RED：`node --test lib/request-security.test.mjs lib/pi-web-auth.test.mjs`
  - 新增测试中 2 个失败：provider OAuth 被错误标记为 `public`；setup 弱密码返回 `204` 而非 `400`。
- GREEN：`node --test lib/request-security.test.mjs lib/pi-web-auth.test.mjs`
  - `56 pass, 0 fail`。
- RED：新增显式 scrypt 配置、legacy migration、并发登录改密、来源/全局阈值和 Retry-After 测试后，旧实现分别暴露缺失字段、竞态和错误阈值。
- GREEN：认证核心和 route 修复后，相关测试最终 `56 pass, 0 fail`。

## 完整验证

- `node --test lib/*.test.mjs components/*.test.mjs`
  - 结果：`179 pass, 0 fail, 0 skipped`。
- `node_modules/.bin/tsc --noEmit`
  - 结果：通过。
- `npm run lint`
  - 结果：通过，无 error 或 warning。
- `git diff --check`
  - 结果：通过。
- 未运行 `next build`，符合项目约束。

## Concerns

- Node 全量测试仍输出已有的 `MODULE_TYPELESS_PACKAGE_JSON` warning；不影响测试结果、TypeScript 或 lint。
- legacy 配置仍允许按固定当前 scrypt 成本读取，以保持已有部署可登录；下一次密码 mutation 会写入显式版本化配置。
- 工作区原有 `package-lock.json` 变更未纳入本次提交。
