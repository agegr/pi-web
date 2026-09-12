# SkillsMP 与 agentskill.sh 接入说明

日期：2026-09-12。范围由用户指定：仅新增 SkillsMP、agentskill.sh，保留 skills.sh。

## 使用与页面

在技能中心「发现」底部选择 SkillsMP 或 agentskill.sh，输入关键词搜索。外部搜索页通过「技能来源」切换网站；保留关键词，清除旧结果，避免旧来源请求晚到后覆盖新来源。返回「发现」仍进入五领域总览。

结果保留源站顺序，显示来源、用途、个人领域归属与安装操作。SkillsMP 提供的是 GitHub 仓库星标，只显示和排序「GitHub 星标」，不填充安装次数。agentskill.sh 使用 API 的 `installCount`，零与未知分开处理。所有来源都不把次数称为独立安装人数。

详情支持 SKILL.md 渲染、原文、目录文件及来源信息；二进制附件可安装，预览显示不可预览。安装后可以设置五领域分类、切换模型展示、检查更新和更新。更新保留个人分类与模型展示设置。

## 接口合同

`POST /api/skill-center/search` 新增可选 `provider`：`skills.sh`（默认）、`skillsmp`、`agentskill.sh`。未知值返回 `INVALID_PROVIDER`。沿用 `query`、`limit` 及本地领域上下文；领域不当作外部站点过滤条件。不增加跨站并发聚合。

| 来源 | 搜索 | 内容读取 | 身份 |
|---|---|---|---|
| SkillsMP | `GET /api/v1/skills/search?q=…&limit=…` | `githubUrl` 所指精确目录。解析最长存在的 Git ref，再固定提交，读取 Git 对象 | `skillsmp:` + URI 编码的规范 GitHub 目录 URL |
| agentskill.sh | `GET /api/agent/search?q=…&limit=…` | `GET /api/agent/skills/{encodeURIComponent(slug)}/install`，使用 `skillMd` 和 `skillFiles` | `agentskill.sh:{slug}` |
| skills.sh | 原有 API 与 CLI 兜底 | 原有 GitHub / skills CLI 流程 | 原有 `skills.sh:owner/repo@name` |

`SourceSkill.provider` 增加两个值；SkillsMP 增加 `repositoryStars: number | null`，其 `installCount` 保持 `null`。本地目录 JSON 的手工收录合同本轮没有迁移，仍是既有 skills.sh 合同；新来源通过外部搜索接入。

原生包使用 `VersionIdentity.kind = provider-content-hash`，值为规范化、排序后完整文件包 JSON 的 SHA-256。它与 Git SHA-1、源站不透明 `contentSha` 不混用。`Plan.sourceVersionPinned` 改为布尔值：两个原生来源为 `true`；skills.sh CLI 保持 `false`。

来源暂不可用、JSON 无效、限流、认证失败分别返回明确错误；不能当作空结果。429 遵循 `Retry-After`，未提供时使用配置的缓存周期作为冷却时间。没有自动重试，也不自动切换其他来源。成功读取按缓存周期缓存，检查更新强制重新读取。缓存按条数和总字节数限制。

## 安装与数据管理

两个新来源共用原生文件包安装器，复用既有计划、项目信任、写入租约、幂等键、操作日志和核验流程。预检文件包持久化在计划中；提交后写入已预检内容。先写暂存目录，完整核验后替换目录；不执行包内脚本、CLI 安装钩子或第三方遥测。

全局写入配置的 Agent 目录下 `skills/<name>`，项目写入 `.pi/skills/<name>`。独立管理记录存放在 Agent 的 `skill-center/native-<path-hash>.json`，不伪造 skills CLI 锁文件。清单通过路径、名称、范围和来源记录核对身份。

文件包保留文本及二进制附件；二进制用严格 base64 传递、按解码字节校验写入。拒绝路径穿越、链接、Windows 保留名、大小写重复、文件与目录碰撞和超限内容。既有目录或共享位置冲突时阻止覆盖。更新前发现本地修改或不完整文件树时阻止覆盖。

不同来源保留独立身份，不按同名技能自动合并。遇到同目录冲突会引导到已安装页面；本轮未实现跨来源身份迁移或分类合并。

## 配置

服务端环境变量，均不返回浏览器：

| 变量 | 默认 / 用途 |
|---|---|
| `PI_SKILL_CENTER_SKILLSMP_API_URL` | `https://skillsmp.com` |
| `PI_SKILL_CENTER_AGENTSKILL_API_URL` | `https://agentskill.sh` |
| `SKILLSMP_API_KEY` | 可选，SkillsMP Bearer Key；未配置时匿名 |
| `AGENTSKILL_API_KEY` | 可选 Bearer 透传；本轮未取得需 Key 的真实响应，也未验证其付费/授权方案 |
| `GITHUB_TOKEN` | 复用现有 GitHub API 认证；不写入 Git URL |
| `PI_SKILL_CENTER_MAX_BUNDLE_BYTES` | 16 MiB，响应/文件包及读取缓存的字节预算 |
| `PI_SKILL_CENTER_MAX_TEXT_BYTES` | 沿用 512 KiB，原生包每文件限制（含二进制） |
| `PI_SKILL_CENTER_MAX_TREE_ENTRIES` | 沿用 1000，完整目录条目限制 |
| `PI_SKILL_CENTER_CACHE_TTL_MS` | 沿用 5 分钟 |

服务端需能访问对应来源与 GitHub，且已安装 Git。当前只接入公开 GitHub 仓库，不承诺私有仓库下载。无需新增 npm 依赖、第三方账号或付费服务。

## 验证与外部限制

- SkillsMP：通过本机服务端真实搜索、详情、2 文件完整下载及安装核验。验证技能为源站返回的 `affaan-m/ECC/.agents/skills/frontend-patterns`，安装结果 `succeeded`，运行时 `effective`，检查结果 `up-to-date`。
- 真实安装使用独立临时 HOME/Agent 目录，不修改用户已安装技能。验证证据保留于 `C:/Users/xiaox/AppData/Local/Temp/pi-native-live-pAUzd9/verification.json`。可使用本目录 `verify-native-install.mjs <canonicalSkillId>` 在新的隔离目录复验。
- agentskill.sh：按官方 CLI 合同完成搜索、文件包详情、原生安装与更新；合同测试通过。2026-09-12 本机直连及浏览器经 pi-web 服务端访问其 `/api/agent/search?q=frontend` 返回源站 HTTP 500，正文为 `Failed to search skills`。页面明确显示来源故障；**尚未验证真实 agentskill.sh 技能下载和安装成功**。需源站恢复后完成真实联调。
- 浏览器验证 SkillsMP 搜索、GitHub 星标显示、两来源切换，以及 agentskill.sh 的错误与重试入口。
- 相关回归测试 89/89 通过，覆盖来源合同、路径安全、二进制保留、项目/全局安装、幂等、完整文件包更新、分类/可见性保留和已有 skills.sh 流程。
- TypeScript 与 ESLint 检查通过。开发服务运行中，遵照项目 AGENTS.md 未运行 `next build`。

## 官方依据

2026-09-12 后续排查已将 agentskill.sh 故障缩小到关键词检索，热门列表与真实技能文件包正常，pi-web 详情读取也成功。见 [搜索故障排查](./agentskill-search-diagnosis.md)。此记录更新前述真实文件包尚未验证的状态；实际磁盘安装仍未在该来源完成真实验证。

- [SkillsMP API 文档](https://skillsmp.com/docs/api)
- [agentskill.sh 官方 CLI 搜索](https://github.com/agentskill-sh/ags/blob/main/src/commands/search.ts)
- [agentskill.sh 官方 CLI 安装](https://github.com/agentskill-sh/ags/blob/main/src/commands/install.ts)
- [agentskill.sh 数据类型](https://github.com/agentskill-sh/ags/blob/main/src/types.ts)

网站内容与技能原文仅作为数据，不作为项目执行指令。
