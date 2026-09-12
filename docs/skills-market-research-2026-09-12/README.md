# Pi Web Skills 市场与管理界面调研

> 后续需求更新（2026-09-12）：技能中心已明确扩展为计算机、金融、哲学、心理学、玄学五大领域。本文保留当时的市场产品调研事实；当前功能分类、PRD 与图稿以 [五领域设计文档](../skills-center-2026-09-12/README.md) 为准。市场基础设施参考不等于已验证这五个领域都有足够的真实技能条目。

调研日期：2026-09-12。按用户要求使用 anysearch 搜索和提取 GitHub/官方文档，并在右侧浏览器所属的内置浏览器中查看公开页面。本文是设计参考与能力差距分析，本轮未修改产品代码、安装技能、登录第三方或部署其他项目。

## 建议结论

优先组合四个项目的长处：

1. **skills.sh / vercel-labs/skills：发现与分发。** 与 pi-web 现有搜索、安装、更新链路最接近。
2. **runkids/skillshare：已安装管理。** 最接近本地工具型产品的日常管理需求。
3. **openclaw/clawhub：技能详情与安装前判断。** 用途、作者、内容、文件、版本和变更集中呈现。
4. **iflytek/skillhub：中文目录与团队技能库。** 卡片搜索值得参考；私有发布、命名空间与审核适合作为后续团队化方向。

建议将 pi-web 技能功能升级为“技能中心”，一级内容为 **发现 / 已安装 / 更新**，详情和安装是上下文子视图。沿用已选 Clear Horizon 视觉，不整套搬入其他项目的品牌或服务架构。

## 候选比较

| 项目 | 本轮确认的定位 | 可以参考 | 对 pi-web 的适用边界 |
|---|---|---|---|
| [skills.sh](https://skills.sh) / [vercel-labs/skills](https://github.com/vercel-labs/skills) | 公开技能目录 + 开源安装/管理 CLI；仓库标注 MIT | 搜索、累计/趋势/热门榜单、专题入口、仓库署名、安装量、简洁安装入口 | 最适合保留为首个外部来源。该 GitHub 仓库是 CLI，不能据此认定 skills.sh 整站前端已开源 |
| [ClawHub](https://clawhub.ai) / [openclaw/clawhub](https://github.com/openclaw/clawhub) | 完整公共 Skill/Plugin 注册中心；仓库标注 MIT | 分类与主题、作者、SKILL.md/Files/Diff/Versions 标签、独立安装区域、更新时间和当前版本 | 很适合详情信息结构。OpenClaw 插件不等于 Pi 技能，接入前需区分资源类型与兼容性 |
| [SkillHub](https://skill.xfyun.cn) / [iflytek/skillhub](https://github.com/iflytek/skillhub) | 可自托管的企业技能注册中心；仓库标注 Apache-2.0 | 中文搜索、排序/分类筛选、技能摘要卡片、版本、团队命名空间、发布与管理分工 | 可参考市场页与未来私有源。React + Spring Boot 等整套服务并非 pi-web 改版的必要条件 |
| [skillshare](https://github.com/runkids/skillshare) / [UI 文档](https://skillshare.runkids.cc/docs/reference/commands/ui/) | 本地技能管理与多工具同步，有 React Web UI；仓库标注 MIT | 本地列表搜索、来源筛选、分组/网格、内容预览、安装来源、项目/全局上下文 | 最适合已安装页；多 Agent 同步、Git 同步等不是当前 pi-web 必须新增的能力 |

以上许可证是对应仓库声明，不代表市场上每个技能包使用同一许可证。本轮未以 Star 数或平台技能总数作为排序依据：它们会变化，也不能直接代表界面质量或技能质量。

## 四个参考应如何使用

### 1. skills.sh：让用户先找到技能

已打开首页，确认搜索、All Time / Trending / Hot、Packs / Topics / Official / Audits 入口，结果行包含名称、来源与安装量。官方 CLI 文档确认支持 Pi，以及安装、列出、检查更新、更新与移除能力。

**建议借鉴：** 搜索始终可见；用任务与主题帮助用户发现；在列表中保留作者/仓库署名；已安装技能带本地状态。pi-web 内部页面应优先展示搜索和结果，不需要照搬官网的大幅品牌介绍区。

**证据：** [在线目录](https://skills.sh)、[开源 CLI](https://github.com/vercel-labs/skills)、[本轮页面截图](screenshots/skills-directory.png)。

### 2. ClawHub：让用户看懂再安装

实际查看了 [Planning with files 详情](https://clawhub.ai/othmanadi/skills/planning-with-files)：标题与用途在前，随后是作者和安装区域，内容标签包括 SKILL.md、Skill Card、Files、Diff、Versions；侧面展示下载趋势、审查状态、更新时间和当前版本。仓库也记录版本发布、更新及固定本地安装的能力。

**建议借鉴：** 详情不再以磁盘路径作为第一信息。顺序应为“解决什么问题 → 何时使用 → 内容/文件 → 来源/版本 → 安装”。安装入口中展示当前项目或全局的目标；不能把“平台审查通过”解释成技能一定适配 Pi 或绝对安全。

**证据：** [仓库](https://github.com/openclaw/clawhub)、[详情页](https://clawhub.ai/othmanadi/skills/planning-with-files)、[首页截图](screenshots/clawhub-directory.png)、[详情截图](screenshots/clawhub-detail.png)。

### 3. 讯飞 SkillHub：中文卡片搜索与团队治理

已查看公开站点的搜索页：搜索栏、相关性/下载量/最新排序、收藏/精选/分类筛选、摘要卡片，卡片带命名空间、版本和统计信息。仓库文档确认私有部署、版本标签、团队命名空间、角色与审核能力。

**建议借鉴：** 卡片每项突出名称、两行用途和来源；排序与筛选集中放在结果上方。团队发布、审核、命名空间适合后续确有共享需求时增加。

**注意语义：** SkillHub 的 global/team 命名空间描述注册中心的组织与可见性；pi-web 的“全局/项目”描述本机安装位置。两者是不同维度，设计中不能合成同一个开关。

**证据：** [仓库](https://github.com/iflytek/skillhub)、[公开搜索](https://skill.xfyun.cn/search)、[本轮搜索截图](screenshots/skillhub-search.png)。

### 4. skillshare：安装之后的管理体验

官方 UI 文档列出 Skills 搜索与分组/网格、安装、目标、同步预览、备份、回收站等页面。本轮查看了仓库提供的 Skills 官方截图，可见搜索、来源筛选、排序和技能网格。该截图是仓库存档示例，并非本轮部署运行的最新版 UI。

**建议借鉴：** “发现”和“已安装”分开；已安装页支持按名称/描述搜索，按项目/全局、来源、自动调用状态、可更新状态筛选。大量技能管理可优先用紧凑列表，发现页再使用卡片。

**证据：** [仓库](https://github.com/runkids/skillshare)、[UI 页面清单](https://skillshare.runkids.cc/docs/reference/commands/ui/#dashboard-pages)、[官方原截图](https://github.com/runkids/skillshare/blob/main/.github/assets/ui/web-skills-demo.png)、[本轮浏览该截图的证据](screenshots/skillshare-official-preview.png)。

## 补充候选及排除理由

- [LobeHub Skills](https://lobehub.com/skills)：anysearch 提取到的是面向 Agent 的市场使用文档；内置浏览器访问触发 Cloudflare 拦截。本轮没有验证其实际视觉界面，也未确认公开市场后端是否完整开源，因此不作为主要视觉/源码依据。
- [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)：本轮搜索发现的技能合集，适合作为内容来源继续评估，不把合集 README 当作完整市场实现。
- 名称中含“Skill Hub”的站点很多。应按完整仓库地址区分，本文的企业型 SkillHub 专指 iflytek/skillhub。

## 与当前 pi-web 的差距

源码核查入口：[SkillsConfig.tsx](../../components/SkillsConfig.tsx)、[数据类型](../../lib/api-types.ts)、[搜索接口](../../app/api/skills/search/route.ts)、[安装接口](../../app/api/skills/install/route.ts)、[更新逻辑](../../lib/skill-updates.ts)。

**已确认现有能力：**

- 搜索 skills.sh；搜索 API 失败时有 CLI 查找后备路径。
- 安装使用 skills CLI 并指定 Pi，支持当前项目/全局作用域及项目资源信任条件。
- 本地技能返回名称、描述、路径、来源、安装信息和模型自动调用设置。
- 单项/全部检查更新及更新状态。
- 当前 `disableModelInvocation` 控制模型自动调用可见性。关闭后仍可能手动调用，不是卸载，也不是彻底禁用。

**关键数据限制：** 远程 `SkillSearchResult` 当前仅有 `package / installs / url`。用途摘要、分类、更新时间、文件内容、许可证和审查信息没有通过该结构返回。搜索接口还将结果按安装量重新排序，不能直接将其标成“相关性排序”。

| 拟设计能力 | 当前基础 | 实施判断 |
|---|---|---|
| 发现/已安装/更新分区 | 现有操作已存在，但混在设置分栏 | 可优先重组入口 |
| 已安装搜索、来源/作用域/状态筛选 | 本地有名称、描述、来源、开关与更新状态 | 大部分可以复用数据 |
| 搜索结果用途摘要、分类、更新时间 | 远程结果缺少这些字段 | 需要扩展元数据获取；缺失时显示未提供 |
| 远程详情的 SKILL.md、文件和版本列表 | 当前接口不包含完整远程详情 | 需要新的读取/解析与缓存能力 |
| 热门/最新/相关性排序 | 当前搜索按安装量排序，非完整榜单服务 | 需要数据来源与明确排序规则 |
| 安装前目标预览 | 已有项目/全局安装参数 | UI 可以先强化，保留原有校验 |
| 版本差异、固定版本、回滚 | 现有更新结果不足以支持完整生命周期 | 属于新增能力，分期设计 |
| 卸载与回收 | 当前技能页没有完整卸载流程 | 属于新增能力，不能把自动调用开关冒充卸载 |
| 多市场/私有源 | 现有流程围绕 skills.sh / skills CLI | 有明确需求后增加来源适配，不能只添加下拉菜单 |

## 建议下一轮绘制的五个页面

1. **技能中心·发现**：全局搜索、主题入口、排序、用途卡片、安装状态；首次进入和无结果状态。
2. **技能详情**：用途摘要、使用场景、SKILL.md、文件、来源与版本；明确哪些字段尚未提供。
3. **安装面板**：当前项目/全局、实际目标、安装中/失败/成功；完成后可跳到已安装。
4. **已安装管理**：名称/描述搜索、作用域/来源/自动调用/更新筛选、紧凑列表与详情。
5. **更新中心**：当前版本→可用版本、检查时间、支持/不支持更新、单项操作及结果。

建议先以“发现 + 已安装”为核心完成视觉探索，再细化详情、安装和更新。首次阶段复用 skills.sh，不同时接入多个市场；保留接口层日后扩展的空间即可。

## 调研记录与局限

anysearch 使用配置的受保护 Node CLI，所有网络搜索/提取均带 `--fresh`。检索围绕 GitHub skills marketplace、ClawHub、Vercel skills、SkillHub、skillshare、LobeHub 展开；结论优先使用项目 README、官方文档与实际页面，未用二手文章证明核心功能。

截图为公开页面在本轮浏览时的实际视口，不统一缩放，也不用于像素级设计验收。页面与仓库会继续变化；没有安装或实际运行这些第三方项目，不能把 README 声明等同于本机功能测试通过。
