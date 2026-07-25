# Pi Web Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Pi Web 增加单用户密码认证、首次初始化、会话管理、改密和暴力破解限速，同时保证认证失效不会停止后台 Pi Agent。

**Architecture:** 在现有 `proxy.ts` 中统一拦截页面、API 和 SSE 请求，公开登录/初始化路由，其余请求必须携带服务端内存会话。认证配置保存在 `getAgentDir()` 对应目录的 `pi-web-auth.json`，只保存 `scrypt` 哈希和认证代次；页面通过独立登录/初始化组件进入现有 `AppShell`。认证模块不调用 `rpc-manager` 的 destroy、abort 或 shutdown。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript strict mode、Node.js `crypto.scrypt`、Node.js `fs/promises`、HttpOnly Cookie、现有 npm/npx 启动方式。

## Global Constraints

- 账号模型固定为单用户，不实现多用户、角色、数据库或外部 OAuth。
- 密码只保存 `scrypt` 哈希和随机 salt，不保存明文密码。
- 认证配置文件为 `<agent-dir>/pi-web-auth.json`，其中 `<agent-dir>` 使用现有 Pi Agent 配置目录解析逻辑。
- 首次初始化使用启动时生成的一次性 token；token 只输出到服务端启动日志，成功使用后立即失效。
- 登录会话固定有效期 24 小时，不采用滑动续期；服务重启和改密会使会话失效。
- 页面未认证时重定向到登录/初始化页面；未认证 API 和 SSE 返回 `401`，不返回业务数据。
- 登录失败按来源和全局限速，使用逐步延迟和临时拒绝；限速状态只保存在内存。
- 认证失效、改密或浏览器断开不能停止已经运行的 Pi Agent。
- 不把密码、初始化 token、session token、cookie 或完整请求体写入日志。
- 不新增生产依赖，不把认证秘密放入 `NEXT_PUBLIC_*` 环境变量。
- 所有导出的 TypeScript 函数、类型和接口必须包含简体中文 JSDoc。
- 遵守项目约束：开发阶段不运行 `next build`；使用 `node_modules/.bin/tsc --noEmit` 和 `npm run lint` 验证。

---

## 文件结构

- Create: `lib/pi-web-auth.ts`，密码哈希、配置模型、初始化 token、内存 session 和限速状态。
- Create: `lib/pi-web-auth.test.mjs`，认证核心逻辑的单元测试。
- Create: `app/api/auth/status/route.ts`，返回未初始化/已初始化/已认证状态，不暴露敏感信息。
- Create: `app/api/auth/setup/route.ts`，一次性 token 初始化接口。
- Create: `app/api/auth/login/route.ts`，密码登录接口。
- Create: `app/api/auth/logout/route.ts`，当前会话登出接口。
- Create: `app/api/auth/password/route.ts`，已登录用户修改密码接口。
- Create: `app/login/page.tsx`，登录页。
- Create: `app/setup/page.tsx`，首次初始化页。
- Create: `components/AuthGate.tsx`，客户端认证状态加载和页面分流。
- Create: `components/AuthForms.tsx`，登录和初始化表单。
- Modify: `proxy.ts`，统一保护页面、API、SSE，并保留已有 Origin 校验。
- Modify: `app/page.tsx`，在认证通过后渲染现有 `AppShell`，保持原有 Suspense 结构。
- Modify: `app/globals.css`，增加登录/初始化页面的响应式视觉样式。
- Modify: `README.md`、`README.zh-CN.md`，补充 npm/npx 初次初始化、配置目录和 Docker volume 说明。

## Task 1: 认证核心模块和失败测试

**Files:**
- Create: `lib/pi-web-auth.test.mjs`
- Create: `lib/pi-web-auth.ts`

**Interfaces:**
- Produces `getAuthConfigPath(): string`、`getAuthState(): Promise<AuthState>`、`initializeAuth(token: string, password: string): Promise<void>`、`verifyPassword(password: string): Promise<boolean>`。
- Produces `createSession(): string`、`getSession(token: string): SessionValidation`、`revokeAllSessions(): void`、`revokeSession(token: string): void`。
- Produces `consumeSetupToken(token: string): boolean` 和 `checkLoginRateLimit(key: string): RateLimitDecision`。
- `AuthState` 只包含 `initialized: boolean`、`generation: number`、`updatedAt?: string`，不得包含明文密码、salt 或哈希给调用方。

- [ ] **Step 1: 编写失败测试**

测试通过 `PI_WEB_AUTH_CONFIG_PATH` 和 `resetAuthStateForTests()` 注入临时配置路径，并覆盖：

```js
test("密码哈希可以校验且错误密码失败", async () => {
  await initializeAuth("setup-token", "correct-password");
  assert.equal(await verifyPassword("correct-password"), true);
  assert.equal(await verifyPassword("wrong-password"), false);
});

test("初始化 token 只能消费一次", async () => {
  assert.equal(consumeSetupToken("setup-token"), true);
  assert.equal(consumeSetupToken("setup-token"), false);
});

test("改密代次会使已有 session 失效", async () => {
  const token = createSession();
  assert.equal(getSession(token).valid, true);
  revokeAllSessions();
  assert.equal(getSession(token).valid, false);
});

test("限速在失败后延迟并在阈值后拒绝", () => {
  assert.equal(checkLoginRateLimit("source").allowed, true);
  for (let i = 0; i < 5; i += 1) recordLoginFailure("source");
  assert.equal(checkLoginRateLimit("source").allowed, false);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test lib/pi-web-auth.test.mjs`

Expected: FAIL，因为认证核心模块尚未实现。

- [ ] **Step 3: 实现最小认证核心**

使用 Node.js 内置 `scrypt`、`randomBytes` 和 `timingSafeEqual`。配置写入流程必须是：创建父目录、写入同目录临时文件、设置 `0600`、`rename` 原子替换。读取失败或 JSON 损坏必须抛出错误，调用方不得把错误转换为“无认证”。

内存 session 结构保存 `sha256(sessionToken)`、创建时间、过期时间和 generation；只向 cookie 返回原始随机 token。固定 session TTL 为 `24 * 60 * 60 * 1000`。服务重启自然清空内存 session。

初始化 token 在模块首次加载时生成；成功消费后从内存删除。若配置已存在，不再生成或接受初始化 token。

- [ ] **Step 4: 运行通过测试**

Run: `node --test lib/pi-web-auth.test.mjs`

Expected: PASS，所有密码、配置、token、session 和限速测试通过。

- [ ] **Step 5: 提交**

```bash
git add lib/pi-web-auth.ts lib/pi-web-auth.test.mjs
git commit -m "feat: add pi web auth core"
```

## Task 2: 认证 API 和 cookie 行为

**Files:**
- Create: `app/api/auth/status/route.ts`
- Create: `app/api/auth/setup/route.ts`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `app/api/auth/password/route.ts`

**Interfaces:**
- `GET /api/auth/status` 返回 `{ initialized: boolean, authenticated: boolean }`。
- `POST /api/auth/setup` 接收 `{ token, password, confirmPassword }`，成功返回 `204` 或 `{ success: true }`。
- `POST /api/auth/login` 接收 `{ password }`，成功设置 `pi_web_session` cookie；失败返回 `401`，限速返回 `429`。
- `POST /api/auth/logout` 清理当前 cookie并返回成功。
- `POST /api/auth/password` 接收 `{ currentPassword, newPassword, confirmPassword }`，成功改密并吊销全部 session。

- [ ] **Step 1: 编写 API 契约测试**

覆盖未初始化状态、错误 token、重复初始化、错误密码、成功登录 cookie 属性、过期 session、登出、改密后旧 session 失效和写入失败保留旧密码。使用 route handler 直接传入 `Request` 并检查 `Response`，请求体只使用小型 JSON；密码不出现在断言日志中。

- [ ] **Step 2: 运行失败测试**

Run: `node --test lib/pi-web-auth.test.mjs`

Expected: 新增 API 行为测试 FAIL。

- [ ] **Step 3: 实现 route handlers**

所有 handler 先限制 `Content-Type` 和 JSON body 大小，统一处理格式错误。使用 `request.headers.get("x-forwarded-for")` 只作为可选限速 key；默认使用 `request.headers.get("x-real-ip")` 或固定匿名 key，不把代理头当作认证身份。

Cookie 设置为 `HttpOnly`、`SameSite=Lax`、`Path=/`、`Max-Age=86400`，根据当前请求协议设置 `Secure`。改密成功后清理当前 cookie，并通过 generation/revokeAllSessions 使全部 session 失效。任何认证失败不得调用 `rpc-manager`。

- [ ] **Step 4: 运行 API 测试**

Run: `node --test lib/pi-web-auth.test.mjs`

Expected: PASS，API 契约和 cookie 属性测试通过。

- [ ] **Step 5: 提交**

```bash
git add app/api/auth lib/pi-web-auth.ts lib/pi-web-auth.test.mjs
git commit -m "feat: add pi web auth routes"
```

## Task 3: 统一请求保护和页面认证分流

**Files:**
- Modify: `proxy.ts`
- Modify: `app/page.tsx`
- Create: `components/AuthGate.tsx`

**Interfaces:**
- `proxy(request: NextRequest): NextResponse` 保留已有跨站 Origin 拒绝逻辑。
- `AuthGate` 根据 `/api/auth/status` 将状态分流到 setup、login 或受保护 children。

- [ ] **Step 1: 增加 proxy 分流测试**

覆盖公开 `/login`、`/setup`、`/api/auth/*`、静态资源；覆盖未认证页面重定向、未认证 API/SSE 的 `401`、有效 cookie 放行，以及跨站 API 仍为 `403`。

- [ ] **Step 2: 运行失败测试**

Run: `node --test lib/request-security.test.mjs lib/pi-web-auth.test.mjs`

Expected: 新增认证分流测试 FAIL。

- [ ] **Step 3: 实现 proxy 和页面 gate**

`proxy.ts` 先处理公开路径，再调用 session 校验；页面请求重定向到 `/login` 或 `/setup`，API 和 SSE 返回 JSON `401`。matcher 覆盖页面和 API，但排除 `/_next/static`、`/_next/image`、favicon 和公开认证页面。已有 Origin 检查只应用于 API 请求。

`app/page.tsx` 保留服务端 `Suspense`，把现有 `AppShell` 包在 `AuthGate` 中。`AuthGate` 请求 status，加载期间显示最小 loading 状态，认证成功后才挂载 `AppShell`，避免未认证时触发会话读取或 Agent API 请求。

- [ ] **Step 4: 运行测试和类型检查**

Run: `node --test lib/request-security.test.mjs lib/pi-web-auth.test.mjs && node_modules/.bin/tsc --noEmit`

Expected: PASS，TypeScript 无错误。

- [ ] **Step 5: 提交**

```bash
git add proxy.ts app/page.tsx components/AuthGate.tsx lib/request-security.test.mjs
git commit -m "feat: protect pi web requests"
```

## Task 4: 登录、初始化和改密 UI

**Files:**
- Create: `app/login/page.tsx`
- Create: `app/setup/page.tsx`
- Create: `components/AuthForms.tsx`
- Modify: `app/globals.css`
- Modify: `components/AppShell.tsx`

**Interfaces:**
- `AuthForms` 接收 `mode: "login" | "setup"` 和 `onSuccess(): void`。
- `AppShell` 增加设置入口和改密表单；改密成功后清理客户端状态并导航到 `/login`。

- [ ] **Step 1: 编写 UI 验收测试或静态行为测试**

覆盖登录空密码阻止提交、初始化要求 token/密码确认、服务端错误显示通用文本、成功后导航、改密成功后重新登录。若项目没有浏览器测试 harness，使用 React 组件源码约束测试加手工 Playwright/浏览器验收清单，不能用测试替代服务端校验。

- [ ] **Step 2: 实现最小表单**

登录页面只提交密码；初始化页面提交 token、密码和确认密码；所有错误显示非敏感信息。页面不读取 cookie、不显示初始化 token、不把密码写入 localStorage。表单支持移动端、键盘提交和加载中禁用。

在 `AppShell` 的现有用户菜单或设置区域加入“修改访问密码”和“退出登录”。改密请求成功后调用 `/api/auth/logout`，再跳转 `/login`。

- [ ] **Step 3: 添加主题和响应式样式**

复用 `--bg`、`--bg-panel`、`--border`、`--text`、`--text-muted`、`--accent` 等现有变量，保证浅色/深色主题、窄屏宽度和焦点状态可用，不引入新的 UI 框架。

- [ ] **Step 4: 运行类型检查和 lint**

Run: `node_modules/.bin/tsc --noEmit && npm run lint`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add app/login app/setup components/AuthForms.tsx components/AuthGate.tsx components/AppShell.tsx app/globals.css
git commit -m "feat: add authentication screens"
```

## Task 5: 文档、完整测试和 Agent 生命周期验证

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Create or modify: `lib/rpc-manager.test.mjs`
- Modify: `docs/superpowers/specs/2026-07-25-pi-web-auth-design.md` only if implementation clarifies an existing statement

- [ ] **Step 1: 增加 Agent 不受认证影响的回归测试**

测试模拟已运行 `AgentSessionWrapper`，认证 session 过期、改密和 API `401` 流程只改变 Web auth 状态，不调用 wrapper 的 `destroy`、`abort`、`shutdown` 或 `send`。保留现有 Agent session running 状态断言。

- [ ] **Step 2: 更新用户文档**

中文文档说明：首次运行从终端读取一次性 token、初始化密码、配置文件位置、忘记 token 的本地恢复方式、24 小时 session、改密后需要重新登录、认证失效不会停止后台 Agent。英文 README 提供对应简短说明。明确当前仓库没有内置 Dockerfile；容器部署时需要挂载 Pi Agent 配置目录。

- [ ] **Step 3: 运行完整验证**

Run: `node --test lib/*.test.mjs components/*.test.mjs && node_modules/.bin/tsc --noEmit && npm run lint`

Expected: 全部测试通过、TypeScript 无错误、ESLint 无错误。

- [ ] **Step 4: 检查敏感信息和 diff**

Run: `git diff --check && git status --short --branch && git diff --stat`

确认源码、测试、文档和日志中没有硬编码密码、初始化 token、session token 或 cookie 值；确认未修改 `rpc-manager` 的 Agent 销毁语义。

- [ ] **Step 5: 提交**

```bash
git add README.md README.zh-CN.md lib/rpc-manager.test.mjs docs/superpowers/specs/2026-07-25-pi-web-auth-design.md
git commit -m "docs: document pi web authentication"
```

## 自审结果

- 规格覆盖：配置持久化、初始化 token、scrypt 密码、会话 cookie、24 小时过期、限速、统一请求保护、改密吊销、Agent 独立生命周期、npm/Docker 说明和测试均有对应任务。
- 占位符检查：计划不含 `TBD`、`TODO` 或未定义的“稍后实现”步骤；每个任务给出文件、接口、测试命令和提交边界。
- 类型一致性：核心导出接口在 Task 1 定义，Task 2 使用配置/密码/session API，Task 3 使用 session 校验和状态 API，Task 4 只依赖 HTTP 接口，Task 5 验证 Agent 不受影响。
- 风险说明：Next.js `proxy.ts` 的 matcher 和运行时行为必须在实现阶段用当前 Next.js 版本的类型检查和请求测试验证；不允许为了绕过运行时问题而退回到“只保护登录页”或“认证失败时默认放行”。
