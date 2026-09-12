# skills.sh 安装与安装量问题修复记录

日期：2026-09-12。范围：技能中心真实来源安装、安装量展示及安装后的状态核验。

## 故障证据与修复

| 问题 | 实际证据 | 修复 |
|---|---|---|
| 安装预检阻断，CLI 未启动 | 同一 `anthropics/skills@frontend-design`，官方 CLI 在隔离 HOME 安装成功；本地 `/api/skill-center/plans` 返回 429，内部错误为 GitHub HTTP 403 | GitHub API 失败或超时后通过只读 Git 对象回退；仍核验实际 frontmatter 唯一身份、提交及文件范围 |
| 重复请求增加限流概率 | 预检逐个读取仓库内所有 SKILL.md；详情正文再次请求同一 blob | Git 回退一次浅抓取后读取本地对象；当前 SKILL.md 正文复用已核验的快照缓存 |
| 新项目首次安装后无法核验 | 安装前空项目不需要信任；安装后存在 `.agents/skills`，但没有持久化信任决定，inventory 不再读取项目资源 | 首次项目安装计划明确列出 `trust-project-resources` 确认。用户勾选后才持久化到现有 SDK 信任存储；既有未信任项目仍受原信任流程限制 |
| 刚安装就显示有更新 | skills CLI 1.5.26 在 GitHub 限流时写入 64 位 SHA-256 内容哈希，旧代码将其与 40 位 Git tree SHA-1 比较 | 区分 Git 目录哈希与内容哈希。SHA-256 采用源文件路径与内容计算，识别普通 LF / Windows CRLF 表示，避免与 Git tree 或过时的下载快照混比 |
| CLI 降级计数出现重复单位 | `display="1.2K installs"`，组件再次追加“安装” | 集中解析和展示；整数千位分隔，缩写显示“约”，去掉重复英文单位 |
| 缩写排序错误 | `1.2K` 的精确 numeric 为 null，被排在 14 之后 | numeric 保留 null；独立计算仅用于排序的近似值，真正未知值置尾 |
| namespaced skill 被丢弃 | 官方搜索确有 `google-labs-code/stitch-skills@stitch::react-native`，旧规范名不接受 `::` | 规范身份和 CLI 文本解析支持命名空间名称；未放宽仓库地址或允许路径穿越 |

## 安装量口径

本地 API 与源站同次查询的前五条安装量逐项一致：878556、1678、469398、231769、54485。不存在已确认的整数倍数换算错误；源站数据会继续变化，这些数值只是调查时点的证据，未写入产品数据。

显示为“878,556 次安装”；源站缩写“1.2K installs”显示为“约 1.2K 次安装”。零值保留零，未知不变成零。安装量来自 CLI 遥测聚合，不代表独立用户人数；不同页面可能因更新时间不同出现差异。[官方 FAQ](https://www.skills.sh/docs/faq)、[官方 API 字段说明](https://www.skills.sh/docs/api)。

继续使用与官方 CLI 相同的公共 `/api/search`；不切换到需要额外认证的 `/api/v1`。[官方 CLI 源码](https://github.com/vercel-labs/skills)。

## 验证结果

- 修复前真实预检：HTTP 429 / GitHub 403；修复后同一请求：HTTP 200，约 3.5 秒。
- 真实 CLI 完整流程：预检 → 提交 → 安装 → 文件/锁/身份/版本核验。
  - 全局：`succeeded`，9764 毫秒，`currentSourceStatus=up-to-date`。
  - 项目：`succeeded`，8961 毫秒，`currentSourceStatus=up-to-date`。
  - 两次均使用临时 HOME、Agent 目录、项目和锁目录，未向用户真实技能位置安装测试技能。流程结束后清理本次测试目录。
- [61 项针对性回归测试](implemented/install-fix-tests.txt)：61 通过，0 失败。包括真实临时 Git 仓库对象读取、固定旧提交、未知 blob 拒绝、进程树未确认时保留临时目录、GitHub 403 回退、歧义拒绝、计数解析/排序、首次项目信任及既有写入保护。
- `npx tsc --noEmit --pretty false`：通过。
- `npm run lint`：通过。
- `git diff --check`：通过（Git 有现有 LF/CRLF 提示）。
- 按仓库 AGENTS，不在运行 dev 时执行 `next build`。本轮未重跑仓库全量测试；此前全量失败记录仍保留在 IMPLEMENTATION.md。
- 浏览器已核对真实搜索结果的千位分隔、来源口径说明及安装预检入口；真实写入闭环由隔离环境直接调用产品服务与官方 CLI 验证。
- 浏览器“确认安装”按钮在真实预检完成后可用；最终页面控制台 error 记录为空。[搜索结果截图](implemented/install-fix-search.png)、[安装预检截图](implemented/install-fix-plan.png)。未在用户真实全局技能目录提交示例安装。

手动复测脚本：[verify-real-install.mjs](verify-real-install.mjs)。该脚本需要网络与 Git，并明确在临时 HOME 内执行真实安装，不属于默认离线单元测试。

## 运行边界

Git 回退复用现有 `PI_SKILL_CENTER_CLI_TIMEOUT_MS` 预算，抓取执行预留同等进程终止时间；不执行仓库文件、不 checkout、不跳过唯一名称校验。若无法确认 Git 进程树结束，保留临时仓库并在服务端记录目录，避免删除仍在使用的位置。

私有仓库仍依赖服务器已有 Git 凭据；网络或权限均不可用时返回真实失败。SHA-256 内容比较当前覆盖默认分支和固定提交、普通 LF/CRLF 文件；命名 ref 的该类比较明确返回 unsupported，自定义 Git smudge/混合属性转换未做真实安装验证。超过文件读取预算时不会伪造最新版本。

## 临时探测目录

完整流程脚本创建的临时目录已清理。初始独立 CLI 探测目录 `C:/Users/xiaox/AppData/Local/Temp/pi-skill-install-probe-Y81zI8` 仍保留：自动审批审查拒绝其删除，原因是“blocked by policy”。未重试或绕过；该目录不是用户真实技能安装位置。
