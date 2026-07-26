# Final Review Fix 2 Report

## Status

已修复最新 reviewer 指出的认证契约、限速来源、密码策略和 OAuth callback 随机数问题。未修改 Agent lifecycle 生产语义。

## 修改

- provider OAuth logout 允许前端实际发送的无 body POST，同时继续执行 session 校验；有 body 时仍要求 `application/json`，并保留 16 KiB body 上限和超大 body 拒绝。
- 默认限速来源固定为 `anonymous`，不解析任意客户端提交的 `X-Forwarded-For` 或 `X-Real-IP`。只有显式设置 `PI_WEB_TRUSTED_PROXY=true` 时才读取代理来源，并在 README 中记录代理必须覆盖、清理请求头且阻断直连的部署前提。
- setup 和 password mutation 共用 8-128 字符长度策略，并拒绝常见弱密码和全字符重复密码；路由文案统一为 `密码格式无效`。
- provider OAuth callback token 使用 Node `crypto.randomBytes`，不再使用 `Math.random()`。

## TDD RED/GREEN

- RED：新增 provider logout 空 body route contract、未配置可信代理时伪造 XFF、显式可信代理解析和弱密码测试；原实现分别返回 415、信任 XFF、缺少导出测试入口或接受弱密码。
- GREEN：最小修改后相关认证与 request-security 测试 `59 pass, 0 fail`。

## 验证

- `node --test lib/*.test.mjs components/*.test.mjs`：`182 pass, 0 fail, 0 skipped`
- `node_modules/.bin/tsc --noEmit`：通过
- `npm run lint`：通过，无 issue
- `git diff --check`：通过
- 未运行 `next build`，符合项目约束。

## Concerns

- 全量 Node 测试仍输出已有的 `MODULE_TYPELESS_PACKAGE_JSON` warning，不影响结果。
- 默认限速桶是固定匿名桶；未提供 Next Request 的可靠 remote address，因此没有猜测或伪造 remote address。
- `package-lock.json` 存在工作区原有的单行未相关变更，未纳入本次提交。
