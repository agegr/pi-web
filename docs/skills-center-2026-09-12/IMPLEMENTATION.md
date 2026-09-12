# 技能中心实施与验收记录

日期：2026-09-12。对应 PRD 1.1、F01–F22、71 条验收用例。此文档记录实际实现与证据，不把设计稿或测试夹具当成生产数据。

## 当前交付

原技能入口已接入全屏技能中心。发现首页为计算机、金融、哲学、心理学、玄学五领域；已安装和更新共用用户主动选择的管理领域筛选，默认全部领域。分类不改变安装位置、信任或模型展示设置。

实现文件：

- `components/skill-center/`：总览、领域目录、外部搜索、详情、管理列表、更新检查、安装与操作抽屉。
- `app/skill-center.css`：复用 Clear Horizon 颜色、圆角和主题变量，桌面/手机布局、焦点与减少动效支持。
- `lib/skill-center/`：分类校验、SDK 被动资源发现、实例聚合、远程快照、计划、操作账本、文件门闩、结果核验。
- `app/api/skill-center/[...path]/route.ts`：新聚合接口。旧 `/api/skills/*` 保留请求/响应结构，写接口接入同一门闩。
- `lib/npx.ts`：受控进程树超时；普通 runNpx 路径保留兼容。

## 实现中的关键决定

1. **空目录如实显示。** 生产 `lib/skill-center/catalog.json` 提供五领域及 21 个二级分类，技能与归属集合为空。未经来源证据核查的条目不会被填入金融、哲学等领域。外部搜索可独立使用。
2. **来源与安装身份分开。** canonicalSkillId 包含仓库和技能名；installationId 来自真实路径。共享文件保留别名和所有管理绑定，多绑定更新被阻断。
3. **被动读取。** 通过 SDK 的包解析与技能解析能力读取授权资源，跳过缺失包，不导入扩展或隐式安装依赖。无 cwd 只读取全局；未信任项目不读取项目技能正文。
4. **写入前后核实。** 计划验证上下文、文件修订、管理绑定、CLI 的 Pi/共享/锁目标。执行前重新核实；执行后校验文件、身份、锁与实际版本。CLI 输出“成功”不等于 succeeded。
5. **可见性独立。** CAS 修订校验后以临时文件、fsync、原子替换方式仅调整 frontmatter 字段。更新后只恢复此字段，不恢复旧正文。基线不会吸收核验期间的外部编辑。
6. **故障恢复不重放。** 预检预留 operationId；提交响应丢失后 GET 查询。账本先落盘再启动 CLI。跨进程文件门闩覆盖新旧技能写接口；只读核验也与写入互斥。
7. **源内容只读。** GitHub 内容固定到提交及 blob，歧义拒绝定位。Markdown 禁用原始 HTML、危险链接和远程图片自动加载。越界、编码穿越、过大和二进制文件有独立响应。

## 配置与目录维护

统一配置入口为 `lib/skill-center/config.ts`。以下为默认值，部署时通过同名前缀环境变量覆盖；值须为正整数。

| PI_SKILL_CENTER_ 后缀 | 默认 | 用途 |
|---|---:|---|
| MAX_LIMIT / DEFAULT_LIMIT | 50 / 50 | 每次结果上限/默认条数 |
| MAX_QUERY_LENGTH | 200 | Unicode 码点上限 |
| SEARCH_TIMEOUT_MS | 20000 | 搜索共享截止时间 |
| CLI_TIMEOUT_MS | 60000 | 写命令执行预算；终止尝试另用一次同等预算 |
| MAX_TEXT_BYTES | 524288 | 文件文本预览上限 |
| MAX_TREE_ENTRIES | 1000 | 文件树条数上限 |
| CACHE_TTL_MS / PLAN_TTL_MS | 300000 / 300000 | 快照与计划有效期 |
| POLL_AFTER_MS | 1500 | 前台操作轮询间隔 |
| RETENTION_DAYS | 30 | 最低记录保留期；当前保留历史，不自动清理 |
| MAX_OUTPUT_BYTES | 65536 | 脱敏日志截取上限 |

`PI_SKILL_CENTER_INDEX_PATH` 可指定整体 JSON 索引。按 `catalog.json` 结构维护 taxonomy、skills、assignments；每条归属必须包含匹配的 sourceUrl、relativePath 或 excerpt、verifiedAt。更改内容必须更新 indexRevision。建议先写同目录临时文件，完成 JSON/归属校验后原子替换。服务保留上一份完整有效版本；初次读取失败明确报错。生产目录严禁复制 `implemented/qa-fixtures.json`。

来源设置沿用 `SKILLS_API_URL`，GitHub 请求可使用现有服务端 `GITHUB_TOKEN`（不返回浏览器）。目标路径使用 CLI 的实际 Pi 适配规则，不能将自定义 Agent 状态目录误认为 CLI 全局安装位置。对无法写回选定实例的自定义位置，返回明确不支持。

## 验证证据

2026-09-12 分类编辑与 Tailwind 控件补充：已安装列表和详情增加五领域/多方向分类编辑，持久化个人覆盖，支持清空及恢复默认；统一技能中心原生样式控件。该次 64 项针对性测试、TypeScript、ESLint 和 diff 检查通过，已验收桌面与 390px 布局。详细范围、截图及验证边界见 [分类编辑实施记录](classification-editing.md)。以下保留此前各次验证记录。

- [针对性自动测试原始输出](implemented/targeted-tests.txt)：涵盖分类、路径、锁、实例、快照、幂等、核验竞态、进程终止及旧功能回归。最终数量以文件末尾为准。
- [全量自动测试原始输出](implemented/test-results.txt)：最近完整运行 887 项，874 通过、9 失败、4 跳过。随后新增测试及最终修改另由针对性检查覆盖。
- 最终针对性测试：100 项通过，0 失败；含精确实例定位与 Markdown 元数据回归。
- TypeScript：`npx tsc --noEmit --pretty false`。
- ESLint：`npm run lint`。
- 按仓库 AGENTS 未运行 `next build`，避免污染正在提供预览的 `.next`。
- [71 条验收覆盖表](acceptance.md)：逐条记录证据层级；“代码审阅/测试覆盖”不能代替未执行的浏览器或真实 CLI 场景。
- [视觉对比记录](design-qa.md)、[13 页对比入口](implemented/comparison.html) 与 `implemented/` 截图。

全量测试的 9 项失败与此前仓库 QA 中记录的类别一致，本次未改动其实现：3 项 `hooks/useAgentSession.test.mjs` 的旧源码结构断言；2 项 Windows 文件符号链接 EPERM（directory-browser、subagent-input）；3 项缺少 Bash 的 project-command-env 用例；1 项同文件中的 Windows PATH 分隔符断言。没有通过删除断言、跳过失败或调整产品代码掩盖这些失败。

## 真实运行与验证边界

**2026-09-12 安装修复补充：** 下段 GitHub 403 是首次交付时的历史限制，现已通过只读 Git 回退修复。同一公开来源已在隔离 HOME 完成全局与项目两条真实安装闭环，均 `succeeded` 且 `up-to-date`；本次 61 项针对性测试、TypeScript 和全仓 ESLint 通过。详情见 [安装与安装量修复记录](install-fix.md)。

本地应用运行于开发脚本配置的 30141 端口。实际 skills.sh 查询 `frontend-design` 返回 45 个去重结果；安装量来自当次源站响应，未写入生产目录。实际 GitHub 详情请求返回 HTTP 403，已检查错误、重试和来源链接。因此本机未通过公开 GitHub 来源完成真实安装闭环；服务写入验证使用临时目录和明确的 fake CLI runner。

视觉 QA 代理使用实际应用 bundle 和独立内存数据，页面持续标记“视觉验收测试数据”。代理拒绝向真实服务转发技能接口和写请求，不执行 CLI。它验证页面与交互，不证明真实安装成功。

Windows 未采用 Job Object 监督进程。若 taskkill 不能证明整个进程树已停止，操作保持 needs-review 并保留门闩；界面不会依据单个 PID 消失自动解锁。这种情况需要主机进程核查。进程树无法确认的保护状态、真实 GitHub 403、未完成的端到端/读屏检查与全量既有失败均不能记作“71 条全部验收通过”。

## 测试残留与审批记录

先前进程测试方法留下三个 Node 可执行文件副本，各 93,381,448 字节；最终测试已不再复制 exe：

- `C:/Users/xiaox/AppData/Local/Temp/pi-managed-hung-taskkill-nARGCM/taskkill.exe`
- `C:/Users/xiaox/AppData/Local/Temp/pi-managed-hung-taskkill-qRbz2M/taskkill.exe`
- `C:/Users/xiaox/AppData/Local/Temp/pi-managed-hung-taskkill-r0Cj4A/taskkill.exe`

自动审批审查拒绝删除最后一个临时文件，返回理由“blocked by policy”。未重试或绕过该拒绝。此残留与项目技能目录无关。
