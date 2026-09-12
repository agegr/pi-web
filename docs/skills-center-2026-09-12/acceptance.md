# 71 条验收覆盖记录

2026-09-12。所有功能均有实现位置；下表列出已执行的证据层级，**不声明 71/71 通过**。浏览器测试数据不替代真实 CLI；没有执行的场景明确待补。

“自动化覆盖”表示对应服务/边界断言已运行，复合用例中涉及浏览器操作的部分仍需结合视觉 QA。完整测试名与结果见 [针对性输出](implemented/targeted-tests.txt)；浏览器证据见 [视觉 QA](design-qa.md)。

| 用例 | 验收目标 | 实现位置 | 证据 / 尚待验证 |
|---|---|---|---|
| F01-A | 在项目 A 搜索后进入详情，返回时关键词、排序与结果位置保留。 | [服务](../../lib/skill-center/inventory.ts)、[页面](../../components/skill-center/SkillsCenter.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F01-B | A 的清单请求晚于切换 B 的响应完成，页面仍只展示 B 的本地状态。 | [服务](../../lib/skill-center/inventory.ts)、[页面](../../components/skill-center/SkillsCenter.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F01-C | A 安装已提交后切换 B，操作结果仍注明 A；B 卡片不能被标记为项目已安装。 | [服务](../../lib/skill-center/inventory.ts)、[页面](../../components/skill-center/SkillsCenter.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F02-A | 空白提交无网络搜索；快捷词与手动输入同词的请求语义相同。 | [服务](../../lib/skill-center/remote.ts)、[页面](../../components/skill-center/Discover.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F02-B | 快速提交 A、B，A 最后返回也不能覆盖 B。 | [服务](../../lib/skill-center/remote.ts)、[页面](../../components/skill-center/Discover.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F02-C | 上游失败且后备失败显示 error；正常空结果显示 empty，两个状态分别测试。 | [服务](../../lib/skill-center/remote.ts)、[页面](../../components/skill-center/Discover.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F03-A | 两个仓库均有 review，安装 A 不得使 B 显示已安装。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/Discover.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F03-B | 项目和全局都存在时两个标记均显示，管理入口能定位相应实例。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/Discover.tsx) | 来源身份匹配回归通过；代理浏览器已验证项目/全局两个实例的标记与精确管理定位。 |
| F03-C | 缺失安装量置尾并显示未提供，不渲染 0 或虚构排行。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/Discover.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F04-A | 远程与本地同名详情可区分内容来源和具体实例。 | [服务](../../lib/skill-center/remote.ts)、[页面](../../components/skill-center/Detail.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F04-B | 没有描述/版本/许可证，页面分别呈现缺失状态；不编造。 | [服务](../../lib/skill-center/remote.ts)、[页面](../../components/skill-center/Detail.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F04-C | 仓库内出现多个同名 SKILL.md 且不能唯一匹配时返回 ambiguous，禁止假装已解析。 | [服务](../../lib/skill-center/remote.ts)、[页面](../../components/skill-center/Detail.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F05-A | 包含 `<script>`、javascript 链接、远程图片的文档不执行/自动请求这些内容。 | [服务](../../lib/skill-center/files.ts)、[页面](../../components/skill-center/Detail.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F05-B | 路径穿越和越界链接被拒绝；正常嵌套文本可读取。 | [服务](../../lib/skill-center/files.ts)、[页面](../../components/skill-center/Detail.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F05-C | 切换文件时旧响应不能替换新文件，二进制/过大文件给明确原因。 | [服务](../../lib/skill-center/files.ts)、[页面](../../components/skill-center/Detail.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F06-A | 不同 cwd、XDG/Agent 目录配置下目标从服务器返回，页面不拼接假路径。 | [服务](../../lib/skill-center/mutations.ts)、[页面](../../components/skill-center/OperationPanel.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F06-B | 已有同实例再次打开显示管理；同名异来源不被覆盖。 | [服务](../../lib/skill-center/mutations.ts)、[页面](../../components/skill-center/OperationPanel.tsx) | 同技能详情已有管理入口；同名异来源匹配由自动化验证；真实覆盖保护仍以服务测试为证据。 |
| F06-C | 计划生成后切换 scope/cwd，确认按钮失效直到新计划返回。 | [服务](../../lib/skill-center/mutations.ts)、[页面](../../components/skill-center/OperationPanel.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F07-A | 相同 key 连续提交，只出现一个 CLI 子进程和同一 operationId。 | [服务](../../lib/skill-center/mutations.ts)、[页面](../../components/skill-center/OperationPanel.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F07-B | CLI 返回成功文字但文件不存在，不能进入 succeeded。 | [服务](../../lib/skill-center/mutations.ts)、[页面](../../components/skill-center/OperationPanel.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F07-C | 浏览器刷新后恢复原 operationId，不再次安装；成功后定位正确项目实例。 | [服务](../../lib/skill-center/mutations.ts)、[页面](../../components/skill-center/OperationPanel.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F08-A | 项目与全局有同名不同文件，保留两行，加载结果依据 SDK 诊断标注。 | [服务](../../lib/skill-center/inventory.ts) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F08-B | 两个链接指向同一文件，合并实例且保留各管理绑定；多个锁记录时检查/更新阻断，开关变更提示影响两个访问入口。 | [服务](../../lib/skill-center/inventory.ts) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F08-C | 未追踪本地技能仍可见，锁文件损坏不会把全部技能当作未安装。 | [服务](../../lib/skill-center/inventory.ts) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F09-A | 离线且已有清单时本地搜索和筛选仍可使用，旧数据带读取时间。 | [服务](../../lib/skill-center/inventory.ts)、[页面](../../components/skill-center/Manage.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F09-B | 查询、项目、隐藏三个条件按 AND，清空筛选恢复全部清单。 | [服务](../../lib/skill-center/inventory.ts)、[页面](../../components/skill-center/Manage.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F09-C | 列表按 installationId 保持行身份，重名行的开关和菜单不串行。 | [服务](../../lib/skill-center/inventory.ts)、[页面](../../components/skill-center/Manage.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F10-A | 关闭开关仅写 true，开启删除该键，其他 frontmatter 与正文不变。 | [服务](../../lib/skill-center/mutations.ts)、[页面](../../components/skill-center/Manage.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F10-B | 外部编辑后 stale revision 被拒绝，不覆盖新文件；非布尔输入返回 400。 | [服务](../../lib/skill-center/mutations.ts)、[页面](../../components/skill-center/Manage.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F10-C | 关闭后提示此设置不禁止手动调用，仅唯一已加载实例展示调用命令；不自动打断会话，共享文件显示影响范围。 | [服务](../../lib/skill-center/mutations.ts)、[页面](../../components/skill-center/Manage.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F11-A | SDK 同名冲突诊断在界面可见，不出现虚构的项目优先结论。 | [服务](../../lib/skill-center/inventory.ts)、[页面](../../components/skill-center/SkillsCenter.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F11-B | 坏锁文件错误可展开，其他正常实例可继续管理。 | [服务](../../lib/skill-center/inventory.ts)、[页面](../../components/skill-center/SkillsCenter.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F11-C | 点击处理信任只进入现有流程，不能因打开技能中心就写入信任状态。 | [服务](../../lib/skill-center/inventory.ts)、[页面](../../components/skill-center/SkillsCenter.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F12-A | 同批次含最新/可更新/不支持/失败，四种数量和状态正确。 | [服务](../../lib/skill-center/mutations.ts)、[页面](../../components/skill-center/Manage.tsx) | 代理浏览器已验证 6 项结果为 2 可更新、2 最新、1 不支持、1 失败；真实批量联网未验证。 |
| F12-B | 一项限流不让其他项被标记失败或最新；重试只重试明确选择项。 | [服务](../../lib/skill-center/mutations.ts)、[页面](../../components/skill-center/Manage.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F12-C | 检查期间实例被外部修改，旧检查结果不得触发更新。 | [服务](../../lib/skill-center/mutations.ts)、[页面](../../components/skill-center/Manage.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F13-A | 一个仓库有多个技能，更新 A 不改变 B；项目/global 实例不串写。 | [服务](../../lib/skill-center/mutations.ts) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F13-B | 更新前隐藏，更新后仍隐藏；只恢复该字段，不覆盖新正文。 | [服务](../../lib/skill-center/mutations.ts) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F13-C | 可靠基线检测到本地编辑时阻止；基线未知未确认时不可提交。 | [服务](../../lib/skill-center/mutations.ts) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F13-D | CLI 成功后源比较失败，不显示“已是最新”；本地核验失败进入待确认。 | [服务](../../lib/skill-center/mutations.ts) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F14-A | 安装中断网，恢复后查询原操作；写请求没有自动重试。 | [服务](../../lib/skill-center/journal.ts)、[页面](../../components/skill-center/OperationPanel.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F14-B | 服务重启保留待确认记录，绝不自动再次执行 CLI。 | [服务](../../lib/skill-center/journal.ts)、[页面](../../components/skill-center/OperationPanel.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F14-C | 两个窗口不同 key 同时写入，仅一项启动；另一个收到 busy。 | [服务](../../lib/skill-center/journal.ts)、[页面](../../components/skill-center/OperationPanel.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F14-D | 401 text/plain、403 JSON、非 JSON 502 都有可读错误而非页面崩溃。 | [服务](../../lib/skill-center/journal.ts)、[页面](../../components/skill-center/OperationPanel.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F15-A | 无 cwd 可浏览和安装全局；项目安装无法提交。 | [服务](../../lib/skill-center/inventory.ts) | 无 cwd 全局读取已自动化；全局项目选项浏览器检查；真实远程安装未完成（GitHub 403）。 |
| F15-B | 未信任项目仍能查看全局列表，项目安装状态标未知/未加载。 | [服务](../../lib/skill-center/inventory.ts) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F15-C | 计划建立后撤销项目信任，执行被拒绝且没有写文件。 | [服务](../../lib/skill-center/inventory.ts) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F16-A | 仅键盘完成搜索→详情→确认安装→查看已安装；焦点不中断/丢失。 | [服务](../../lib/skill-center/types.ts)、[页面](../../components/skill-center/Shared.tsx) | 标签方向键、Esc 返回、开关 Space 和结果定位已检查；完整仅键盘闭环仍待补验。 |
| F16-B | 390 CSS px、200% 文字缩放时路径换行，固定底栏不遮挡内容。 | [服务](../../lib/skill-center/types.ts)、[页面](../../components/skill-center/Shared.tsx) | 390 CSS px 总览与安装确认已做 200% 计算字号放大，未整体横向溢出，底栏可见；截图与方法见视觉 QA。 |
| F16-C | 读屏能区分同名不同作用域开关，失败状态可听见。 | [服务](../../lib/skill-center/types.ts)、[页面](../../components/skill-center/Shared.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F17-A | 窗口 A 修改可见性，B 回到前台后刷新；B 的过期 revision 写入仍被服务器拒绝。 | [服务](../../lib/skill-center/remote.ts)、[页面](../../components/skill-center/SkillsCenter.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F17-B | 离线旧数据仍可阅读，但不能以旧预检直接安装。 | [服务](../../lib/skill-center/remote.ts)、[页面](../../components/skill-center/SkillsCenter.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F17-C | 更新后详情读取新内容；项目 A 清单不能命中项目 B 缓存。 | [服务](../../lib/skill-center/remote.ts)、[页面](../../components/skill-center/SkillsCenter.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F18-A | 旧 API 代表性调用仍返回兼容结构，既有锁文件与手写技能无需迁移即可显示。 | [服务](../../lib/skill-center/http.ts) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F18-B | 新旧入口不会引起重复加载或重复写操作；原插件管理行为不变。 | [服务](../../lib/skill-center/http.ts) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F18-C | 针对源码修改实际运行的检查记录入发布说明；未运行项目必须显式标注，禁止用设计审阅代替测试。 | [服务](../../lib/skill-center/http.ts) | 已记录针对性、全量、typecheck、lint；未运行 build。 |
| F19-A | 配置有效时五领域按规定顺序显示；总览可直接搜索全部领域目录，进入金融不出现计算机默认类别。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/Discover.tsx) | 真实零收录与代理五领域/独立子分类均已查看；搜索规则另由自动化覆盖。 |
| F19-B | 首次打开进入总览；领域返回总览恢复焦点，不能误触发安装或切 scope。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/Discover.tsx) | 真实总览返回焦点已验证；安装范围与领域分别建模。 |
| F19-C | 零收录、配置失败、未知数量分别呈现，不以示例技能填充。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/Discover.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F20-A | 同技能归属计算机和金融，两处安装标记一致，不能产生重复安装身份。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/Shared.tsx) | 代理已查看计算机/金融相同 quantitative-research；规范身份与去重有自动化覆盖。 |
| F20-B | 未知映射显示待分类，全部领域列表仍展示，不能默认计算机。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/Shared.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F20-C | 悬空分类、重复 ID、缺失证据发布失败，既有有效版本不丢失。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/Shared.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F20-D | 领域内无二级的条目在领域全部中可见；切换领域不改变 scope/开关。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/Shared.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F21-A | 领域空 query 只查询已收录索引，外部空 query 仍不发网络搜索。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/Discover.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F21-B | 结果显示“本地已收录/本次外部结果”，市场总量未知，不称全市场金融技能。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/Discover.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F21-C | 外部结果含未归类项时仍有可见待分类组，可查看详情并安装。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/Discover.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F21-D | 多领域同技能计数按当前集合去重，截取说明与索引版本可核对。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/Discover.tsx) | 自动化覆盖（临时目录/受控来源）；浏览器复合部分按视觉 QA 记录。 |
| F22-A | 金融分类→详情→安装取消→返回，原 query/分类/滚动恢复；项目作用域不变。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/SkillsCenter.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F22-B | 首次打开更新为全部，计算机、金融、待分类均在；检查全部不受当前领域筛选缩窄。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/SkillsCenter.tsx) | 代理首次更新默认全部领域；哲学筛选下检查全部仍返回 6 项。待分类加入同批次的浏览器场景待补。 |
| F22-C | 管理页主动选哲学后切更新保持哲学并显示清除入口，发现页导航不会默改此筛选。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/SkillsCenter.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
| F22-D | 分类删除或领域切换不会残留非法 category；旧响应不能覆盖新分类结果。 | [服务](../../lib/skill-center/catalog.ts)、[页面](../../components/skill-center/SkillsCenter.tsx) | 代码审阅；浏览器或跨进程完整场景尚待逐条补验。 |
