# 2026-09-25 本机复验记录

本地分支 `fix/windows-models-config-save` 在官方 0.9.3 基础上包含模型保存修复（`267119a`）与终末地主题（`15bef19`）。`piweb` 已启动本仓库的生产构建；30141 端口的 Next.js 进程及其 Pi Web 父进程路径均指向本仓库。

- `npm run lint`、`npx tsc --noEmit`、定向主题与模型保存测试、`npm run build` 通过。构建期间的动态依赖警告来自现有的会话导出路由，不影响构建完成。
- `e2e/themes.mjs` 在 1440、390、320px 下通过七个主题的选取、对比度、刷新恢复、键盘操作与选项尺寸检查。`e2e/models-config-loading.mjs` 确认模型配置加载完成前不能保存。
- 现有 Chrome 标签页刷新后仍选中「终末地」。实际聊天内容的正文、加粗、外部资料链接与列表标记分别读到 `rgb(216, 220, 224)`、`rgb(237, 240, 242)`、`rgb(255, 199, 44)`、`rgb(155, 164, 173)`。本地文件链接保留冷灰蓝 `#b9c9d0`。
- 真实模型界面在配置加载完成后保存成功，接口回读的对象与保存前相同。复验后已恢复原始 `models.json` 文件，其 SHA-256 与切换前备份一致：`63883EE3BBCCB99BD390CBD5D3DC4F5AF3C56EA14B99CD3B1F577098A786D933`。
- 字体更新后，现有 Chrome 标签页刷新仍恢复 `endfield`。页面实测 `body` 的字体候选为 `ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace`，代码变量为 `JetBrains Mono NL, Consolas, monospace`。Chrome 实际使用 Consolas 渲染拉丁界面文字、Microsoft YaHei 补齐中文、JetBrains Mono NL 渲染代码。主题专属 CSS 不影响其他主题。
- 字体更新的 `npm run lint`、`npm run build` 和 `e2e/themes.mjs` 通过；主题测试覆盖 1440、390、320px，并增加标签单行检查，320px 下的 Endfield 标签不再断行。刷新后先前因重启出现的 `Failed to fetch` 消失，`GET /api/models-config` 返回 200；原始 `models.json` 哈希仍与备份一致。
- 备份及本地安装包位于 `C:\Users\JUSTLIKEZYP\AppData\Local\PiWeb\backups\endfield-source-launch-20260925`。字体更新后重新打包的安装包 SHA-256：`FBE4DBD3FA65CE27DD5A4623265D7BC864FF3070799CDD61E022987DD1A55A1F`，包内构建 CSS 已确认包含 `JetBrains Mono NL`。

本次还发现旧界面在配置加载前可以点击保存，可能写入空配置；已在界面和保存处理函数两层阻止，并用独立浏览器测试复验。
