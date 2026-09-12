# 技能中心多来源接入计划（已确认范围）

日期：2026-09-12。用户确认本轮仅新增 **SkillsMP、agentskill.sh**，保留现有 skills.sh。原建议中的 ClawHub、腾讯 SkillHub 不在实施范围。

实施结果与验证边界见 [两来源接入说明](./multi-source-implementation.md)。以下保留最初的候选调研与建议供追溯，不作为本轮交付范围。

## 1. 目标与建议范围

在现有技能中心内增加可搜索、查看详情、安装和更新的技能来源，保留五领域总览、已安装分类与目前的界面风格。

建议新增的核心来源为 **SkillsMP、ClawHub、腾讯 SkillHub**，与现有 skills.sh 并列。先完成来源抽象和 SkillsMP，再完成两个原生包注册中心；SkillHub.club、agentskill.sh、Awesome MCP Servers 的技能库作为后续候选。

“网站能下载”不等于“可以直接套用当前安装命令”。索引网站通常指向 GitHub；注册中心还可能提供独立版本、ZIP 文件和运行环境要求。接入完成必须包括安装后的 Pi 清单识别及更新，不能只添加外链或显示安装成功文案。

## 2. 调研方法与证据边界

本轮按要求使用本机受控 anysearch Node CLI，搜索并提取官方文档和官方仓库；通过 anysearch 的 extract 请求了三个公开搜索 API，均得到真实 JSON。这里证明的是服务通过 anysearch 请求链路可访问，不代表已验证当前主机直连、下载包、Pi 安装、长期配额或服务稳定性。

未登录第三方、申请密钥、执行第三方安装命令、下载技能归档或改动产品代码。以下接口与配额以本次文档为准，实施前需重新进行合同检查。页面和技能内容只作为资料，不作为可执行指令。

## 3. 候选来源比较

| 网站 | 已核实的能力 | 下载/安装方式 | 接入结论 |
|---|---|---|---|
| [SkillsMP](https://skillsmp.com) | 官方 REST 关键词搜索、分页与筛选；本轮匿名搜索返回 `githubUrl`、`skillUrl`、`stars`、分页信息 | 从精确 GitHub 技能目录读取，再进入 Pi 安装流程 | 第一批。最接近现有 GitHub 获取链路；不是独立技能包仓库 |
| [ClawHub](https://clawhub.ai) | 公开搜索、列表、技能详情、版本、文件、CLI 安装；官方允许第三方目录使用公开读接口 | 原生注册中心技能包，需按注册中心身份和版本安装 | 第二批核心来源。只接收 Skill，不将 OpenClaw 插件或完整 Agent 包作为 Pi Skill |
| [腾讯 SkillHub](https://skillhub.cn) | 官方 Open API 覆盖搜索、详情、文件、版本、ZIP 下载；本轮公开搜索返回有效数据 | 指定版本下载，302 跳转对象存储，可依文件列表 SHA-256 校验 | 第二批核心来源。具备中文检索价值；包含同步内容和本土上传内容，不能仅当作 ClawHub 镜像 |
| [SkillHub.club](https://www.skillhub.club) | 文档确认 Skills 搜索和目录 API，MCP 包含详情与安装命令生成能力；Skills API 要求 Bearer Key | 精确仓库/包定位和返回字段仍需鉴权验证 | 可选第三批。没有 Key 时显示未配置，不假装已经接入；不接其模型中转 API |
| [agentskill.sh](https://agentskill.sh) | 官方开源 ags CLI、查找/安装、内容 SHA 版本跟踪、多工具支持 | 通过其公开合同或 CLI 解析技能来源 | 候选。尚未核实独立搜索/下载 API 与 Pi 目标路径，不纳入第一轮完成承诺 |
| [Awesome MCP Servers — Agent Skills](https://mcpservers.org/agent-skills) | 已查看技能目录及真实详情，提供 GitHub 技能目录和 Download ZIP 链接 | 示例 ZIP 链接实际指向 DownGit；详情也给出 skills CLI 命令 | 补充发现入口或粘贴 GitHub 地址导入。未确认公开搜索 API，不作为首批全量自动聚合源 |

同名平台必须区分：腾讯 SkillHub 与 SkillHub.club 是两个来源；此前调研的讯飞 SkillHub 又是另一个产品。

### 3.1 已验证的搜索样本

| 来源 | 本次请求 | 观测结果 |
|---|---|---|
| SkillsMP | `GET https://skillsmp.com/api/v1/skills/search?q=frontend&limit=1` | `success: true`，返回 `frontend-patterns` 和精确 GitHub 子目录；分页含 `totalIsExact: false`，不能把 total 无条件标成精确总数 |
| ClawHub | `GET https://clawhub.ai/api/v1/search?q=frontend&limit=1` | 返回真实技能、owner、canonicalUrl、下载指标；`version` 为 null，需进一步解析详情，不能直接把搜索结果当作固定安装版本 |
| 腾讯 SkillHub | `GET https://api.skillhub.cn/api/skills?keyword=find%20skill&pageSize=1` | `code: 0`，业务数据位于 `data`；返回中文条目，下载数、安装数为不同字段 |

样本只证明响应结构，不代表推荐安装这些技能，也不把这些条目写入生产目录。

### 3.2 主要接口与配置约束

- SkillsMP：`GET /api/v1/skills/search`。文档当前列出匿名 50 次/日、10 次/分钟；带 Key 500 次/日、30 次/分钟。默认支持匿名，密钥可选；不能依赖搜索摘要中可能过时的接口或限额。详见 [API 文档](https://skillsmp.com/docs/api)。
- ClawHub：`GET /api/v1/search`、`GET /api/v1/skills`、技能详情、版本和文件接口。公开读接口不要求认证；第三方应缓存、遵守 Retry-After、保留规范来源链接。接入需核实 owner 限定、别名与实际下载解析，不仅用 slug。详见 [HTTP API](https://github.com/openclaw/clawhub/blob/main/docs/http-api.md)。
- 腾讯 SkillHub：`GET /api/skills`、`GET /api/v1/skills/{slug}`、`GET /api/v1/skills/{slug}/files`、版本接口、`GET /api/v1/download?slug=…&version=…`。下载地址临时签名，不应长期缓存；接口调用计入下载数。文档建议来源标识 Header，并说明 X-API-Key 以后会要求必填；正式/大规模接入应先确认平台接入条件。详见 [API 总览](https://github.com/Tencent/skillhub/blob/main/docs/api/README.md)、[技能及下载合同](https://github.com/Tencent/skillhub/blob/main/docs/api/skills.md)。
- SkillHub.club：`POST /api/v1/skills/search`、`GET /api/v1/skills/catalog`，需要 Key。详情和安装具体返回合同尚未验证，不预设与 skills.sh 相同。详见 [官方文档](https://www.skillhub.club/docs/api)。

## 4. 现有实现的改造点

已检查当前代码：

- `lib/skill-center/types.ts` 将 provider 限定为 skills.sh。
- `catalog.ts` 的 canonicalId/packageFromId、目录校验依赖 skills.sh 身份与 GitHub URL。
- `remote.ts` 的搜索固定 skills.sh，详情读取 GitHub；支持 Git 回退与内容快照。
- `mutations.ts` 的预检和执行使用 skills CLI 的 Pi 安装入口。
- 本地分类按 canonicalSkillId/安装实例持久化；新来源不能使旧分类失联。
- 前端 Discover 的外部入口和排序沿用单来源假设。

因此不能仅在下拉框增加网站名称。需要拆分“在哪个网站发现”“实际技能身份”“从哪里安装和更新”。

## 5. 功能与页面计划

### 5.1 发现

- 保持五领域总览；点击「发现」仍返回总览。
- 将原「到 skills.sh 外部搜索」改为简洁的「搜索技能市场」。外部页增加来源选择：全部已启用来源、skills.sh、SkillsMP、ClawHub、腾讯 SkillHub。
- 只有提交搜索时请求来源，不在首页后台批量搜索。默认按来源分组，保留各站排序；需要 Key 且未配置的来源不发请求。
- 每个来源独立加载、分页和报错；一个来源失败不清空其他结果。支持只重试失败来源。
- 卡片显示名称、描述、来源、已安装状态和可用指标；不再添加解释操作步骤的常驻文案。错误、缺配置、兼容性等必要反馈放在相关位置。
- 不跨平台比较不一致的相关性分数，也不把各站返回数量相加当作去重总量。只显示本次可核实的结果数量；近似值必须标识。

### 5.2 详情、安装与更新

- 统一详情视图：来源、作者、SKILL.md、文件、版本、兼容性及目标位置。
- GitHub 索引来源复用现有读取/校验能力；仓库子目录必须精确识别，遇到 ref/路径歧义不猜测。
- ClawHub 和腾讯 SkillHub 新增注册中心包下载适配。安装前解析版本、检查包结构与目标位置；安装后必须被当前 Pi 清单读到才记为成功。
- 不同平台发布的同名技能不得互相覆盖；确认为相同技能时提示已安装。目标目录同名但来源不同先报告冲突，第一版不自动重命名技能内容。
- 已安装清单记录实际安装来源、发现网站、版本和内容摘要；更新回到原安装来源，不能自动换镜像或换作者。
- 沿用项目/全局范围、写入互斥、恢复日志、本地修改冲突保护和个人分类。注册中心更新也必须保留模型展示设置。

### 5.3 来源设置

增加轻量「来源管理」面板：启用/停用、连接状态、凭据是否已配置、测试连接、最近错误。服务地址、限额及超时进入现有服务端配置机制。密钥不进入浏览器存储、API 响应或日志；第一版可用服务端环境变量配置密钥，界面显示状态和所需变量名，不新增网页登录流程。

正式接入腾讯所需团队 Key/调用标识应按平台合同设置；不发送本机用户名、目录或项目路径充当用户标识。尚未满足接入条件的来源保留未配置状态。

## 6. 数据与接口设计方向

### 6.1 数据身份

- `ProviderListing`：providerId、listingId、规范页面链接、来源内排序/分页字段。
- `SkillIdentity`：独立于目录网站的真实身份。GitHub 使用 host + owner/repo + 精确 skillPath；注册中心使用 provider + 权威稳定 ID/owner + skill 标识。
- `InstallOrigin`：实际下载方式、注册中心/仓库、固定版本或 commit、文件/包摘要、安装路径。
- `Metrics`：指标类型（下载、安装、仓库 Star 等）、值、是否近似、来源、采集时间。没有就省略或显示未提供，不填 0；不能将仓库 Star 展示为技能安装量。
- `ProviderCapabilities`：是否支持搜索、分页、详情、版本、下载、检查更新、是否需要 Key。

保留旧 `skills.sh:…` ID 的解析与兼容映射，不一次性重写旧清单、分类及操作记录。只有验证为同一仓库技能路径或可靠上游身份时才关联；相同名称/描述、仅内容相似不构成身份相同。腾讯镜像与 ClawHub 不依名称自动合并。

五大领域仍来自本地分类合同和个人分类；平台自己的分类独立存储，未经明确映射不直接当作五领域归属。增加网站不自动把条目加入本地维护目录，也不伪造领域收录数。

### 6.2 服务端接口

拟扩展现有技能中心 API，保持旧调用默认 skills.sh：

| 能力 | 拟定接口方向 | 验收重点 |
|---|---|---|
| 来源列表 | `GET /api/skill-center/providers` | 返回能力和连接状态，无凭据原文 |
| 多源搜索 | 现有 search 增加 providers、各源 cursor | 分源结果/错误/分页，取消旧请求，部分成功 |
| 详情 | 现有详情请求增加 provider/listing 标识 | 精确身份，不能信任客户端传入的任意下载 URL |
| 安装/更新 | 现有 plan → operation 增加安装源类型 | 共用互斥、版本检查、核验、失败恢复 |
| 清单 | 现有 inventory 扩展来源元数据 | 旧实例与分类兼容，新实例更新可追踪 |

建立小范围 provider 适配层，封装 search、resolve、files、download/version。支持缺失能力，不要求每个网站实现不存在的接口。源站字段与文档不一致时显式验证，未列入稳定合同的字段不得成为唯一安装依据。

### 6.3 原生包安装的必要约束

下载和写入放在服务端。重定向逐跳验证目标，避免访问本机/内网；授权 Header 不转发到对象存储。校验解压路径、符号链接、文件数量和大小限制，要求有效 SKILL.md，识别明显的 OpenClaw 专用插件/系统依赖。未知兼容性显示未验证，不宣称可用。

在临时目录完成内容核验，再使用已有写入门闩发布到安装目标；现有目标发生内容变化则停止覆盖。保留失败恢复所需元数据。仅下载文件不会自动执行归档中的安装脚本或安装系统依赖。平台已封禁或阻止下载的条目不绕过。

版本化包优先固定明确版本并核验文件摘要；复用现有 skills CLI 的路径不能虚称安装已经绑定预览 commit，需沿用原来的版本边界提示或另行实现可验证的固定版本安装。

## 7. 实施分期与交付门槛

| 阶段 | 工作内容 | 阶段完成条件 |
|---|---|---|
| P0：合同验证 | 主机直连三个核心来源；读取详情/版本/文件；隔离目录验证包结构；确认密钥和平台接入条件 | 每个来源都有真实响应证据与明确能力；不符合条件的来源明确记录阻塞，不声称接入完成 |
| P1：多源基础 + SkillsMP | provider 适配层、旧 ID 兼容、来源设置、分源搜索 UI；SkillsMP GitHub 来源解析与 Pi 安装/更新 | skills.sh 原流程通过回归，SkillsMP 完成搜索→详情→项目/全局安装→清单→检查更新 |
| P2：ClawHub + 腾讯 SkillHub | 注册中心包安装器、版本与哈希、来源锁、更新分派、冲突保护 | 两个来源分别通过实际隔离安装和更新核验；不修改真实用户技能作为测试夹具 |
| P3：可选扩展 | SkillHub.club 鉴权与合同验证；agentskill.sh 能力验证；目录网站/GitHub 地址导入 | 根据各站接口与配置结果单独确定；不把未验证适配器作为可用来源上线 |

审核建议：批准 P0–P2，P3 保留备选。若 P0 发现文档与实际接口存在会改变范围的差异，先回报差异并修订计划。精确工时在 P0 明确包合同、网络和密钥条件后估计，不以未经验证的天数作交付承诺。

## 8. 验收清单

1. 三个新增核心来源各自可搜索，详情与实际来源一致。
2. 全部来源模式中单源 401/429/超时不影响其他来源，不能显示成没有结果。
3. 各源分页独立，切换关键词不会混入旧结果；同名不同作者不误合并。
4. SkillsMP Star、各站下载/安装指标分别标注；0、未知、近似与精确总量正确区分。
5. 缺 Key/停用来源不发请求、不显示可安装状态。
6. GitHub 子目录精确解析，分支/路径歧义不会选错技能。
7. 注册中心具体版本与下载内容一致；签名链接过期能重新解析，不能静默降级到其他版本。
8. 路径穿越、恶意归档、错误摘要、缺 SKILL.md 和明显不兼容类型会被拒绝。
9. 全局和受信任项目均能完成真实隔离安装，被 Pi inventory 识别。
10. 同名目标冲突不覆盖用户文件；并发安装仍使用现有互斥与幂等规则。
11. 更新使用原安装来源，保留个人分类、模型展示设置，检查并保护本地修改。
12. 已安装的旧 skills.sh 技能、旧分类和待处理操作记录继续可读。
13. 服务端凭据与本地路径不会出现在源站查询、浏览器返回和日志中。
14. 发现标签返回五领域首页、保存浮层、手机/中等宽度布局保持当前已确认行为。
15. 无可用更新能力时显示不支持/未核实，不伪造“已是最新”。
16. 执行适配器合同测试、相关既有回归、TypeScript、ESLint、浏览器验证；真实安装核验与 UI 夹具证据分开记录。

## 9. 待审核决策

建议采用 **P0–P2：新增 SkillsMP、ClawHub、腾讯 SkillHub**，保持五领域首页，增加统一市场搜索和来源选择。SkillHub.club、agentskill.sh 与目录导入作为 P3。

用户批准计划后才进入实施；本文件不授权注册账号、购买配额或发布产品。

## 10. 参考资料

- [SkillsMP API](https://skillsmp.com/docs/api)
- [ClawHub 官方仓库](https://github.com/openclaw/clawhub) 与 [HTTP API](https://github.com/openclaw/clawhub/blob/main/docs/http-api.md)
- [腾讯 SkillHub 官方仓库](https://github.com/Tencent/skillhub)、[API 总览](https://github.com/Tencent/skillhub/blob/main/docs/api/README.md)、[搜索/详情/下载](https://github.com/Tencent/skillhub/blob/main/docs/api/skills.md)
- [SkillHub.club API](https://www.skillhub.club/docs/api)
- [agentskill.sh 官方 CLI](https://github.com/agentskill-sh/ags)
- [Awesome MCP Servers 技能库](https://mcpservers.org/agent-skills)、[示例详情](https://mcpservers.org/agent-skills/anthropic/frontend-design)
