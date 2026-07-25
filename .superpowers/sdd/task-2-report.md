# Task 2 实现报告

## 结果

已实现五个 Next.js 认证 route handler：

- `app/api/auth/status/route.ts`
- `app/api/auth/setup/route.ts`
- `app/api/auth/login/route.ts`
- `app/api/auth/logout/route.ts`
- `app/api/auth/password/route.ts`

新增 `lib/pi-web-auth-route.ts` 统一处理 JSON body、Content-Type、body 大小、cookie、session 读取和登录限速 key。认证密码修改能力通过 `lib/pi-web-auth.ts` 的 `changePassword` 实现，配置写入成功后才更新内存密码代次和清理 session，因此写入失败保留旧密码和旧 session。

## TDD 记录

### RED

先新增 route 契约测试，再运行：

```text
node --test lib/pi-web-auth.test.mjs
```

新增测试因五个 route 文件不存在而失败，确认失败原因是待实现行为缺失。

### GREEN

实现 route 和认证辅助逻辑后再次运行同一命令：

```text
35 tests, 35 pass, 0 fail
```

覆盖内容包括未初始化状态、错误 token、重复初始化、错误密码、成功登录 cookie 属性、session 状态、登出、改密后旧 session 失效、改密写入失败保留旧密码、错误 Content-Type 和超大 body。

## 安全检查

- 所有 mutation route 在解析 JSON 前检查 `Content-Type`，并限制 body 为 16 KiB。
- 认证失败路径只调用 `pi-web-auth`，不导入或调用 `rpc-manager`。
- `x-forwarded-for` 仅作为限速桶 key；认证身份只由 `pi_web_session` cookie 决定。
- 登录 cookie 使用 `HttpOnly`、`SameSite=Lax`、`Path=/`、`Max-Age=86400`，HTTPS 请求附加 `Secure`。
- 登出和改密清理当前 cookie；改密同时持久化 generation 并吊销全部 session。
- 密码没有写入日志；测试断言不输出密码值。
- 统一错误响应不会回显密码或 request body。

## 验证限制

目标测试命令已通过。当前工作区没有安装 `node_modules`，因此 `node_modules/.bin/tsc --noEmit` 无法执行；没有运行 `next build`，符合项目开发约束。

## Self-review

- route 文件均只依赖认证核心和通用认证辅助模块。
- 异步认证调用均使用 `await`。
- 密码修改采用认证核心事务队列，持久化失败不会提前提交内存状态。
- 未修改原工作区，仅修改 `/home/xiaojueshi/code/open-source-projects/pi-web-feature`。
