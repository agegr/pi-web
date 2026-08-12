# Pi Web Next.js → TanStack Start 迁移交接报告

> 交接人:pi 执行会话 · 日期:2026-08-12
> 分支:`migration/tanstack-start` · 代码整合候选:`e8d5473`
> 状态:**全部 Phase 完成,已整合并推送 main;未发布 npm**

---

## 1. 任务概述

将 Pi Web(`@agegr/pi-web`)从 Next.js 16 App Router 完整迁移到 **TanStack Start 1.168.42**(TanStack Router + Vite 8 + Nitro 3,node-server 预设)。迁移范围:

- 41 个 API 路由从 `app/api/**/route.ts`(Next 风格)转为框架中立 handler + 41 个 TanStack server-route 适配器
- 安全层(`proxy.ts` 的 host 白名单 + Basic Auth)迁移到 TanStack 全局中间件
- 前端壳(AppShell/CodexSidebar/SettingsPage/PWA)迁移到 TanStack Router
- 打包/发布链从 `.next` 预构建转为 Nitro 外部输出 + npm tarball 发布

**基准**:基线 `0f6a152`(受保护文件比对基准)、计划 `6137ff4`、最新整合主线 `79ee6ac`。

## 2. 最终状态

| 项 | 值 |
|---|---|
| 分支 | `migration/tanstack-start`(worktree `/Users/kale/pi-web-worktrees/migration-tanstack-start`) |
| 代码整合候选 | `e8d5473`(包含本地 main 最新 4 个提交与 TanStack PATCH 适配) |
| 代码候选提交数 | 47(0f6a152..e8d5473,含 main 合并提交) |
| 变更量 | 141 文件,+10088 / −9827 行 |
| 工作树 | 干净,无 `.output`,无未跟踪敏感文件 |
| 工具链 | Node 22.22.1 · npm 10.9.4 · TanStack Start 1.168.42 · Vite 8.2.1 · Mermaid 11.16.1 · Nitro 3.0.260311-beta · Next 16.2.12(已退役) |

## 3. 架构变化

```
旧(Next.js):                         新(TanStack Start):
app/page.tsx(SPA 壳)                src/routes/__root.tsx + index.tsx
app/api/**/route.ts(41 个)          app/api/**/route.ts(框架中立 handler,仅 Response/Request)
                                    + src/routes/api/**/*.ts(41 个薄适配器)
proxy.ts(安全层)                    src/request-security.ts + src/start.ts(全局中间件)
                                    + src/api-methods.ts(405 方法守卫)
instrumentation.ts                  src/server.ts(模块级 configureHttpDispatcher)
app/layout.tsx + manifest.ts        静态 manifest.webmanifest + 本地 Noto Sans Mono
next.config headers                 nitro routeRules
next build + .next 发布             vite/nitro 外部输出 + npm tarball(依赖声明)
```

**关键设计**:
- `app/api` 保留为**框架中立层**(纯 Web API),`src/routes/api` 是传输适配器——迁移成本被压到最低
- 5 个 process-sensitive 包(`undici` + `@earendil-works/pi-*`)externalize,运行时从 node_modules 加载(带完整资源文件)
- 双输出模式:`standalone`(本地验证,整包拷贝 166MB)与 `publication`(发布,依赖由 npm install 提供,tarball 5MB)

## 4. 各 Phase 完成情况

### Phase 1 — API/安全/启动 ✅
- 32 个 handler 机械转换(NextResponse.json → Response.json、nextUrl → URL)
- 41 个适配器 + inventory 契约测试锁定
- 安全矩阵与 `proxy.ts` 原契约一致(403/401 + headers)
- 310s SSE 通过中间件门禁

### Phase 2 — AppShell/root/PWA ✅
- AppShell 迁移到 TanStack Router 导航,`?session=`/`?cwd=` 保留
- 本地字体、version defines、PWA 资源与缓存规则

### Phase 3 — 输出/打包/CLI ✅
- standalone/publication 双输出分离
- `bin/pi-web.js` 启动 Nitro 产物,CLI 行为(端口/警告/开浏览器/信号/退出码)保留
- Next 依赖、配置、脚本、导入全部移除(安装包验证后退役)

### Phase 4 — 功能与跨平台回归 ✅
- **Task 18**:41 路由安全冒烟矩阵(59 探测,standalone/安装包/密码三形态)+ 405 契约恢复
- **Task 19**:隔离安装包功能矩阵(会话/文件/git/trust/worktree/浏览器桌面+移动)
- **Task 20**:AGENTS.md/README×2/release.md 文档更新
- **Task 21**:最终验证全绿(见 §5)
- **Task 22**:交接(本报告)

## 5. 最终验证数据

| 门禁 | 结果 |
|---|---|
| `npm ci`(干净) | exit 0 |
| 测试 | **594/594**,0 fail |
| `npm audit` | 0 vulnerabilities |
| lint | 0 errors / 9 warnings(基线 11,未增加) |
| tsc | clean |
| standalone 构建 | 23,707 文件 / 166.4 MB,5 包版本与仓库一致 |
| 41 路由冒烟 | 59 探测 / 0 失败(无密码 + 密码模式) |
| tarball | `agegr-pi-web-0.8.8-beta.1.tgz`,**5,006,455 字节**,sha512 `43cbbf28…` |
| 安装包冒烟 | root/sessions/manifest/sw/安全矩阵/60 路由全绿,`lucide-react 0.562.0` 可解析 |
| **SSE 310s** | 330,011 ms,12 heartbeats(≥10),connected ✓ |
| **Windows CI** | ✅ [run 31593861847](https://github.com/icekale/pi-web/actions/runs/31593861847)(276243e,13min) |
| 受保护文件 | 4 个核心文件对 `0f6a152` 零 diff |
| 红线 | 无 Next 引用(残留 `.next` 均为忽略目录名/迭代器/反断言)、无 `.output`、无凭据文件 |

## 6. 关键修复与踩坑记录(后续维护必读)

1. **`--configLoader runner`**(Vite 8):项目无 `"type": "module"`,`.ts` 配置按 CJS 打包会因 ESM-only 插件崩溃——所有 vite 命令必须带此参数(已写入 scripts)
2. **`exportConditions` 含 `"import"`**:Nitro 默认条件缺 import,ESM-only 的 pi-* 包在 externals 插件里被静默 bundle——运行时资源路径错乱(`ENOENT .../theme/dark.json`)。**删掉这个配置任何一处都会回归**
3. **`copyExternalPackages` closeBundle 插件**:Nitro trace 只拷 JS import 图,pi 包的主题 JSON 等资源全丢,构建后整包同步
4. **publication 包资源(Task 19 抓出)**:stage 时排除 `.output/server/node_modules`,依赖由 npm install 提供——tarball 8.5MB→5.0MB
5. **smoke 挂死**:CLI 的孙进程孤儿持有管道 → spawn 用 `detached` 进程组 + finally 杀整组 + 销毁管道
6. **Windows CRLF**:测试用硬编码 LF 字符串定位源码块,Windows checkout(CRLF)全挂 → `.gitattributes` 强制 `* text=lf`
7. **405 契约**:TanStack 对未匹配方法 fallback 到页面渲染(200 HTML),Next 是 405——`src/api-methods.ts` 静态表 + 中间件恢复,与 inventory 测试锁定同步
8. **环境陷阱**:shell 全局 `NODE_ENV=production`(npm install 跳过 devDeps)、`PI_WEB_PASSWORD`(干扰测试/服务器继承)——跑测试/起服务必须 `env -u NODE_ENV -u PI_WEB_PASSWORD`
9. **端口 30142** 是用户运行中的 pi-web 实例,勿动;本地 smoke 用 30147

## 7. 遗留事项/风险

发布前隔离凭据验证已完成浏览器主题、语言与设置交互、API key store/remove,以及真实 prompt SSE 完成链路;未保留凭据、会话标识、响应消息内容或敏感临时路径。

| 项 | 原因 | 建议 |
|---|---|---|
| models-config catalog | 上游 502(联网) | 正常网络下验证 |
| **`~/.pi/agent/models.json` 曾被探测误写** | `PUT /api/models-config` 无校验,已从 `models.json.bak-20260808-133923` 恢复 | **确认 Models 面板配置完整;建议后续给该端点加输入校验** |
| 未持久化 session 的 DELETE 返回 500 | handler 既有行为(ENOENT),非迁移回归 | 可后续优化 |
| tarball 5MB 但安装后依赖 ~100MB+ | publication 语义:依赖由 npm 管理 | 符合预期,发布时注意 npm 安装时间 |

## 8. 发布/恢复操作速查

```bash
# 本地完整验证
env -u NODE_ENV -u PI_WEB_PASSWORD npm test
env -u NODE_ENV -u PI_WEB_PASSWORD npm run lint
node_modules/.bin/tsc --noEmit

# 构建 + 验证 + 打包 + 安装冒烟(一条链)
env -u NODE_ENV -u PI_WEB_PASSWORD PI_WEB_TANSTACK_SMOKE_PORT=30147 npm run pack:tanstack

# 手动发布(先审阅输出的 tarball 路径/大小/integrity)
npm version patch --no-git-tag-version
npm publish ./<tarball>.tgz --access public

# 回滚:迁移前完整 Next 版在 git 历史 6137ff4^ 之前;受保护基线 0f6a152
```

## 9. 建议的下一步

1. 发布前复查 §7 的 models-config catalog 上游可用性
2. 后续加固:`PUT /api/models-config` 输入校验(本次事故暴露)
3. 长期:删除仓库中残留的 Next 相关文件引用(测试断言类,已无害)
4. Windows CI 工作流(`tanstack-spike-windows.yml`)建议后续更名为 `migration-gate` 并保留

## 11. 最新 main 整合记录

- 已将 `main@e4ea976` 合并到迁移分支: `1de3e1a merge: integrate post-migration main fixes`。
- 保留 TanStack `navigate(...)` 和标准 Web `Response`,同时纳入主线的 session relation、subagent 分组/隐藏、运行状态动画和同会话点击保护。
- 将 `components/AppShell.workspace-memory.test.mjs` 的旧 Next Router 源码断言更新为 TanStack search 导航断言: `f55acfe`。
- 新鲜验证:测试 592/592;lint 0 errors / 9 warnings;`tsc --noEmit`、`git diff --check` 均 clean。
- `pack:tanstack` exit 0:临时安装成功,root/sessions/manifest/sw/security 全绿,59 路由探针 0 失败;catalog 仍因上游 502 跳过,写入型 models-config 仍按设计不探测。
- 本次整合未创建仓库 `.output`,未使用真实 API key,未发布 npm。
- 随后发现本地 `main@79ee6ac` 比 `origin/main@e4ea976` 多 4 个已提交但未推送的 archived-project/settings 更新;已通过 `e8d5473 merge: integrate latest local main updates` 纳入候选。
- `/api/projects` 新增 `PATCH` 后,同步更新了框架中立 handler、TanStack adapter、405 方法表、inventory 契约与安全冒烟;保留项目注册表锁和局部更新语义。
- `e8d5473` 新鲜验证:测试 594/594;lint 0 errors / 9 warnings;`tsc --noEmit`、`git diff --check` clean;安装包 60 路由探针 0 失败。
- 最新 tarball 5,006,455 字节,sha512 `43cbbf28…d839e04`;未发布 npm。
- 在仓库外临时 detached worktree 从 `main@79ee6ac` 执行 `git merge --ff-only migration/tanstack-start`,结果为纯快进;干净 `npm ci` 后再次通过 594/594、lint、tsc 和 diff 检查。
- `origin/main` 与 `origin/migration/tanstack-start` 已通过普通非强制 push 快进到同一条已验证提交线;远端 SHA 已用 `git ls-remote` 复核。迁移 worktree 保留供后续审计。

## 12. 发布就绪安全更新

- 主线整合后为发布就绪性升级 Vite `8.0.14` → `8.2.1`、Mermaid `11.14.0` → `11.16.1`;`npm audit` 报告 0 vulnerabilities。
- 删除迁移前已失同步的 `bun.lock`:它仍声明 Next.js、undici `8.5.0` 和旧前端依赖,且仓库、CI、README 与发布链均只使用 npm;`package-lock.json` 现在是唯一权威锁文件。
- 升级后全套测试最初为 593/594,唯一失败是仍断言旧 Vite 版本的配置测试;同步期望值并通过聚焦验证后,最终计数为 594/594。
- 浏览器主题、语言与设置交互、API key store/remove 和真实 prompt SSE 已在隔离凭据环境验证;models-config catalog 仍为上游 502,未持久化 session 的 DELETE 仍返回 500。
- Vite `8.2.1` 开发 SSR 复测发现 `@lobehub/icons` 的无扩展名 ESM 内部导入导致客户端渲染回退;将该包设为 `ssr.noExternal` 后,根页面返回 12 个 `codex-sidebar` SSR 标记且不含回退/缺模块文本,配置测试锁定该修复。
- 最终 `pack:tanstack` exit 0:外部输出 23,724 文件/167,251,646 字节;tarball 5,194,550 字节,sha512 `5470eb09…ce173088`;全新安装后 root/sessions/PWA/安全通过,60 路由探针 0 失败,catalog 仍因上游 502 跳过。

## 10. 关键文件索引

| 文件 | 职责 |
|---|---|
| `vite.tanstack.config.ts` | 双输出模式、externalize、copyExternalPackages、routeRules |
| `src/start.ts` | 全局中间件注册(安全/CSRF/405) |
| `src/request-security.ts` | host 白名单 + Basic Auth 拒绝矩阵 |
| `src/api-methods.ts` | 41 路由方法表 + 405 守卫 |
| `src/server.ts` | dispatcher 启动顺序 |
| `scripts/tanstack-route-smoke.mjs` | 共享 41 路由安全冒烟矩阵 |
| `scripts/pack-tanstack.mjs` | 构建→验证→暂存→打包→安装冒烟全链 |
| `scripts/stage-tanstack-package.mjs` | publication 暂存(排除 traced node_modules) |
| `lib/tanstack-route-inventory.test.mjs` | 41 路由/适配器/方法守卫/冒烟覆盖锁定 |
| `docs/spikes/2026-08-12-tanstack-migration-results.md` | 完整证据账本 |
| `.gitattributes` | 强制 LF(Windows CI 关键修复) |
