# 本机 Pi Web：终末地主题与模型保存修复

这份本地构建基于官方 0.9.3。终末地主题的实现位于 `app/endfield.css`、`lib/theme.ts`、`components/ThemeIcon.tsx` 和三份 `lib/i18n/messages` 语言包。Windows 模型保存修复位于 `lib/atomic-file-async.ts`、`lib/models-config-store.ts` 和 `app/api/models-config/route.ts`。两项改动都在源码中，不依赖修改 `.next` 文件。

终末地主题通过 CSS 使用本机已安装的 `Maple Mono CN` 界面字体和 `JetBrains Mono NL` 代码字体，不再随安装包附带字体文件。换机器运行时，需要先安装对应字体；检查字体是否生效，应读取实际渲染字体，不能只看 CSS 的 `font-family` 候选名称。

`piweb` 命令由 `C:\Users\JUSTLIKEZYP\.local\bin\piweb.ps1` 启动本目录的生产构建。启动脚本核对 30141 端口上 Next.js 子进程和 Pi Web 父进程的路径，避免悄悄连接到全局 npm 安装版。源码目录必须保持在当前路径。

升级上游时，先将更新合入本地分支，核对上述主题与保存逻辑。确认没有运行中的 Pi 会话后停止服务，再执行：

```powershell
npm ci
npm run lint
npx tsc --noEmit
node --experimental-strip-types --test lib/theme.test.mjs components/SettingsPanel.test.mjs lib/models-config-store.test.mjs lib/atomic-file-async.test.mjs
npm run build
piweb
$env:PLAYWRIGHT_CHROME_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node e2e/themes.mjs
node e2e/models-config-loading.mjs
```

浏览器端再确认终末地选择、刷新后恢复和模型界面保存回读。不要在正在运行的生产服务目录里执行 `next build`；先停止服务，以免读到半更新的 `.next` 资源。旧的 `D:\workself\daily\endfield-theme\patch.mjs` 只保留为历史参考，不再执行。
