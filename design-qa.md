# Clear Horizon 设计与运行 QA

日期：2026-09-11。用户已选择第三版，并授权保留全部功能、重组布局和入口。

final result: passed

此结论限定于下列 20 个界面状态的视觉与已执行交互检查，不等于所有模型、安装、文件类型和会话运行流程均已验收。全量自动测试仍有 9 项失败，见文末。

## 来源、视口与比较证据

视觉来源：[选定的第三版](docs/ui-redesign-2026-09-11/concepts/03-clear-horizon.png)，以及在实施前生成的 20 张逐页图。产品功能基准：[现状文档](docs/ui-baseline-2026-09-11/README.md)。实现由本机实际开发服务 http://127.0.0.1:30141/ 在用户指定的右侧浏览器中渲染。

实际截图的像素尺寸与 CSS 视口一致，截图密度为 1。参考图为 Image Gen 返回的高分辨率图片，不据此推断浏览器 DPR；使用 sharp 的 contain 按目标 CSS 画布等比例缩放，白边补齐，不拉伸、不裁切。06 原图比例不同，归一化后保留两侧留白。桌面并排图为 2560×720，手机为 780×844；左侧参考、右侧实现。逐项尺寸同时保存在 [dimensions.json](docs/ui-redesign-2026-09-11/qa-comparisons/dimensions.json)。

| 状态 | 参考图与原始像素 | 实际截图与像素 | CSS 视口 | 完整比较证据 |
|---|---|---|---|---|
| 01 未选择项目的首页 | [参考](docs/ui-redesign-2026-09-11/screens/01-home.png) 1672×941 | [实装](docs/ui-redesign-2026-09-11/implemented/01-home.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/01-home.png) |
| 02 常规设置、系统主题、简体中文 | [参考](docs/ui-redesign-2026-09-11/screens/02-settings-general.png) 1681×936 | [实装](docs/ui-redesign-2026-09-11/implemented/02-settings-general.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/02-settings-general.png) |
| 03 无模型配置 | [参考](docs/ui-redesign-2026-09-11/screens/03-models-empty.png) 1672×941 | [实装](docs/ui-redesign-2026-09-11/implemented/03-models-empty.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/03-models-empty.png) |
| 04 供应商选择 | [参考](docs/ui-redesign-2026-09-11/screens/04-provider-picker.png) 1672×941 | [实装](docs/ui-redesign-2026-09-11/implemented/04-provider-picker.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/04-provider-picker.png) |
| 05 项目选择 | [参考](docs/ui-redesign-2026-09-11/screens/05-project-picker.png) 1672×941 | [实装](docs/ui-redesign-2026-09-11/implemented/05-project-picker.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/05-project-picker.png) |
| 06 目录选择 | [参考](docs/ui-redesign-2026-09-11/screens/06-directory-picker.png) 1402×1122 | [实装](docs/ui-redesign-2026-09-11/implemented/06-directory-picker.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/06-directory-picker.png) |
| 07 已选项目、空会话 | [参考](docs/ui-redesign-2026-09-11/screens/07-workspace.png) 1672×941 | [实装](docs/ui-redesign-2026-09-11/implemented/07-workspace.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/07-workspace.png) |
| 08 worktree列表 | [参考](docs/ui-redesign-2026-09-11/screens/08-worktrees.png) 1672×941 | [实装](docs/ui-redesign-2026-09-11/implemented/08-worktrees.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/08-worktrees.png) |
| 09 worktree创建表单 | [参考](docs/ui-redesign-2026-09-11/screens/09-worktree-create.png) 1672×941 | [实装](docs/ui-redesign-2026-09-11/implemented/09-worktree-create.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/09-worktree-create.png) |
| 10 推理级别菜单 | [参考](docs/ui-redesign-2026-09-11/screens/10-thinking.png) 1672×941 | [实装](docs/ui-redesign-2026-09-11/implemented/10-thinking.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/10-thinking.png) |
| 11 工具预设菜单 | [参考](docs/ui-redesign-2026-09-11/screens/11-tool-presets.png) 1672×941 | [实装](docs/ui-redesign-2026-09-11/implemented/11-tool-presets.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/11-tool-presets.png) |
| 12 README Markdown预览 | [参考](docs/ui-redesign-2026-09-11/screens/12-markdown-preview.png) 1672×941 | [实装](docs/ui-redesign-2026-09-11/implemented/12-markdown-preview.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/12-markdown-preview.png) |
| 13 README源码 | [参考](docs/ui-redesign-2026-09-11/screens/13-source.png) 1672×941 | [实装](docs/ui-redesign-2026-09-11/implemented/13-source.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/13-source.png) |
| 14 技能空列表 | [参考](docs/ui-redesign-2026-09-11/screens/14-skills.png) 1672×941 | [实装](docs/ui-redesign-2026-09-11/implemented/14-skills.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/14-skills.png) |
| 15 技能添加表单 | [参考](docs/ui-redesign-2026-09-11/screens/15-skill-add.png) 1672×941 | [实装](docs/ui-redesign-2026-09-11/implemented/15-skill-add.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/15-skill-add.png) |
| 16 插件添加表单 | [参考](docs/ui-redesign-2026-09-11/screens/16-plugins.png) 1672×941 | [实装](docs/ui-redesign-2026-09-11/implemented/16-plugins.jpg) 1280×720 | 1280×720 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/16-plugins.png) |
| 17 手机插件设置 | [参考](docs/ui-redesign-2026-09-11/screens/17-mobile-settings.png) 853×1844 | [实装](docs/ui-redesign-2026-09-11/implemented/17-mobile-settings.jpg) 390×844 | 390×844 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/17-mobile-settings.png) |
| 18 手机源码 | [参考](docs/ui-redesign-2026-09-11/screens/18-mobile-file.png) 853×1844 | [实装](docs/ui-redesign-2026-09-11/implemented/18-mobile-file.jpg) 390×844 | 390×844 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/18-mobile-file.png) |
| 19 手机空会话输入区 | [参考](docs/ui-redesign-2026-09-11/screens/19-mobile-chat.png) 853×1844 | [实装](docs/ui-redesign-2026-09-11/implemented/19-mobile-chat.jpg) 390×844 | 390×844 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/19-mobile-chat.png) |
| 20 手机顶部菜单展开 | [参考](docs/ui-redesign-2026-09-11/screens/20-mobile-toolbar.png) 853×1844 | [实装](docs/ui-redesign-2026-09-11/implemented/20-mobile-toolbar.jpg) 390×844 | 390×844 | [并排](docs/ui-redesign-2026-09-11/qa-comparisons/20-mobile-toolbar.png) |

完整视图逐项核查，手机比较图以 390px 单列原始尺寸观察，桌面同时打开实际 1280px 截图核查文字和控件。本轮问题涉及整栏宽度、固定菜单位置和页面底部可见性，完整视图比局部裁切更能说明问题，未额外导出局部裁切。额外证据：[手机 worktree](docs/ui-redesign-2026-09-11/implemented/extra-mobile-worktree.jpg)、[手机侧栏](docs/ui-redesign-2026-09-11/implemented/extra-mobile-sidebar.jpg)、[深色源码](docs/ui-redesign-2026-09-11/implemented/extra-dark-source.jpg)、[深色设置](docs/ui-redesign-2026-09-11/implemented/extra-dark-settings.jpg)。

## 比较过程、发现与修复

| 轮次 / 级别 | 发现及影响 | 修改 | 修复后证据 |
|---|---|---|---|
| 初轮 P2 | 顶栏项目上下文、输入框和设置字号未形成第三版的统一层次 | 共享颜色与尺寸令牌；顶栏复用项目/worktree唯一状态；输入框整合；设置统一排版 | 01–17 的最终并排图 |
| 复核 P2 | 390px 手机侧栏上方操作被顶栏覆盖 | 手机顶栏层级降至侧栏之下 | extra-mobile-sidebar.jpg，新建和刷新完整可见 |
| 复核 P2 | 手机 worktree 下拉框超出视口 | 手机菜单固定在左右12px边界内 | extra-mobile-worktree.jpg |
| 复核 P2 | 三栏时文件区默认比例过大，聊天工具栏拥挤 | 文件默认宽度从视口42%调整为34%，保留最小/最大宽度与拖动持久化；文件打开时输入区靠下 | 12、13，新增1280px聊天可用宽度检查 |
| 复核 P2 | 常规设置底部语言选项被首屏高度挤压 | 收紧章节间距与标题留白 | 02，最后语言选项底部约637px，小于720px |
| 交互复核 P2 | 源码挂载后切换浅/深主题，Prism主题混用background/backgroundColor导致React警告 | 明确移除高亮器背景简写，统一backgroundColor；补1项回归测试 | 13及extra-dark-source.jpg；完整系统→浅色→深色→系统循环后无新增错误 |
| 截图复核 | 旧20图底部输入区缺失，旧12图仍是Source，17误选常规 | 独立执行菜单/预览动作，等待稳定后核对状态再截图；并非确认的产品回归 | 12 Preview aria-pressed=true；17插件状态；20输入容器top664、bottom832，844px视口内完整显示 |
| 开发环境 P2 | Next开发角标覆盖手机输入区“更多控件” | 仅使用开发工具Preferences的“Hide Dev Tools for this session”，未修改应用配置 | 19、20最终截图，产品控件全部可见；重启开发服务后角标可能恢复 |

最终比较未发现仍需修复的 P0/P1/P2 视觉问题。设计中的错误功能内容依照预先记录的规则纠正，属于下面列出的实施取舍。

## 有意保留的差异

- 参考图的假版本、Ctrl K 新建提示、空会话选择行、重复模型入口、虚构编辑器入口未进入产品。
- README 显示真实文件内容，因此预览中包含真实图片和链接，与生成图的示例正文不同；源码保留真实行号、语法配色和可横向滚动的长行。
- 文件区保留现有多文件标签与文件状态信息；Source/Preview/Diff 沿用现有名称。为保证真实操作可见，三栏时输入工具栏可换行。
- 手机设置复用原有原生选择器切换类别，未改为图片中的四标签导航；安装操作与范围按钮相邻，保留完整表单和底部刷新区域。
- 供应商使用真实目录，文件列表使用真实项目，未删减项目条目来模仿图片。无模型时显示配置入口，发送按钮禁用。
- 深色主题使用现有语义颜色体系。此次第三版主要视觉目标为浅色，同时检查系统/深色切换。

## 实际交互与控制台检查

- 项目入口、目录选择、worktree列表与创建表单、关闭/返回、空字段禁用。
- 设置类别切换、外观切换、模型供应商选择、技能添加、插件来源及范围按钮。
- 推理/工具菜单、手机更多控件、手机侧栏及顶部操作菜单。
- 文件打开、Source/Preview切换、代码显示、文件面板开关；桌面和手机页面宽度分别等于1280与390，没有页面级横向溢出。
- 原有模型保存逻辑补充修改后可保存、撤销后禁用、删除最后一项仍可保存及保存过程中后续编辑不丢失的相关验证。
- 控制台曾在13:52 UTC记录两条背景属性冲突；修复后重复主题循环与后续页面操作没有新增error。日志保留旧错误记录，不能将旧记录描述成新错误。HMR编辑期间出现过Fast Refresh重新加载提示。

## 自动验证与限制

- `npx tsc --noEmit`：通过。
- `npm run lint`：通过。文档生成脚本已改用ES模块，未忽略规则。[日志](docs/ui-redesign-2026-09-11/lint-results.txt)。
- `node --experimental-strip-types --test "components/**/*.test.mjs" lib/panel-layout.test.mjs lib/i18n/*.test.mjs lib/settings-navigation.test.mjs`：**242通过、0失败**。[日志](docs/ui-redesign-2026-09-11/ui-test-results.txt)。
- `git diff --check`：通过；Git有正常的LF/CRLF工作副本提示。
- `npm test`：最后新增1项主题回归测试前运行，**850总计 / 837通过 / 9失败 / 4跳过**。[完整日志](docs/ui-redesign-2026-09-11/test-results.txt)。未为美化结果修改或跳过失败测试。
- 遵循AGENTS.md，开发期间不运行next build，没有生产构建验收。

全量测试遗留失败：

| 数量 | 文件/测试范围 | 已观察到的原因 |
|---|---|---|
| 3 | hooks中的System/Tools惰性启动、新消息滚动、脱离底部后结束流式滚动的源码结构测试 | CRLF下固定LF字符串截取结果为空，断言未取得目标源码 |
| 2 | 目录符号链接、subagent-input越界符号链接 | Windows创建符号链接返回EPERM |
| 3 | project-command-env的agent/direct Bash运行测试 | 当前环境找不到Bash |
| 1 | project-command-env的PATH测试 | 实际冒号与Windows期望分号不一致 |

以上失败相关实现未由本次界面改造修改。完整测试未通过是本轮验证的明确限制，不能据此声称所有功能端到端通过。

缺少可用模型凭据，真实发送、停止、流式响应、OAuth/API Key联网、模型测试、技能/插件安装没有实际运行。未执行创建/删除worktree等有副作用的Git操作；相关原有代码路径保留，不能替代运行验收。没有修改API、引入新框架、升级依赖、提交或推送代码。

## 后续微调

P3：可按用户反馈调整手机设置导航形式、源码配色和工具栏密度。当前不需要额外产品决策才能使用已交付界面；完整对比页可用于按01–20编号反馈。


## 技能中心五领域改造 · 2026-09-12

本节追加记录本次功能实施，不覆盖前述 20 页视觉改造历史。[技能中心视觉 QA](docs/skills-center-2026-09-12/design-qa.md) 包含 13 张参考/实现对比、390/768/1280/1440 与 200% 文字检查。[实施记录](docs/skills-center-2026-09-12/IMPLEMENTATION.md) 列出 100 项针对性测试、全量既有失败与真实 GitHub 403 限制；[71 条验收覆盖表](docs/skills-center-2026-09-12/acceptance.md) 不宣称全部端到端通过。
