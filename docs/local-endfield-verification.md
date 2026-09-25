# 2026-09-25 本机复验记录

本地分支 `fix/windows-models-config-save` 在官方 0.9.3 基础上包含模型保存修复（`267119a`）与终末地主题（`15bef19`）。`piweb` 已启动本仓库的生产构建；30141 端口的 Next.js 进程及其 Pi Web 父进程路径均指向本仓库。

- `npm run lint`、`npx tsc --noEmit`、定向主题与模型保存测试、`npm run build` 通过。构建期间的动态依赖警告来自现有的会话导出路由，不影响构建完成。
- `e2e/themes.mjs` 在 1440、390、320px 下通过七个主题的选取、对比度、刷新恢复、键盘操作与选项尺寸检查。`e2e/models-config-loading.mjs` 确认模型配置加载完成前不能保存。
- 现有 Chrome 标签页刷新后仍选中「终末地」。实际聊天内容的正文、加粗、外部资料链接与列表标记分别读到 `rgb(216, 220, 224)`、`rgb(237, 240, 242)`、`rgb(255, 199, 44)`、`rgb(155, 164, 173)`。本地文件链接保留冷灰蓝 `#b9c9d0`。
- 真实模型界面在配置加载完成后保存成功，接口回读的对象与保存前相同。复验后已恢复原始 `models.json` 文件，其 SHA-256 与切换前备份一致：`63883EE3BBCCB99BD390CBD5D3DC4F5AF3C56EA14B99CD3B1F577098A786D933`。
- 字体更新后，现有 Chrome 标签页刷新仍恢复 `endfield`。页面实测 `body` 的字体候选为 `ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace`，代码变量为 `JetBrains Mono NL, Consolas, monospace`。Chrome 实际使用 Consolas 渲染拉丁界面文字、Microsoft YaHei 补齐中文、JetBrains Mono NL 渲染代码。主题专属 CSS 不影响其他主题。
- 字体更新的 `npm run lint`、`npm run build` 和 `e2e/themes.mjs` 通过；主题测试覆盖 1440、390、320px，并增加标签单行检查，320px 下的 Endfield 标签不再断行。刷新后先前因重启出现的 `Failed to fetch` 消失，`GET /api/models-config` 返回 200；原始 `models.json` 哈希仍与备份一致。
- 备份及本地安装包位于 `C:\Users\JUSTLIKEZYP\AppData\Local\PiWeb\backups\endfield-source-launch-20260925`。上一版 Codex 字体构建的安装包 SHA-256 为 `FBE4DBD3FA65CE27DD5A4623265D7BC864FF3070799CDD61E022987DD1A55A1F`，现已由下面的 Maple 构建包替换。
- Maple Mono v7.9 的官方 `MapleMono-CN.zip` 和 `MapleMono-NF-CN.zip` 已下载并解压到 `D:\ALL\字体`，分别与官方 SHA-256 `cb1e79b2c23dff772ae351784ef2b84454a61b3920e9b20bd5db4bf207e4472d` 和 `af913b6322905348b3f50e4397fedc35b3a880db5effcce7969003051dcd3e94` 一致。两套字体的 Regular、Bold、Italic、BoldItalic 已安装到当前 Windows 用户字体目录。
- 终末地主题将普通界面和聊天正文设为 `Maple Mono CN`，`Maple Mono NF CN` 为候选；按参考图启用 `cv01`、plain italic (`cv32` 至 `cv37`) 和 `zero`，关闭 `cv04`。代码字体仍为 `JetBrains Mono NL`。Chrome 字体诊断确认中英文示例实际由 Maple Mono CN 渲染，代码示例由 JetBrains Mono NL 渲染；`e2e/themes.mjs` 在 1440、390、320px 下通过字体、字形、主题和布局检查。字体存放在本机用户目录，换机器运行时需另行安装。
- Maple 字体更新后的本地安装包 SHA-256：`89E7DF042676629DDA893B533367344D43804605BABDDF5CF382A80E4CF216FF`；包内构建 CSS 已确认包含 `Maple Mono CN`。

本次还发现旧界面在配置加载前可以点击保存，可能写入空配置；已在界面和保存处理函数两层阻止，并用独立浏览器测试复验。
