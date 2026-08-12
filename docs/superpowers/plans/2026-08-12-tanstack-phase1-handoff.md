# TanStack Start Migration — Spike 交接计划

> 交接对象:Phase 1 设计/执行者(Codex 或新 pi 会话)
> 交接人:pi(2026-08-12 spike 执行会话)
> 状态:**SPIKE PASS,Phase 1 未启动**

## 1. 结论与证据

- **结论**: `PASS - authorize separate Phase 1 design`
- 证据文档: `docs/spikes/2026-08-12-tanstack-start-spike-results.md`(分支内,含全部数值)
- 分支: `migration/tanstack-start`(worktree `/Users/kale/pi-web-worktrees/migration-tanstack-start`)
- 基线: `6a76151`(spike 起点);spike 提交 `f4aa48f..0cd98cc` 共 11 个,已 push
- Windows CI: https://github.com/icekale/pi-web/actions/runs/31569406484(全绿,2m27s)

**已验证的能力**(真实运行时,非 mock):
- JSON API(sessions)、SSE 310 秒长连接(11 heartbeats)、multipart 上传,全部通过 Nitro node-server 产物
- 5 个 process-sensitive 包从输出 node_modules 运行时加载,版本与仓库一致
- macOS + Windows 双平台构建/启动/探测

## 2. 架构形态(已验证)

```
src/
  router.tsx               # createRouter({ routeTree })
  server.ts                # 模块级 configureHttpDispatcher() → createServerEntry
  routes/
    __root.tsx             # 文档壳(HeadContent/Scripts)
    index.tsx              # 健康页
    api/sessions.ts        # server.handlers → 委托 app/api 现有 handler
    api/agent/$id/events.ts
    api/files/$.ts         # splat 适配器
vite.tanstack.config.ts    # 双框架并行配置(见 §4 关键配置)
scripts/start|verify|smoke-tanstack-output.mjs
```

**适配器模式**(Phase 1 照抄):
```ts
// src/routes/api/<path>.ts
export const Route = createFileRoute("/api/<path>")({
  server: { handlers: { GET: ({ request }) => getSessions(request) } },
});
```
- 动态参数: `params: Promise.resolve({ id: params.id })`
- splat: `params: Promise.resolve({ path: (params._splat ?? "").split("/") })`
- **Next handler 保持标准 Web API**(已把 3 个样板路由的 `NextResponse.json`/`nextUrl` 转成 `Response.json`/`new URL(request.url)`;Next 侧同时兼容)

## 3. 执行环境注意事项(本机 macOS)

1. **shell 全局 `NODE_ENV=production` + `PI_WEB_PASSWORD` 已设置**:
   - `npm install` 会跳过 devDependencies(react-markdown 等丢失)→ 必须 `env -u NODE_ENV npm install`
   - `npm test` 会因 PI_WEB_PASSWORD 失败 web-auth 测试 → 必须 `env -u NODE_ENV -u PI_WEB_PASSWORD npm test`
2. **端口 30142 被用户运行中的 pi-web 实例占用**(`/Users/kale/pi-web-dev`,launchd 守护,**勿动**):本机 smoke 用 `PI_WEB_TANSTACK_SMOKE_PORT=30147`;30143/30144 已清空可复用
3. 测试统一用 `node --test lib/xxx.test.mjs` 方式;全量 554 tests,约 7-12s
4. macOS 无 `timeout` 命令(用 `curl --max-time`);`mktemp` 模板要求 `XXXXXX` 在末尾;PATH 精简(`lsof`/`netstat` 在 `/usr/sbin/`)

## 4. 关键配置与坑(Phase 1 必须保留)

`vite.tanstack.config.ts` 三处非平凡配置,**删掉任何一处都会回归**:

1. **`--configLoader runner`**(scripts 里): 项目无 `"type": "module"`,Vite 8 按 CJS 打包 `.ts` 配置会因 ESM-only 的 `@tanstack/react-start/plugin/vite` 崩溃
2. **`exportConditions: ["node","import","production","default"]`**: Nitro 默认条件缺 `"import"`,externals 插件的 guessSubpath 对 ESM-only 包(pi-*)静默丢弃 → 包被 bundle 进 server chunk → 运行时资源路径错乱。症状: `ENOENT .../server/dist/modes/interactive/theme/dark.json`
3. **`copyExternalPackages` closeBundle 插件**: Nitro trace(nodeFileTrace `exportsOnly`)只拷 JS import 图,pi 包的主题 JSON/assets 全丢。构建后整包同步到 `<output>/server/node_modules/`

**其他已验证事实**:
- undici 已从 8.5.0 升到 8.9.0(与 pi-coding-agent 嵌套版本对齐,verify 门禁要求);连带 ProxyAgent 对 http:// 不再 CONNECT 隧道(absolute-form),`lib/http-dispatcher.test.mjs` 断言已适配——**不要回退 undici,否则 verify 与测试双失败**
- `src/routeTree.gen.ts` 构建时自动生成,提交但勿手改
- 构建强制要求 `PI_WEB_TANSTACK_OUTPUT_DIR` 为仓库外的绝对路径(防污染工作树,`.output` 永不出现)

## 5. Phase 1 工作范围(待设计评审后启动)

**目标**: 全部 40 个 API 路由 + 前端壳迁移到 TanStack Start,Next 退役,恢复 npm 发布形态

1. **API 层(约 37 个剩余路由)**: 按 §2 适配器模式机械转换。已转换样板:sessions、agent/[id]/events、files/[...path]
2. **`proxy.ts` 安全层**(host 白名单 + Basic Auth): 迁移到 TanStack Start middleware(`createMiddleware().server(...)`),复用 `lib/request-security.ts`/`lib/web-auth.ts`(protected,零改动)
3. **`instrumentation.ts`**: 逻辑已在 `src/server.ts` 模块级(§2),确认即可
4. **AppShell + 前端**: `next/navigation` 的 `useRouter`/`useSearchParams` → TanStack Router 等价物;`?session=` deep link 行为保留;layout/font/manifest 静态化(Noto Sans Mono 换本地字体,`--font-noto-mono` 变量名保留)
5. **PWA**: `public/sw.js`/`offline.html` 原样;`app/manifest.ts` → 静态 `manifest.webmanifest`;Cache-Control headers → Nitro routeRules
6. **发布形态**: `bin/pi-web.js` 改 spawn Nitro 产物 + "Ready" 检测适配;`package.json#files` 换 `.output`;**输出体积 23268 文件/205MB,Phase 3 需压缩方案**(裁剪 map、只拷 dist、或重新评估整包策略)
7. **测试**: 新增适配器契约测试沿用 `lib/tanstack-*.test.mjs` 模式;既有 554 tests 保持全绿

## 6. Phase 1 设计评审要点(启动前定夺)

- [ ] 205MB 输出的压缩策略(Phase 3 npm 发布)
- [ ] SSE 长连接在 middleware 层的行为确认(现有 310s 门禁为无 middleware 状态)
- [ ] Windows CI 扩展为完整 API 冒烟(当前只测 root+sessions)
- [ ] `next/font` 的字体文件落地方式(自托管 woff2 vs @fontsource)
- [ ] 迁移期间双框架并存的时间窗(建议:全部路由转换 + 前端切换后一次性切走,不要长期双跑)
- [ ] 是否需要保留 `next` 依赖直到发布验证完成(建议:Phase 1 结束、npm 包验收后再移除)

## 7. 快速验证命令

```bash
# 构建(外部目录)
PI_WEB_TANSTACK_OUTPUT_DIR=$(mktemp -d /tmp/pi-web-tanstack.XXXXXX) npm run build:tanstack
# 验证 externalization
node scripts/verify-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
# 冒烟(root + sessions)
PI_WEB_TANSTACK_SMOKE_PORT=30147 node scripts/smoke-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
# 全量回归(注意 env)
env -u NODE_ENV -u PI_WEB_PASSWORD npm test
```
