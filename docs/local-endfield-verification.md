# 2026-09-25 本机复验记录

本地分支 `fix/windows-models-config-save` 在官方 0.9.3 基础上包含模型保存修复（`267119a`）与终末地主题（`15bef19`）。`piweb` 已启动本仓库的生产构建；30141 端口的 Next.js 进程及其 Pi Web 父进程路径均指向本仓库。

- `npm run lint`、`npx tsc --noEmit`、定向主题与模型保存测试、`npm run build` 通过。构建期间的动态依赖警告来自现有的会话导出路由，不影响构建完成。
- `e2e/themes.mjs` 在 1440、390、320px 下通过七个主题的选取、对比度、刷新恢复、键盘操作与选项尺寸检查。`e2e/models-config-loading.mjs` 确认模型配置加载完成前不能保存。
- 现有 Chrome 标签页刷新后仍选中「终末地」。实际聊天内容的正文、加粗、链接与列表标记分别读到 `rgb(216, 220, 224)`、`rgb(237, 240, 242)`、`rgb(185, 201, 208)`、`rgb(155, 164, 173)`。
- 真实模型界面在配置加载完成后保存成功，接口回读的对象与保存前相同。复验后已恢复原始 `models.json` 文件，其 SHA-256 与切换前备份一致：`63883EE3BBCCB99BD390CBD5D3DC4F5AF3C56EA14B99CD3B1F577098A786D933`。
- 备份及本地安装包位于 `C:\Users\JUSTLIKEZYP\AppData\Local\PiWeb\backups\endfield-source-launch-20260925`。安装包 SHA-256：`569C6C9AFC96C442F64B9D3FDDD1C428D9E7C69C72BE506D0F136EE6AA2F1FBD`。

本次还发现旧界面在配置加载前可以点击保存，可能写入空配置；已在界面和保存处理函数两层阻止，并用独立浏览器测试复验。
