# 2026-09-25 本机复验记录

本地分支 `fix/windows-models-config-save` 在官方 0.9.3 基础上包含模型保存修复（`267119a`）与终末地主题（`15bef19`）。`piweb` 已启动本仓库的生产构建；30141 端口的 Next.js 进程及其 Pi Web 父进程路径均指向本仓库。

- `npm run lint`、`npx tsc --noEmit`、定向主题与模型保存测试、`npm run build` 通过。构建期间的动态依赖警告来自现有的会话导出路由，不影响构建完成。
- `e2e/themes.mjs` 在 1440、390、320px 下通过七个主题的选取、对比度、刷新恢复、键盘操作与选项尺寸检查。`e2e/models-config-loading.mjs` 确认模型配置加载完成前不能保存。
- 现有 Chrome 标签页刷新后仍选中「终末地」。实际聊天内容的正文、加粗、外部资料链接与列表标记分别读到 `rgb(216, 220, 224)`、`rgb(237, 240, 242)`、`rgb(255, 199, 44)`、`rgb(155, 164, 173)`。本地文件链接保留冷灰蓝 `#b9c9d0`。
- 真实模型界面在配置加载完成后保存成功，接口回读的对象与保存前相同。复验后已恢复原始 `models.json` 文件，其 SHA-256 与切换前备份一致：`63883EE3BBCCB99BD390CBD5D3DC4F5AF3C56EA14B99CD3B1F577098A786D933`。
- Maple Mono v7.9 的官方 `MapleMono-CN.zip` 和 `MapleMono-NF-CN.zip` 已下载并解压到 `D:\ALL\字体`，分别与官方 SHA-256 `cb1e79b2c23dff772ae351784ef2b84454a61b3920e9b20bd5db4bf207e4472d` 和 `af913b6322905348b3f50e4397fedc35b3a880db5effcce7969003051dcd3e94` 一致。两套字体的 Regular、Bold、Italic、BoldItalic 已安装到当前 Windows 用户字体目录。
- 追查“中文没变化”时发现：旧构建虽声明 `Maple Mono CN`，新的隔离浏览器却实际用 Microsoft YaHei 绘制中文。先前测试在临时加载系统字体后立即运行，不能证明后续浏览器仍可用。现已将 Maple Mono CN 与 JetBrains Mono NL 的常规、粗体、斜体、粗斜体转换为 WOFF2，连同字体许可证放在 `public/fonts`，由 piweb 同源提供。`NF CN` 下载包仍保留在 `D:\ALL\字体`，网页正文采用 CN 版。
- 按参考图启用 `cv01`、plain italic (`cv32` 至 `cv37`) 和 `zero`，关闭 `cv04`；代码区域清除这些 Maple 特性并继续使用 JetBrains Mono NL。全新 Chrome 实例通过 DevTools 字体诊断确认真实中文消息为 `Maple Mono CN (custom font)`、代码为 `JetBrains Mono NL (custom font)`，不依赖 Windows 用户字体注册。
- `npm run lint`、`npm run build` 和 `e2e/themes.mjs` 通过；主题测试覆盖 1440、390、320px 的字体加载、主题恢复、对比度、键盘操作和标签尺寸。四个 Maple 字体 URL 均返回 `200 font/woff2`，`GET /api/models-config` 返回 200。其他主题仍使用原有字体规则。
- 本地安装包与备份位于 `C:\Users\JUSTLIKEZYP\AppData\Local\PiWeb\backups\endfield-source-launch-20260925`。本次安装包 SHA-256：`D319FF486F4B4007F7D9813FBDE3908A9EB38147E901A206A2AF5AA502A8AB88`；包内包含八个 WOFF2 文件及字体许可证。

本次还发现旧界面在配置加载前可以点击保存，可能写入空配置；已在界面和保存处理函数两层阻止，并用独立浏览器测试复验。
