# agentskill.sh 关键词搜索故障排查

日期：2026-09-12。触发：技能中心选择 agentskill.sh，搜索「测试工程」，显示来源 HTTP 500。

## 结论

故障已定位到 agentskill.sh 的关键词检索路径。官方 CLI 搜索 API 和官网页面搜索 API 都在提供关键词时返回 HTTP 500；热门列表与一个真实技能的文件包接口正常。无法读取源站服务端日志，因此不能进一步确认其内部是索引、数据库查询还是其他依赖错误。

不是把中文关键词换成英文、缩小结果数量或换成官方 CLI 请求头就能解决的问题。pi-web 捕获来源的 HTTP 500，并以本地 HTTP 502 / `SOURCE_UNAVAILABLE` 返回给界面。

## 本机真实验证

| 检查 | 请求 | 结果 |
|---|---|---|
| 用户操作链路 | pi-web 搜索 provider=agentskill.sh，query=测试工程，limit=50 | 本地 502，错误中标明来源 HTTP 500 |
| 官方 CLI 请求方式 | `/api/agent/search?q=testing&limit=5`，User-Agent=ags/2.0.1 | 500，`Failed to search skills` |
| 中文直连 | `/api/agent/search?q=测试工程&limit=5`，使用 URLSearchParams 编码 | 500，`Failed to search skills` |
| 官网搜索接口，英文 | `/api/skills?q=testing&page=1&limit=5&includeTotal=false` | 500，`Failed to fetch skills` |
| 官网搜索接口，中文 | 同上，q=测试工程 | 500，`Failed to fetch skills` |
| 官网首页 | `/` | 200 |
| 官网热门列表 | `/api/skills?page=1&limit=5&includeTotal=true&section=top` | 200，返回真实技能数组 |
| 真实技能文件包 | `/api/agent/skills/openclaw%2Fopenclaw-testing/install` | 200，身份一致，含 SKILL.md 与支持文件 |
| pi-web 详情适配 | `POST /api/skill-center/detail`，canonicalSkillId=agentskill.sh:openclaw/openclaw-testing | 200，metadataState=ready，完整文件包共 3 个文件 |

真实技能标识取自官网当前热门列表链接，没有猜测或伪造数据。本轮只读查询与预览，没有安装到用户技能目录，也未调用源站安装统计写入接口。

## 接口核对依据

- [官方 CLI search.ts](https://github.com/agentskill-sh/ags/blob/main/src/commands/search.ts)：`/agent/search`，query 参数为 q、limit。
- 官网当前首页加载的 `/_nuxt/D0c8R6OR.js`：fetchSkills 使用 `/api/skills`，关键词参数 q；首页默认 section=top。
- 检查使用的官网 HTML 与 JS 原始资料暂存在 `C:/Users/xiaox/AppData/Local/Temp/agentskill-diagnosis-Gx8lBy`，没有引入项目源码或执行这些脚本。

## 处理边界

当前没有验证到可替代的正常关键词搜索 API，因此不修改为另一个同样失败的接口、不用热门列表冒充搜索结果，也不无限重试。可以手动切换到已接入的 SkillsMP 或 skills.sh 完成搜索；agentskill.sh 的关键词检索需源站修复后再验收。

前一份接入说明中“agentskill.sh 真实下载尚未验证”的状态在本次有所推进：其真实文件包及 pi-web 详情读取已验证成功，实际安装到磁盘仍未作为本次测试执行。
