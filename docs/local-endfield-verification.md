# 2026-09-25 本机复验记录

本地分支 `fix/windows-models-config-save` 在官方 0.9.3 基础上包含模型保存修复（`267119a`）与终末地主题（`15bef19`）。`piweb` 已启动本仓库的生产构建；30141 端口的 Next.js 进程及其 Pi Web 父进程路径均指向本仓库。

- `npm run lint`、`npx tsc --noEmit`、定向主题与模型保存测试、`npm run build` 通过。构建期间的动态依赖警告来自现有的会话导出路由，不影响构建完成。
- `e2e/themes.mjs` 在 1440、390、320px 下通过七个主题的选取、对比度、刷新恢复、键盘操作与选项尺寸检查。`e2e/models-config-loading.mjs` 确认模型配置加载完成前不能保存。
- 现有 Chrome 标签页刷新后仍选中「终末地」。实际聊天内容的正文、加粗、外部资料链接与列表标记分别读到 `rgb(216, 220, 224)`、`rgb(237, 240, 242)`、`rgb(255, 199, 44)`、`rgb(155, 164, 173)`。本地文件链接保留冷灰蓝 `#b9c9d0`。
- 真实模型界面在配置加载完成后保存成功，接口回读的对象与保存前相同。复验后已恢复原始 `models.json` 文件，其 SHA-256 与切换前备份一致：`63883EE3BBCCB99BD390CBD5D3DC4F5AF3C56EA14B99CD3B1F577098A786D933`。
- Maple Mono v7.9 的官方 `MapleMono-CN.zip` 和 `MapleMono-NF-CN.zip` 已下载并解压到 `D:\ALL\字体`，分别与官方 SHA-256 `cb1e79b2c23dff772ae351784ef2b84454a61b3920e9b20bd5db4bf207e4472d` 和 `af913b6322905348b3f50e4397fedc35b3a880db5effcce7969003051dcd3e94` 一致。两套字体的 Regular、Bold、Italic、BoldItalic 已安装到当前 Windows 用户字体目录。
- 应用户要求改回非侵入式字体方案：终末地主题直接引用当前 Windows 用户已安装的 `Maple Mono CN`，并以 `Maple Mono NF CN` 为候选；代码引用已安装的 `JetBrains Mono NL`。已移除主题自带的 `@font-face` 和 `public/fonts` 文件，不再将约 23 MB 字体资源打入安装包。
- 真实 Windows 用户的字体集合包含上述三个字体系列，Maple 注册项的字体文件均存在。此前隔离测试进程属于另一个 Windows 用户，无法读取真实用户的字体注册项，曾将其回退误判为用户浏览器状态。真实用户下新启动的 Chrome 通过 DevTools 字体诊断确认：中文消息是 `Maple Mono CN`、代码是 `JetBrains Mono NL`，两者 `isCustomFont` 均为 `false`，即使用系统安装字体。
- 按参考图继续启用 `cv01`、plain italic (`cv32` 至 `cv37`) 和 `zero`，关闭 `cv04`；代码区域清除这些 Maple 特性。主题切换和 1440、390、320px 布局检查保留。
- `npm run lint`、`npx tsc --noEmit`、`npm run build` 和 `e2e/themes.mjs`（1440、390、320px）通过。`GET /api/models-config` 返回 200，原始 `models.json` SHA-256 仍为 `63883EE3BBCCB99BD390CBD5D3DC4F5AF3C56EA14B99CD3B1F577098A786D933`。
- 本地安装包与备份位于 `C:\Users\JUSTLIKEZYP\AppData\Local\PiWeb\backups\endfield-source-launch-20260925`。本次非内嵌字体构建的安装包 SHA-256 为 `13645894B078C273CB547BE50B3E90272BB233F1BE88204BA535DB64E7650B21`；包内字体文件数为 0。

本次还发现旧界面在配置加载前可以点击保存，可能写入空配置；已在界面和保存处理函数两层阻止，并用独立浏览器测试复验。
