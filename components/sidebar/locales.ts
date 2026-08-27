/**
 * Minimal zh/en/ja copy for the sidebar. The copy follows the DSH i18n system:
 * the client apply attaches the locale service (`ctx.locale`, provided by
 * `@deepseek-ai/dsh-client-locale`) through {@link attachLocale}, and
 * `t()`/`isZh()` resolve the active locale from it — the Host-backed
 * `locale.preference` wins over the raw browser language and switches live.
 * Without an attached service (standalone/test compositions) the browser
 * language is used, matching the previous behavior. The dictionaries are
 * also registered into the DSH locale registry under {@link LOCALE_NS}.
 *
 * ja (Japanese) is opt-in through `@huanlin/dsh-plugin-better-locale`: when
 * that plugin is installed, the client apply also calls
 * {@link attachBetterLocale} with the override store. `t()` then consults
 * the store's active override id first; if it is `'ja'` (or any id whose
 * dict has the requested key) the ja text wins, otherwise the existing
 * zh/en chain runs unchanged. better-locale itself patches
 * `LocaleRuntime.prototype.lookup` so DSH's own translate chain also
 * returns ja where the `betterSidebar` namespace has a ja entry — that
 * path covers external callers of `ctx.locale.bind('betterSidebar')`,
 * while the override-aware `t()` here covers better-sidebar's own
 * components (which bypass `ctx.locale` and call `t()` directly).
 */

/** The zh dictionary (also registered into the DSH locale registry under {@link LOCALE_NS}). */
export const zh = {
  files: '文件',
  sessions: '会话',
  explorer: '资源管理器',
  git: '源代码管理',
  terminal: '终端',
  editor: '编辑器',
  editorExplorer: '文件打开方式',
  editorExplorerDesc: '控制文件打开方式',
  editorExplorerMerged: '合并',
  editorExplorerMergedDesc: '文件在同一窗口内原地切换；新窗口默认展开文件树',
  editorExplorerSplit: '独立',
  editorExplorerSplitDesc: '无路径窗口即资源管理器（仅文件树）；文件各自新开窗口（带文件树，默认收起）',
  editorTreeToggle: '文件树面板',
  editorPathPlaceholder: '输入文件路径（相对会话目录或绝对路径），Enter 打开',
  editorSearchPlaceholder: '按文件名搜索…',
  editorSearchNoResults: '无匹配文件',
  editorSearchTruncated: '结果过多，仅显示部分匹配',
  editorEmptyHint: '从右侧文件树或上方路径输入框选择文件开始预览',
  openFileNewTab: '在新 Tab 中打开',
  openFileSide: '在侧边打开',
  openWithMenu: '在应用中打开',
  openWithSshSuffix: ' (SSH)',
  pinOpenWith: '固定到菜单',
  unpinOpenWith: '取消固定',
  openWithExplorer: '资源管理器',
  openWithVscode: 'VS Code',
  openWithCursor: 'Cursor',
  openWithZed: 'Zed',
  openWithSettingsSshTitle: 'SSH 远端主机',
  openWithSettingsSshDesc: '留空为本地工作区；填入 user@host 或 SSH 别名后，VSCode 系打开方式将改用 vscode-remote/ssh-remote 协议，资源管理器 / Zed / 非 VSCode 系自定义编辑器将从菜单隐藏',
  openWithSettingsSshPlaceholder: 'user@host 或 SSH 别名',
  openWithSettingsCustomTitle: '自定义编辑器',
  openWithSettingsCustomDesc: '名称 + URL 模板（{path} 占位符）+ 是否 VSCode 系；SSH 模式下仅 VSCode 系可打开远端',
  openWithSettingsAdd: '添加',
  openWithSettingsName: '名称',
  openWithSettingsTemplate: '如 cursor://file/{path}',
  openWithSettingsFamily: 'VSCode 系',
  openWithSettingsFamilyDesc: '该编辑器使用 VSCode 的 URL 协议（支持 SSH 远端打开）',
  openWithSettingsRemove: '删除',
  openWithSettingsInvalidHint: '名称或模板（需含 {path} 且以 scheme:// 开头）未填写的编辑器不会出现在菜单中',
  newTab: '新建标签页',
  openExplorer: '资源管理器',
  brokenSymlink: '失效的软链接',
  openGit: 'Git 面板',
  newTerminal: '新终端',
  terminalLimit: '终端数量已达上限 (3)',
  close: '关闭',
  closeOtherTabs: '关闭其他页签',
  closeLeftTabs: '关闭左侧页签',
  closeRightTabs: '关闭右侧页签',
  moveToFreeWindow: '移动到自由窗口',
  floatDropHint: '松开以在自由窗口中打开',
  dockToSidebar: '回到侧边栏',
  pinTerminal: '固定终端',
  pinAgentTerminal: '固定 Agent 终端',
  pinToWorkspace: '固定到工作区',
  pinToGlobal: '固定到全局',
  unpinTerminal: '取消固定',
  pinnedTerminalTooltip: '{kind} · {scope} · {cwd}',
  pinnedTerminalKindUi: 'UI 终端',
  pinnedTerminalKindAgent: 'Agent 终端',
  pinnedTerminalScopeWorkspace: '固定到工作区',
  pinnedTerminalScopeGlobal: '固定到全局',
  pinnedRailLabel: '固定终端',
  closePinnedTerminal: '关闭终端',
  collapse: '折叠侧边栏',
  expand: '展开侧边栏',
  collapseBottomPanel: '折叠底部面板',
  expandBottomPanel: '展开底部面板',
  terminalError: '终端连接失败',
  terminalConnectFailed: '终端多次连接失败',
  terminalRetry: '重试',
  terminalDepsFailed: '终端依赖 node-pty 加载失败',
  terminalDepsHint: '在 DSH 所在环境的终端或 cmd 中执行以下命令修复，然后点重试（node-pty 与 DSH 核心保持同一版本）：',
  terminalDepsProfile: '（检测到 profile：{profile}）',
  preview: '预览',
  toc: '目录',
  edit: '编辑',
  mermaidError: 'Mermaid 渲染失败',
  mermaidZoomIn: '放大',
  mermaidZoomOut: '缩小',
  mermaidZoomReset: '重置',
  mermaidZoomHint: '滚轮缩放 · 拖拽平移 · Esc 关闭',
  refresh: '刷新',
  refreshUnsavedConfirm: '文件已在磁盘更新，刷新将丢弃未保存编辑。继续吗？',
  save: '保存',
  saved: '已保存',
  unsaved: '未保存',
  saveFailed: '保存失败',
  truncation: '文件过大，仅显示前 512KB',
  binary: '二进制文件，无法预览',
  loading: '加载中…',
  error: '加载失败',
  retry: '重试',
  splitLeft: '向左分栏',
  splitRight: '向右分栏',
  splitUp: '向上分栏',
  splitDown: '向下分栏',
  notRepo: '当前目录不是 git 仓库',
  noChanges: '没有变更',
  statusTruncated: '变更过多，仅显示前 2000 条',
  stage: '暂存',
  unstage: '取消暂存',
  stageAll: '全部暂存',
  unstageAll: '全部取消暂存',
  commitPlaceholder: '提交信息 (Ctrl+Enter)',
  commit: '提交',
  commitError: '提交失败',
  branch: '分支',
  worktree: '工作树',
  checkoutError: '切换分支失败',
  history: '历史',
  changes: '变更',
  staged: '已暂存',
  unstaged: '未暂存',
  cancel: '取消',
  diffEmpty: '没有文本差异',
  diffLoadError: '加载差异失败',
  diffBinary: '二进制',
  diffAdded: '新增',
  diffDeleted: '删除',
  diffRenamed: '重命名',
  diffExpand: '展开其余 {count} 行',
  diffCollapse: '收起',
  discard: '放弃更改',
  discardTitle: '放弃更改',
  discardDesc: '将丢弃「{path}」的工作区修改（不可恢复）。',
  viewCommitDiff: '查看提交差异',
  copyShortHash: '复制短哈希',
  copyFullHash: '复制完整哈希',
  copySubject: '复制提交信息',
  revertCommit: '还原此提交',
  revertTitle: '还原此提交',
  revertDesc: '将在当前分支创建一个反转「{subject}」的新提交。',
  cherryPickCommit: '捡取此提交',
  cherryPickTitle: '捡取此提交',
  cherryPickDesc: '将「{subject}」的更改应用到当前分支。',
  timeJustNow: '刚刚',
  timeMinutesAgo: '{n} 分钟前',
  timeHoursAgo: '{n} 小时前',
  timeYesterday: '昨天',
  loadMore: '加载更多',
  historyLoadError: '加载更多历史失败',
  produced: '本次产出',
  producedOpen: '在侧边栏中打开',
  showInFolder: '在文件夹中显示',
  disconnected: '终端连接断开，重连中…',
  exited: '终端进程已退出',
  noSession: '选择一个会话以使用侧边栏',
  pluginNotLoaded: '插件未加载，标签页暂不可用：',
  hiddenFiles: '隐藏文件',
  parent: '上级目录',
  copied: '已复制',
  copy: '复制',
  newFile: '新文件',
  openEditor: '打开编辑器',
  gitDetail: '查看变更详情',
  referenceFile: '@文件',
  addToConversation: '添加到对话',
  copyRelative: '复制相对地址',
  copyAbsolute: '复制绝对地址',
  download: '下载',
  uploadFiles: '上传文件',
  uploadFolder: '上传文件夹',
  uploadHere: '上传到此处',
  uploadDropHint: '拖拽文件/文件夹到此处上传',
  uploadDropChat: '拖放到聊天区：添加图片到对话',
  uploadTo: '上传到 {dir}',
  uploadingTo: '正在上传到 {dir}…',
  uploadProgress: '正在上传 {done}/{total}: {name}',
  uploadDone: '已上传 {count} 个文件',
  uploadFailed: '上传失败：{error}',
  uploadFailedUnknown: '未知错误',
  uploadTooLarge: '文件过大，超出上传上限',
  uploadCancelled: '上传已取消',
  settingsNav: '侧边卡片',
  settingsIntro: '管理侧边卡片的显示内容与默认行为',
  settingsPopupDesc: '为「{feature}」配置相关选项',
  settingsDone: '完成',
  settingsOpenTitle: '新会话默认打开',
  settingsOpenDesc: '新建会话时自动展开侧边卡片；已存在的会话保持各自布局',
  settingsWidthTitle: '默认宽度占比',
  settingsWidthDesc: '新建会话时侧边卡片占窗口宽度的百分比 (20–60)',
  settingsWidthSuffix: '%',
  settingsOpenPathTitle: '聊天区文件在侧边栏打开',
  settingsOpenPathDesc: '在聊天里点击文件链接（工具行、产物列表、文件提及）时，在侧边栏编辑器中打开，不再调用系统默认应用',
  settingsOpenToolsTitle: '为模型注入侧边栏打开工具',
  settingsOpenToolsDesc: '开启后，模型可通过 sidebar_open 工具在侧边栏主动打开文件、文件夹和 HTTP(S) 网页（默认关闭）',
  settingsTitleBarTitle: '位置兼容模式',
  settingsTitleBarDesc: '选择顶栏兼容方案：自动检测（默认，保守）/ DSH官方Web / 已知桌面壳 / 自定义方案（下移距离 + 自定义 CSS）',
  settingsTitleBarStripTitle: '下移距离',
  settingsTitleBarStripDesc: '标题栏条带高度：侧边栏按钮与内容下移的像素数（0–120，默认 40；自定义方案下生效）',
  settingsSchemeAutoTitle: '自动检测',
  settingsSchemeAutoDesc: '保守方案：仅在 Window Controls Overlay 标准 API 可用时按真实标题栏高度让位；网页环境下不做任何修改',
  settingsSchemeWebTitle: 'DSH官方Web',
  settingsSchemeWebDesc: '显式声明运行在官方网页版：不做任何适配（连标准 WCO 几何也不适用）',
  settingsSchemeCustomTitle: '自定义方案',
  settingsSchemeCustomDesc: '完全由你控制：注入自定义 CSS（可覆盖内置样式），并指定标题栏下移距离',
  settingsSchemeDetectedSuffix: '已检测',
  settingsCustomCssTitle: '自定义 CSS',
  settingsCustomCssDesc: '追加到页面末尾的样式（同优先级下后写胜出；覆盖 JS 内联变量需用 !important）',
  settingsCustomCssPlaceholder: '/* 例：为自绘标题栏的壳预留 36px */\nhtml[data-dsh-title-bar-height="36"] {\n  --dsh-title-bar-strip: 36px !important;\n}',
  settingsSaveFailed: '保存失败',
  settingsConflict: '设置已被其他窗口修改，请重试',
  binaryNoPreview: '此文件类型不支持预览',
  downloadToView: '下载查看',
  settingsSubagentTitle: '检测到子代理时自动展开任务管理页',
  settingsSubagentDesc: '当前会话产生新的子代理时，自动展开侧边栏并打开任务管理页；关闭后需手动打开',
  settingsJobsTitle: '有新后台任务时自动展开后台任务页',
  settingsJobsDesc: '当前会话出现新的后台任务时，自动展开侧边栏并打开后台任务页（每个新任务都会触发）；关闭后需手动打开',
  settingsToolsTitle: '为模型注入终端工具',
  settingsToolsDesc: '开启后，模型可通过 terminal_create 等 8 个工具创建并操作侧边栏终端（默认关闭）',
  settingsBottomTerminalTitle: '底部面板首次展开自动开终端',
  settingsBottomTerminalDesc: '每次会话中第一次展开底部面板时，尝试在底部面板自动打开一个新终端标签（终端数量上限仍会限制；默认开启）',
  settingsFontFamilyTitle: '终端字体',
  settingsFontFamilyDesc: '自定义终端字体族（CSS font-family，如 "JetBrains Mono", monospace；留空跟随主题等宽字体）',
  settingsFontFamilyPlaceholder: '"JetBrains Mono", monospace',
  settingsFontSizeTitle: '终端字号',
  settingsFontSizeDesc: '终端字号（9–32，默认 13）',
  settingsFontSizeSuffix: 'px',
  settingsShellTitle: 'Shell 路径',
  settingsShellDesc: 'UI 与模型终端启动的 shell（绝对路径或可执行名）。留空按既有顺序解析：yaml 的 config.shell → $SHELL / 登录 shell / Windows 的 powershell.exe。对之后打开的终端生效',
  settingsShellPlaceholder: '如 /bin/zsh（留空自动解析）',
  settingsShellArgsTitle: 'Shell 参数',
  settingsShellArgsDesc: '显式 shell 启动参数，空格分隔；非空时完全替换默认参数（与 yaml 的 shellArgs 契约一致）',
  settingsShellArgsPlaceholder: '如 -l（留空用默认参数）',
  settingsTabsTitle: '侧边栏内容',
  settingsViewersTitle: '文件预览',
  settingsGeneralTitle: '常规',
  settingsPopup: '功能设置',
  settingsViewerCatchAll: '兜底：任意文件',
  viewerImage: '图片',
  viewerPdf: 'PDF',
  viewerMarkdown: 'Markdown',
  viewerCode: '代码',
  viewerBinary: '二进制下载',
  viewerHtml: 'HTML',
  browser: '浏览器',
  browserPlaceholder: '输入网址，例如 example.com',
  browserGo: '前往',
  browserBack: '后退',
  browserForward: '前进',
  browserStart: '输入网址开始浏览（沙箱模式）',
  browserBlockedScheme: '已阻止：仅支持 http/https 链接',
  browserBlockedLoopback: '已阻止：不允许在浏览器中访问本机或内部地址',
  browserInvalid: '无效的网址',
  browserNoSandboxWarning: '沙箱已关闭：当前页面与界面同源，拥有完整会话权限（可在设置中恢复）',
  htmlNoSandboxWarning: '沙箱已关闭：此 HTML 与界面同源，可读取会话文件与内部接口（可在设置中恢复）',
  sandboxStatusOn: '沙箱模式：已启用 · 页面无法访问界面数据与本地文件，登录态与第三方 Cookie 可能不可用',
  sandboxUnlock: '临时解锁（不安全）',
  sandboxRestore: '恢复沙箱',
  settingsHtmlDefaultUnsafeTitle: 'HTML 预览默认以非沙箱模式打开（不安全）',
  settingsHtmlDefaultUnsafeDesc: '开启后，每次打开 HTML 文件时预览默认处于非沙箱状态（与界面同源，可读取会话文件与内部接口）；可在状态行临时恢复沙箱',
  settingsHtmlSandboxTitle: '关闭 HTML 预览沙箱（不安全）',
  settingsHtmlSandboxDesc: '关闭后，预览的 HTML 将与界面同源运行，可读取会话文件、本地存储并调用内部接口。仅对完全可信的文件开启',
  settingsBrowserSandboxTitle: '关闭浏览器沙箱（不安全）',
  settingsBrowserSandboxDesc: '关闭后，访问的任何网站都将与界面同源运行，可读取会话数据并冒充你的登录状态。仅对完全可信的站点开启',
  settingsBrowserLinksTitle: '聊天区外链在侧边栏打开',
  settingsBrowserLinksDesc: '开启后，点击聊天或界面中的外链时在侧边栏打开，不再弹出新窗口；HTTP 与 HTTPS 可分别通过下方开关控制；Ctrl/Cmd 点击可临时放行',
  settingsBrowserHttpTitle: '侧边打开HTTP网页',
  settingsBrowserHttpDesc: '开启后，点击聊天或界面中的 HTTP 外链时在侧边栏打开（声明了 urlTarget 的插件页面优先）；Ctrl/Cmd 点击可临时放行',
  settingsBrowserHttpsTitle: '侧边打开HTTPS网页',
  settingsBrowserHttpsDesc: '开启后，点击聊天或界面中的 HTTPS 外链时在侧边栏打开。默认关闭：多数 HTTPS 站点拒绝被嵌入，走系统浏览器更顺畅',
  settingsBrowserLoopbackTitle: '允许访问的本机地址',
  settingsBrowserLoopbackDesc: '逗号分隔的本地回环地址白名单（如 localhost:5174 或 127.0.0.1:8080），侧边栏浏览器可访问这些本地服务；默认留空则本机地址全部拦截。沙箱隔离仍然生效，页面无法读取界面数据',
  settingsBrowserLoopbackPlaceholder: '例如 localhost:5174, 127.0.0.1:8080',
  browserOpenExternal: '在浏览器中打开',
  browserEmbedBlocked: '{host} 拒绝了嵌入请求',
  browserEmbedBlockedDesc: '该站点通过 X-Frame-Options / frame-ancestors 禁止在其它页面中显示，无法在侧边栏内加载。可在浏览器中直接打开',
  browserEmbedAnyway: '仍然加载',
  subagent: '任务管理',
  openSubagent: '任务管理',
  subagentMainAgent: '主代理',
  subagentEmpty: '暂无子代理',
  subagentEmptyDesc: '当前主代理派生的子代理将显示在这里',
  subagentRunning: '运行中',
  subagentInactive: '空闲',
  subagentModeOneShot: '一次性',
  subagentModeContinuable: '可续接',
  subagentCount: '{count} 个子代理',
  subagentCountRunning: '{count} 个子代理 · {running} 运行中',
  subagentDiagCorrupt: '目录损坏',
  subagentDiagUnsupported: '不支持的条目',
  subagentDiagUnavailable: '不可用',
  subagentThinking: '思考中…',
  sideChat: '侧边对话(beta)',
  sideChatNew: '新建对话',
  sideChatUntitled: '新对话',
  sideChatEmpty: '暂无侧边对话',
  sideChatEmptyDesc: '每个侧边对话是标签栏里的独立 Tab，继承当前会话的上下文运行，不会进入主会话',
  sideChatCreating: '正在创建侧边对话…',
  sideChatRetry: '重试',
  sideChatThreads: '切换线程 / 新建',
  sideChatSave: '保存为新会话',
  sideChatSaveTitle: '把该线程提升为顶层会话，出现在主会话列表中',
  sideChatSaved: '已保存为新会话',
  sideChatNoTurn: '至少完成一轮对话后才能保存',
  sideChatPendingDrop: '最后一条未完成的追问不会包含在新会话中',
  sideChatFirstPlaceholder: '输入第一个问题，已继承当前会话上下文…',
  sideChatComposerPlaceholder: '追问…',
  sideChatThinking: '正在深入…',
  sideChatThink: '思考过程',
  sideChatInjection: '已注入上下文',
  sideChatSend: '发送',
  sideChatCancel: '停止',
  sideChatCancelTitle: '中止当前回合（保留队列）',
  sideChatClose: '关闭线程',
  sideChatCloseTitle: '释放线程的 agent（历史保留）',
  sideChatError: '侧边对话出错：{message}',
  jobs: '后台任务',
  jobsCount: '{count} 个后台任务',
  jobsCountRunning: '{count} 个后台任务 · {running} 运行中',
  jobStatusRunning: '运行中',
  jobStatusStopping: '终止中',
  jobStatusCompleted: '已完成',
  jobStatusKilled: '已终止',
  jobStatusFailed: '失败',
  jobDurationSeconds: '{seconds} 秒',
  jobDurationMinutes: '{minutes} 分 {seconds} 秒',
  jobDurationHours: '{hours} 小时 {minutes} 分',
  jobViewOutput: '查看输出',
  jobHideOutput: '收起输出',
  jobNoOutput: '暂无输出',
  jobNotReadYet: '等待模型读取该任务的输出（模型执行 job_output 后，输出会显示在这里）',
  jobOutputTruncated: '输出过长，已截断显示',
  jobOutputError: '输出读取失败',
  jobKill: '终止',
  jobKillConfirm: '再次点击确认终止',
  jobKillError: '终止失败',
  addPluginsTabCard: '添加 Tab 插件',
  addPluginsTabCardDesc: '注册新的侧边栏页面',
  addPluginsViewerCard: '添加预览插件',
  addPluginsViewerCardDesc: '注册新的文件类型预览',
  addPluginsTabDesc: '侧边栏页面（Tab）可以由插件扩展。插件通过 ctx.betterSidebar 服务注册；点击「安装」复制安装命令，粘贴到 DSH 所在环境的终端执行。',
  addPluginsViewerDesc: '文件预览器可以由插件扩展。插件通过 ctx.betterSidebar 服务注册；点击「安装」复制安装命令，粘贴到 DSH 所在环境的终端执行。',
  addPluginsBrowseMore: '在 GitHub 上浏览更多插件（topic: dsh-better-sidebar）',
  addPluginsSearch: '搜索插件名称 / 描述…',
  addPluginsNoMatch: '没有匹配的插件',
  addPluginsRecommended: '推荐插件',
  addPluginsEmpty: '暂未收录插件，欢迎在 GitHub topic 下发布你的插件',
  openPlugin: '跳转',
  copyInstall: '复制安装命令',
  pluginOfficeDesc: '为 better-sidebar 编辑器提供 Office 三件套预览（.docx / .xlsx / .pptx），把重型 Office 渲染库拆出主包、按需安装',
  pluginFlowglassDesc: '实时会话流程图：三列泳道展示用户、助手与工具调用，支持并行分组、子代理支线、逐层钻取和实时状态；安装 better-sidebar 后注册原生「流镜」Tab，未安装时保留独立抽屉',
  pluginGitForgeDesc: 'better-sidebar「Git 凭据」Tab：GitHub/Gitea 等 Forge 账号库 + 按项目授权 + push 策略硬拦；token 仅存本地 secrets，不进模型上下文；提供只读 GitForge 工具与 agent HTTPS credential helper',
  pluginGitRemotesDesc: 'better-sidebar Git 远程 Tab：看分支/上游/ahead-behind，fetch（可 prune）、ff-only pull、确认后才 push。不替换内置 Git 的暂存/提交，也不提供 force-push 或模型自动推送',
  pluginSentinelDesc: '条件驱动的 agent 唤醒系统：文件/进程/端口/HTTP/命令/webhook 传感器，条件达成自动唤醒休眠会话；注册「哨兵」Tab 展示服务器全局监控表',
  pluginSidebarQaDesc: '基于 better-sidebar 的划选提问tab分页: 对话划选 → 右侧面板提问 → 同工作区独立追问会话（❓追问·主题）：快速无思考模型压缩主对话上下文后与引文一起注入，不打断主对话；追问可嵌套、可继续、可归档',
  pluginSshTunnelDesc: 'better-sidebar「SSH 隧道」Tab：多机主机清单 + 按项目授权 + 密钥本地保管；模型工具 SSHManager（exec/SFTP/会话策略）；中央交互终端与双栏 SFTP',
  pluginTurnReviewDesc: '对「刚刚这一回合」的 diff 做 Approve / Request changes 的人闸门：只审上一回合，不 fork 会话；文件按主会话/子代理/未归因分组，按文件勾选打回 + 可选评语，点文件先看回合开始快照 vs 现在的 diff。不是 /rewind',
  pluginVideoPreviewDesc: '在 better-sidebar 编辑器内联预览视频文件（.mp4/.webm/.mov/.mkv/.avi 等），自带支持 HTTP Range（206）的 /video 宿主路由，可拖动进度条、不受 20MB mediaLimit 限制',
  pluginDocsPanelDesc: 'DSH 侧边栏里的「全局文档」：全局 Markdown 笔记，任何工作区随时可读——列表点选阅读、悬浮大纲跳转、Chrome / VS Code 外部打开、代码复制，目录可配置（默认 ~/.dsh/docs）',
  pluginEgoBrowserDesc: '把 CitroLabs/ego-lite 接进 DeepSeek Harness 的 agent 浏览器：32 个 ego_* 工具驱动真实 Chromium，侧边栏原生「ego 浏览器」Tab 实时观察 agent 逛的每个页面，可直接点击/拖拽/输入接管；装 better-sidebar 时自动注册 Tab，没装则退回浮动浮窗',
}

/** The en dictionary (key-set-equal to zh, enforced by the type annotation). */
export const en: Record<keyof typeof zh, string> = {
  files: 'Files',
  sessions: 'Sessions',
  explorer: 'Explorer',
  git: 'Source Control',
  terminal: 'Terminal',
  editor: 'Editor',
  editorExplorer: 'File open behavior',
  editorExplorerDesc: 'Controls how files open',
  editorExplorerMerged: 'Merged',
  editorExplorerMergedDesc: 'Files switch in place in the same window; new windows start with the tree open',
  editorExplorerSplit: 'Separate',
  editorExplorerSplitDesc: 'Path-less windows are the standalone explorer (tree only); each file opens its own window (tree docked, closed by default)',
  editorTreeToggle: 'File tree panel',
  editorPathPlaceholder: 'File path (relative to the session directory or absolute), Enter to open',
  editorSearchPlaceholder: 'Search files by name…',
  editorSearchNoResults: 'No matching files',
  editorSearchTruncated: 'Too many results — showing a partial list',
  editorEmptyHint: 'Pick a file from the tree panel or the path input above to start previewing',
  openFileNewTab: 'Open in New Tab',
  openFileSide: 'Open to the Side',
  openWithMenu: 'Open with',
  openWithSshSuffix: ' (SSH)',
  pinOpenWith: 'Pin to menu',
  unpinOpenWith: 'Unpin',
  openWithExplorer: 'File Manager',
  openWithVscode: 'VS Code',
  openWithCursor: 'Cursor',
  openWithZed: 'Zed',
  openWithSettingsSshTitle: 'SSH remote host',
  openWithSettingsSshDesc: 'Empty = local workspace; with a user@host or SSH alias, VSCode-family openers switch to the vscode-remote/ssh-remote protocol and the File Manager / Zed / non-VSCode-family custom editors are hidden from the menu',
  openWithSettingsSshPlaceholder: 'user@host or SSH alias',
  openWithSettingsCustomTitle: 'Custom editors',
  openWithSettingsCustomDesc: 'Name + URL template ({path} placeholder) + VSCode-family flag; in remote mode only VSCode-family editors can open a remote path',
  openWithSettingsAdd: 'Add',
  openWithSettingsName: 'Name',
  openWithSettingsTemplate: 'e.g. cursor://file/{path}',
  openWithSettingsFamily: 'VSCode-family',
  openWithSettingsFamilyDesc: 'This editor speaks the VSCode URL dialect (supports SSH-remote opens)',
  openWithSettingsRemove: 'Remove',
  openWithSettingsInvalidHint: 'Editors with a missing name or a template without {path} / scheme:// are not shown in the menu',
  newTab: 'New tab',
  openExplorer: 'Explorer',
  brokenSymlink: 'Broken symlink',
  openGit: 'Git panel',
  newTerminal: 'New terminal',
  terminalLimit: 'Terminal limit reached (3)',
  close: 'Close',
  closeOtherTabs: 'Close Other Tabs',
  closeLeftTabs: 'Close Tabs to the Left',
  closeRightTabs: 'Close Tabs to the Right',
  moveToFreeWindow: 'Move to Free Window',
  floatDropHint: 'Release to open in a free window',
  dockToSidebar: 'Dock Back to Sidebar',
  pinTerminal: 'Pin Terminal',
  pinAgentTerminal: 'Pin Agent Terminal',
  pinToWorkspace: 'Pin to Workspace',
  pinToGlobal: 'Pin Globally',
  unpinTerminal: 'Unpin',
  pinnedTerminalTooltip: '{kind} · {scope} · {cwd}',
  pinnedTerminalKindUi: 'UI Terminal',
  pinnedTerminalKindAgent: 'Agent Terminal',
  pinnedTerminalScopeWorkspace: 'Pinned to workspace',
  pinnedTerminalScopeGlobal: 'Pinned globally',
  pinnedRailLabel: 'Pinned Terminals',
  closePinnedTerminal: 'Close Terminal',
  collapse: 'Collapse sidebar',
  expand: 'Expand sidebar',
  collapseBottomPanel: 'Collapse bottom panel',
  expandBottomPanel: 'Expand bottom panel',
  terminalError: 'Terminal connection failed',
  terminalConnectFailed: 'Terminal failed to connect repeatedly',
  terminalRetry: 'Retry',
  terminalDepsFailed: 'Terminal dependency node-pty failed to load',
  terminalDepsHint: 'Run the command below in a terminal or cmd on the DSH machine to repair it, then retry (node-pty stays in sync with the DSH core version):',
  terminalDepsProfile: ' (detected profile: {profile})',
  preview: 'Preview',
  toc: 'Table of contents',
  edit: 'Edit',
  mermaidError: 'Mermaid render failed',
  mermaidZoomIn: 'Zoom in',
  mermaidZoomOut: 'Zoom out',
  mermaidZoomReset: 'Reset',
  mermaidZoomHint: 'Scroll to zoom · drag to pan · Esc to close',
  refresh: 'Refresh',
  refreshUnsavedConfirm: 'The file changed on disk. Refreshing will discard unsaved edits. Continue?',
  save: 'Save',
  saved: 'Saved',
  unsaved: 'Unsaved',
  saveFailed: 'Save failed',
  truncation: 'File too large — showing the first 512KB',
  binary: 'Binary file, preview unavailable',
  loading: 'Loading…',
  error: 'Failed to load',
  retry: 'Retry',
  splitLeft: 'Split left',
  splitRight: 'Split right',
  splitUp: 'Split up',
  splitDown: 'Split down',
  notRepo: 'This directory is not a git repository',
  noChanges: 'No changes',
  statusTruncated: 'Too many changes; showing the first 2,000 entries',
  stage: 'Stage',
  unstage: 'Unstage',
  stageAll: 'Stage all',
  unstageAll: 'Unstage all',
  commitPlaceholder: 'Commit message (Ctrl+Enter)',
  commit: 'Commit',
  commitError: 'Commit failed',
  branch: 'Branch',
  worktree: 'Worktree',
  checkoutError: 'Branch switch failed',
  history: 'History',
  changes: 'Changes',
  staged: 'Staged',
  unstaged: 'Unstaged',
  cancel: 'Cancel',
  diffEmpty: 'No text changes',
  diffLoadError: 'Failed to load diff',
  diffBinary: 'Binary',
  diffAdded: 'Added',
  diffDeleted: 'Deleted',
  diffRenamed: 'Renamed',
  diffExpand: 'Expand {count} more rows',
  diffCollapse: 'Collapse',
  discard: 'Discard changes',
  discardTitle: 'Discard changes',
  discardDesc: 'This discards the worktree changes of "{path}" (not recoverable).',
  viewCommitDiff: 'View commit diff',
  copyShortHash: 'Copy short hash',
  copyFullHash: 'Copy full hash',
  copySubject: 'Copy subject',
  revertCommit: 'Revert commit',
  revertTitle: 'Revert commit',
  revertDesc: 'Create a new commit on the current branch that reverts "{subject}".',
  cherryPickCommit: 'Cherry-pick commit',
  cherryPickTitle: 'Cherry-pick commit',
  cherryPickDesc: 'Apply the changes of "{subject}" to the current branch.',
  timeJustNow: 'just now',
  timeMinutesAgo: '{n} min ago',
  timeHoursAgo: '{n} h ago',
  timeYesterday: 'yesterday',
  loadMore: 'Load more',
  historyLoadError: 'Failed to load more history',
  produced: 'Produced',
  producedOpen: 'Open in sidebar',
  showInFolder: 'Show in folder',
  disconnected: 'Terminal disconnected, reconnecting…',
  exited: 'Terminal process exited',
  noSession: 'Select a conversation to use the sidebar',
  pluginNotLoaded: 'Plugin not loaded; tab unavailable:',
  hiddenFiles: 'Hidden files',
  parent: 'Parent directory',
  copied: 'Copied',
  copy: 'Copy',
  newFile: 'New file',
  openEditor: 'Open editor',
  gitDetail: 'View change details',
  referenceFile: '@file',
  addToConversation: 'Add to conversation',
  copyRelative: 'Copy relative path',
  copyAbsolute: 'Copy absolute path',
  download: 'Download',
  uploadFiles: 'Upload files',
  uploadFolder: 'Upload folder',
  uploadHere: 'Upload here',
  uploadDropHint: 'Drop files/folders here to upload',
  uploadDropChat: 'Drop onto the chat to add images',
  uploadTo: 'Upload into {dir}',
  uploadingTo: 'Uploading into {dir}…',
  uploadProgress: 'Uploading {done}/{total}: {name}',
  uploadDone: 'Uploaded {count} file(s)',
  uploadFailed: 'Upload failed: {error}',
  uploadFailedUnknown: 'Unknown error',
  uploadTooLarge: 'File too large (over the upload limit)',
  uploadCancelled: 'Upload cancelled',
  settingsNav: 'Side card',
  settingsIntro: 'Manage what the side card shows and how it behaves',
  settingsPopupDesc: 'Configure related options for {feature}',
  settingsDone: 'Done',
  settingsOpenTitle: 'Open by default for new conversations',
  settingsOpenDesc: 'Expand the side card automatically for brand-new conversations; existing conversations keep their own layouts',
  settingsWidthTitle: 'Default width share',
  settingsWidthDesc: 'The side card\'s default share of the window width for new conversations (20–60)',
  settingsWidthSuffix: '%',
  settingsOpenPathTitle: 'Open chat files in the sidebar',
  settingsOpenPathDesc: 'Open file links in the chat (tool rows, produced files, mentions) in the sidebar editor instead of the system default app',
  settingsOpenToolsTitle: 'Inject the sidebar-open tool for the model',
  settingsOpenToolsDesc: 'When enabled, the model can actively open files, folders, and HTTP(S) pages in the sidebar through the sidebar_open tool (off by default)',
  settingsTitleBarTitle: 'Position compatibility mode',
  settingsTitleBarDesc: 'Pick the title-bar compatibility scheme: auto-detect (default, conservative) / DSH official web / known desktop shells / custom (shift distance + custom CSS)',
  settingsTitleBarStripTitle: 'Shift distance',
  settingsTitleBarStripDesc: 'Title-bar strip height: how far the sidebar buttons and content move down in px (0–120, default 40; applies under the custom scheme)',
  settingsSchemeAutoTitle: 'Auto-detect',
  settingsSchemeAutoDesc: 'Conservative: only the standard Window Controls Overlay API contributes (real caption-overlay height); plain web environments get no modification',
  settingsSchemeWebTitle: 'DSH official web',
  settingsSchemeWebDesc: 'Explicitly declare the official web UI: no adaptation at all (not even standard WCO geometry)',
  settingsSchemeCustomTitle: 'Custom',
  settingsSchemeCustomDesc: 'Full control: inject custom CSS (can override built-in styles) and set the title-bar shift distance',
  settingsSchemeDetectedSuffix: 'detected',
  settingsCustomCssTitle: 'Custom CSS',
  settingsCustomCssDesc: 'Styles appended at the end of the page (later in the cascade wins ties; use !important to override JS-written inline variables)',
  settingsCustomCssPlaceholder: '/* e.g. reserve 36px for a shell with a custom-drawn title bar */\nhtml[data-dsh-title-bar-height="36"] {\n  --dsh-title-bar-strip: 36px !important;\n}',
  settingsSaveFailed: 'Failed to save',
  settingsConflict: 'The setting changed in another window — please retry',
  binaryNoPreview: 'This file type cannot be previewed',
  downloadToView: 'Download to view',
  settingsSubagentTitle: 'Auto-open the Tasks page when a subagent appears',
  settingsSubagentDesc: 'Expand the side card and open the Tasks page when the current conversation spawns a new subagent; turn off to open it manually',
  settingsJobsTitle: 'Auto-open the Jobs page on a new background job',
  settingsJobsDesc: 'Expand the side card and open the Jobs page whenever a new background job appears for the current conversation (every new job triggers); turn off to open it manually',
  settingsToolsTitle: 'Inject terminal tools for the model',
  settingsToolsDesc: 'When enabled, the model can create and drive sidebar terminals through the 8 terminal_* tools (off by default)',
  settingsBottomTerminalTitle: 'Auto-open a terminal on the bottom panel\'s first expansion',
  settingsBottomTerminalDesc: 'When the bottom panel is expanded for the first time in a session, try to open a fresh terminal tab there (the terminal quota still applies; on by default)',
  settingsFontFamilyTitle: 'Terminal font family',
  settingsFontFamilyDesc: 'Custom terminal font family (a CSS font-family stack like "JetBrains Mono", monospace; leave empty to follow the theme\'s monospace font)',
  settingsFontFamilyPlaceholder: '"JetBrains Mono", monospace',
  settingsFontSizeTitle: 'Terminal font size',
  settingsShellTitle: 'Shell path',
  settingsShellDesc: 'Shell spawned for UI and model terminals (absolute path or bare executable). Empty keeps the legacy order: yaml config.shell → $SHELL / login shell / Windows powershell.exe. Applies to terminals opened afterwards',
  settingsShellPlaceholder: 'e.g. /bin/zsh (empty = auto)',
  settingsShellArgsTitle: 'Shell arguments',
  settingsShellArgsDesc: 'Explicit shell arguments, space-separated; when non-empty they fully replace the defaults (same contract as the yaml shellArgs)',
  settingsShellArgsPlaceholder: 'e.g. -l (empty = defaults)',
  settingsFontSizeDesc: 'Terminal font size in px (9–32, default 13)',
  settingsFontSizeSuffix: 'px',
  settingsTabsTitle: 'Sidebar content',
  settingsViewersTitle: 'File viewers',
  settingsGeneralTitle: 'General',
  settingsPopup: 'Feature settings',
  settingsViewerCatchAll: 'Catch-all: any file',
  viewerImage: 'Image',
  viewerPdf: 'PDF',
  viewerMarkdown: 'Markdown',
  viewerCode: 'Code',
  viewerBinary: 'Binary download',
  viewerHtml: 'HTML',
  browser: 'Browser',
  browserPlaceholder: 'Enter a URL, e.g. example.com',
  browserGo: 'Go',
  browserBack: 'Back',
  browserForward: 'Forward',
  browserStart: 'Enter a URL to start browsing (sandbox mode)',
  browserBlockedScheme: 'Blocked: only http/https URLs are allowed',
  browserBlockedLoopback: 'Blocked: local and internal addresses cannot be browsed here',
  browserInvalid: 'Invalid URL',
  browserNoSandboxWarning: 'Sandbox off: the current page runs with full GUI privileges (re-enable in settings)',
  htmlNoSandboxWarning: 'Sandbox off: this HTML runs with full GUI privileges (re-enable in settings)',
  sandboxStatusOn: 'Sandbox mode: on · pages cannot access the GUI\'s data or local files; logins and third-party cookies may not work',
  sandboxUnlock: 'Temporarily disable (unsafe)',
  sandboxRestore: 'Restore sandbox',
  settingsHtmlDefaultUnsafeTitle: 'Open HTML previews unsandboxed by default (unsafe)',
  settingsHtmlDefaultUnsafeDesc: 'When on, every newly opened HTML preview starts in the unsandboxed state (same origin as the GUI — it can read session files and internal APIs); the status row still offers a one-tap restore',
  settingsHtmlSandboxTitle: 'Disable HTML preview sandbox (unsafe)',
  settingsHtmlSandboxDesc: 'With the sandbox off, previewed HTML runs with the same origin as the GUI: it can read session files, local storage and call internal APIs. Only enable for fully trusted files',
  settingsBrowserSandboxTitle: 'Disable browser sandbox (unsafe)',
  settingsBrowserSandboxDesc: 'With the sandbox off, any visited site runs with the same origin as the GUI: it can read session data and act as your logged-in session. Only enable for fully trusted sites',
  settingsBrowserLinksTitle: 'Open chat external links in the sidebar',
  settingsBrowserLinksDesc: 'When on, clicking an external link in the chat or GUI opens the sidebar instead of a new window; HTTP and HTTPS are controlled separately by the switches below; Ctrl/Cmd+click always bypasses',
  settingsBrowserHttpTitle: 'Open HTTP pages in the sidebar',
  settingsBrowserHttpDesc: 'When on, clicking an HTTP external link in the chat or GUI opens the sidebar (plugin pages declaring urlTarget win); Ctrl/Cmd+click always bypasses',
  settingsBrowserHttpsTitle: 'Open HTTPS pages in the sidebar',
  settingsBrowserHttpsDesc: 'When on, clicking an HTTPS external link in the chat or GUI opens the sidebar. Off by default: most HTTPS sites refuse to be embedded, so the system browser is the smoother default',
  settingsBrowserLoopbackTitle: 'Allowed local addresses',
  settingsBrowserLoopbackDesc: 'Comma-separated allowlist of loopback addresses (e.g. localhost:5174 or 127.0.0.1:8080) the sidebar browser may visit; empty blocks all local addresses by default. The sandbox still applies — pages cannot read GUI data',
  settingsBrowserLoopbackPlaceholder: 'e.g. localhost:5174, 127.0.0.1:8080',
  browserOpenExternal: 'Open in browser',
  browserEmbedBlocked: '{host} refused to be embedded',
  browserEmbedBlockedDesc: 'The site forbids being displayed inside other pages (X-Frame-Options / frame-ancestors), so it cannot load in the sidebar. Open it directly in your browser instead.',
  browserEmbedAnyway: 'Load anyway',
  subagent: 'Tasks',
  openSubagent: 'Tasks',
  subagentMainAgent: 'Main agent',
  subagentEmpty: 'No subagents',
  subagentEmptyDesc: 'Subagents spawned under the main agent will appear here',
  subagentRunning: 'Running',
  subagentInactive: 'Inactive',
  subagentModeOneShot: 'One-shot',
  subagentModeContinuable: 'Continuable',
  subagentCount: '{count} subagents',
  subagentCountRunning: '{count} subagents · {running} running',
  subagentDiagCorrupt: 'Corrupt',
  subagentDiagUnsupported: 'Unsupported',
  subagentDiagUnavailable: 'Unavailable',
  subagentThinking: 'Thinking…',
  sideChat: 'Side Chat (beta)',
  sideChatNew: 'New thread',
  sideChatUntitled: 'New thread',
  sideChatEmpty: 'No side conversations',
  sideChatEmptyDesc: 'Every side conversation is its own tab in the tab strip — it inherits the current session\'s context and never enters the main conversation',
  sideChatCreating: 'Creating side conversation…',
  sideChatRetry: 'Retry',
  sideChatThreads: 'Switch thread / new',
  sideChatSave: 'Save as new session',
  sideChatSaveTitle: 'Promote this thread to a top-level session in the main session list',
  sideChatSaved: 'Saved as a new session',
  sideChatNoTurn: 'Save is available after the first completed turn',
  sideChatPendingDrop: 'The last unanswered follow-up will not be included in the saved session',
  sideChatFirstPlaceholder: 'Ask the first question — context inherited…',
  sideChatComposerPlaceholder: 'Ask a follow-up…',
  sideChatThinking: 'Deep diving…',
  sideChatThink: 'Thinking',
  sideChatInjection: 'Context injected',
  sideChatSend: 'Send',
  sideChatCancel: 'Stop',
  sideChatCancelTitle: 'Abort the running turn (queued work is kept)',
  sideChatClose: 'Close thread',
  sideChatCloseTitle: 'Release the thread\'s agent (history is kept)',
  sideChatError: 'Side Chat error: {message}',
  jobs: 'Background jobs',
  jobsCount: '{count} background jobs',
  jobsCountRunning: '{count} background jobs · {running} running',
  jobStatusRunning: 'Running',
  jobStatusStopping: 'Stopping',
  jobStatusCompleted: 'Completed',
  jobStatusKilled: 'Killed',
  jobStatusFailed: 'Failed',
  jobDurationSeconds: '{seconds}s',
  jobDurationMinutes: '{minutes}m {seconds}s',
  jobDurationHours: '{hours}h {minutes}m',
  jobViewOutput: 'View output',
  jobHideOutput: 'Hide output',
  jobNoOutput: 'No output yet',
  jobNotReadYet: 'Waiting for the model to read this job; its output appears here once the model runs job_output',
  jobOutputTruncated: 'Output truncated',
  jobOutputError: 'Failed to read output',
  jobKill: 'Kill',
  jobKillConfirm: 'Click again to confirm kill',
  jobKillError: 'Kill failed',
  addPluginsTabCard: 'Add tab plugins',
  addPluginsTabCardDesc: 'Register a new sidebar page',
  addPluginsViewerCard: 'Add preview plugins',
  addPluginsViewerCardDesc: 'Register a file-type preview',
  addPluginsTabDesc: 'Sidebar pages (tabs) can be extended by plugins. Plugins register through the ctx.betterSidebar service; clicking Install copies the install command — paste it into a terminal where your DSH profile lives and run it.',
  addPluginsViewerDesc: 'File previewers can be extended by plugins. Plugins register through the ctx.betterSidebar service; clicking Install copies the install command — paste it into a terminal where your DSH profile lives and run it.',
  addPluginsBrowseMore: 'Browse more plugins on GitHub (topic: dsh-better-sidebar)',
  addPluginsSearch: 'Search by plugin name or description…',
  addPluginsNoMatch: 'No plugins match',
  addPluginsRecommended: 'Recommended plugins',
  addPluginsEmpty: 'No plugins curated yet — publish yours under the GitHub topic',
  openPlugin: 'Open',
  copyInstall: 'Copy install command',
  pluginOfficeDesc: 'Office-suite preview (.docx / .xlsx / .pptx) for the better-sidebar editor, keeping the heavy Office render libraries out of the core bundle',
  pluginFlowglassDesc: 'Live session flowgraph with three lanes for user, assistant, and tool calls, plus parallel groups, sub-agent branches, drill-down, and live status; registers a native Flowglass tab when better-sidebar is installed and keeps its standalone drawer as a fallback',
  pluginGitForgeDesc: 'Git Forge tab: GitHub/Gitea (and other forge) account library + per-project grants + hard push policy; tokens stay in local secrets (never in model context); read-only GitForge tool and agent HTTPS credential helper',
  pluginGitRemotesDesc: 'Git Remotes tab: branch/upstream/ahead-behind, fetch (optional prune), ff-only pull, and push only after an in-tab confirm. Does not replace the built-in Git stage/commit tab, and does not offer force-push or a model auto-push tool',
  pluginSentinelDesc: 'Condition-driven agent wakeup: file/process/port/http/command/webhook sensors wake dormant sessions when conditions fire; registers a "Sentinel" tab with the server-wide watch table',
  pluginSidebarQaDesc: 'Select-and-ask: Select conversation text → ask in the right-side panel → a dedicated follow-up session (❓追问) in the same workspace; a fast no-thinking model compresses the main context and injects it with the quote, without interrupting the main conversation. Follow-ups nest, continue, and archive',
  pluginSshTunnelDesc: 'SSH Tunnel tab: multi-host inventory + per-project grants + local secrets; SSHManager tool (exec/SFTP/session strategies); center interactive terminal and dual-pane SFTP',
  pluginTurnReviewDesc: 'A human gate on the just-finished turn: Approve / Request changes per path with an optional comment; paths grouped by main session / subagent / unattributed; inline snapshot-vs-now diff before you decide. No fork, no /rewind',
  pluginVideoPreviewDesc: 'Inline video preview (.mp4/.webm/.mov/.mkv/.avi etc.) for the better-sidebar editor, backed by a dedicated /video host route with HTTP Range (206) support — scrubbing works and files are not capped by the 20MB mediaLimit',
  pluginDocsPanelDesc: 'Global docs in the DSH sidebar: read your own Markdown notes from any workspace — a file list, an outline, open in Chrome / VS Code, and copy buttons; the docs directory is configurable (default ~/.dsh/docs)',
  pluginEgoBrowserDesc: 'The agent browser for DeepSeek Harness: 32 ego_* tools drive a real Chromium, with a native sidebar "ego browser" tab giving a live view of every page the agent visits — you can click, drag, and type to take over. Registers the tab automatically when better-sidebar is present, otherwise falls back to a floating bubble',
}

/**
 * The dictionary namespace this plugin owns in the DSH locale registry
 * (`'sidebar'` is taken by DSH's own ui-sidebar, hence this distinct name).
 */
export const LOCALE_NS = 'betterSidebar'

// The ja dictionary lives in a sibling file (326 keys) so this module
// stays readable. Type-checked against the zh key set: a missing or extra
// ja key is a compile error.
import { ja as jaDict } from './locales-ja'
import { de as deDict } from './locales-de'
import { fr as frDict } from './locales-fr'
import { pt as ptDict } from './locales-pt'
import { ko as koDict } from './locales-ko'
import { ar as arDict } from './locales-ar'
import { hi as hiDict } from './locales-hi'
import { id as idDict } from './locales-id'
import { tr as trDict } from './locales-tr'
import { vi as viDict } from './locales-vi'
import { th as thDict } from './locales-th'
import { ru as ruDict } from './locales-ru'
import { it as itDict } from './locales-it'
import { nl as nlDict } from './locales-nl'
import { sv as svDict } from './locales-sv'
import { pl as plDict } from './locales-pl'
import { zhHK as zhHKDict } from './locales-zh-HK'
import { zhTW as zhTWDict } from './locales-zh-TW'
import { zhMO as zhMODict } from './locales-zh-MO'

/** The ja dictionary (key-set-equal to zh, enforced by the type annotation). */
export const ja: Record<keyof typeof zh, string> = jaDict as Record<keyof typeof zh, string>
export const de: Record<keyof typeof zh, string> = deDict as Record<keyof typeof zh, string>
export const fr: Record<keyof typeof zh, string> = frDict as Record<keyof typeof zh, string>
export const pt: Record<keyof typeof zh, string> = ptDict as Record<keyof typeof zh, string>
export const ko: Record<keyof typeof zh, string> = koDict as Record<keyof typeof zh, string>
export const ar: Record<keyof typeof zh, string> = arDict as Record<keyof typeof zh, string>
export const hi: Record<keyof typeof zh, string> = hiDict as Record<keyof typeof zh, string>
export const id: Record<keyof typeof zh, string> = idDict as Record<keyof typeof zh, string>
export const tr: Record<keyof typeof zh, string> = trDict as Record<keyof typeof zh, string>
export const vi: Record<keyof typeof zh, string> = viDict as Record<keyof typeof zh, string>
export const th: Record<keyof typeof zh, string> = thDict as Record<keyof typeof zh, string>
export const ru: Record<keyof typeof zh, string> = ruDict as Record<keyof typeof zh, string>
export const it: Record<keyof typeof zh, string> = itDict as Record<keyof typeof zh, string>
export const nl: Record<keyof typeof zh, string> = nlDict as Record<keyof typeof zh, string>
export const sv: Record<keyof typeof zh, string> = svDict as Record<keyof typeof zh, string>
export const pl: Record<keyof typeof zh, string> = plDict as Record<keyof typeof zh, string>
export const zhHK: Record<keyof typeof zh, string> = zhHKDict as Record<keyof typeof zh, string>
export const zhTW: Record<keyof typeof zh, string> = zhTWDict as Record<keyof typeof zh, string>
export const zhMO: Record<keyof typeof zh, string> = zhMODict as Record<keyof typeof zh, string>

/** The DSH locale service attached by the client apply (absent → browser detection). */
let localeService: { getSnapshot(): { active: string } } | undefined

/**
 * The better-locale override store attached by the client apply
 * (absent → no override; the zh/en chain runs). The store's `active`
 * field holds the user's chosen override id (e.g. `'ja'`); `undefined`
 * means "no override, use DSH native zh/en".
 *
 * The override only takes effect when DSH's active locale is `'en'`
 * (it borrows DSH's English slot to render a third language). While
 * DSH is on `'zh'` the override is inert — `getOverride` returns
 * `undefined` and `isOverrideActive` returns `false` — so `t()` and
 * `isZh()` fall through to the native zh/en chain unchanged.
 */
let betterLocaleStore: {
  readonly active: string | undefined
  getOverride(dshActive: string, ns: string, key: string): string | undefined
  isOverrideActive(dshActive: string): boolean
} | undefined

/**
 * Attach (or detach, with undefined) the DSH locale service. The sidebar
 * mounts its own React root outside the slot system's locale seat, so the
 * service rides this module-level holder: components keep calling the plain
 * `t()` function, and the Sidebar root's locale subscription re-renders the
 * whole tree on switches.
 */
export function attachLocale(service: { getSnapshot(): { active: string } } | undefined): void {
  localeService = service
}

/**
 * Attach (or detach, with undefined) the better-locale override store.
 * When attached with an active override, `t()` consults the store's
 * `getOverride(active, LOCALE_NS, key)` first; if it returns a string,
 * that text wins over the zh/en chain. Detaching (or the store's active
 * being `undefined`) restores the zh/en chain unchanged.
 *
 * The Sidebar root subscribes to the store separately (see Sidebar.tsx)
 * so an override change re-renders the whole tree — the locale service's
 * own revision bump (which better-locale triggers via `publish(active, true)`)
 * does NOT fire the existing `localeRevision` uSES because that snapshot
 * reads `getSnapshot().active` (unchanged) rather than `revision`.
 */
export function attachBetterLocale(store: typeof betterLocaleStore): void {
  betterLocaleStore = store
}

/**
 * The active locale id ('zh' | 'en'): the DSH locale service's snapshot when
 * attached, else the browser language.
 */
function activeLocale(): string {
  return localeService?.getSnapshot?.()?.active
    ?? (typeof navigator !== 'undefined' ? navigator.language : '')
    ?? 'en'
}

/** Translate a copy key in the active locale (zh → zh, else en). */
export type CopyKey = keyof typeof zh

/** Translate a copy key; `{name}` placeholders interpolate from `params`. */
export function t(key: CopyKey, params?: Record<string, string | number>): string {
  // 1. better-locale override (e.g. ja) wins when an override is active,
  //    DSH's active locale is 'en' (the override borrows the en slot),
  //    and the store has a translation for this (ns, key). The store's
  //    getOverride returns undefined otherwise (no override, DSH on zh,
  //    or missing key) and the zh/en chain runs.
  const dshActive = localeService?.getSnapshot?.()?.active ?? ''
  const override = betterLocaleStore?.getOverride(dshActive, LOCALE_NS, key)
  let text: string | undefined = override
  // 2. Fall back to the zh/en chain when no override matched.
  if (text === undefined) {
    const dict = activeLocale().toLowerCase().startsWith('zh') ? zh : en
    text = dict[key]
  }
  if (text === undefined) {
    // Key missing from every dict (should not happen — zh is the source of
    // truth and en/ja are checked against it). Return the key itself so the
    // UI shows something identifiable rather than `undefined`.
    text = key
  }
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

/** Whether the active locale is Chinese (used for selectors). */
export function isZh(): boolean {
  // An override is only "effectively active" when DSH is on 'en' (the
  // override borrows the en slot). While DSH is on 'zh' the override is
  // inert — the user sees native zh, so isZh() returns true. When an
  // override is effectively active, the rendered text is neither zh nor
  // en (it's ja/ko/...), so isZh() returns false to route selectors to
  // the non-zh branch (e.g. date format, pluralization).
  const dshActive = localeService?.getSnapshot?.()?.active ?? ''
  if (betterLocaleStore?.isOverrideActive(dshActive) === true) return false
  return activeLocale().toLowerCase().startsWith('zh')
}

/** Format an ISO 8601 author date relative to now (刚刚 / N 分钟前 / N 小时前 / 昨天 / date). */
export function relativeTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const seconds = Math.floor((Date.now() - then) / 1000)
  if (seconds < 60) return t('timeJustNow')
  if (seconds < 3600) return t('timeMinutesAgo', { n: Math.floor(seconds / 60) })
  if (seconds < 86400) return t('timeHoursAgo', { n: Math.floor(seconds / 3600) })
  if (seconds < 172800) return t('timeYesterday')
  const date = new Date(then)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
