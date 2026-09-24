# Pi Web 增强插件系统 (Pi Web Enhancements Suite)

本项目基于官方 [agegr/pi-web](https://github.com/agegr/pi-web) 构建，内置了一整套强大、优雅且经过严格端到端测试的前端增强插件体系。

---

## 核心设计理念

1. **一切补丁皆插件 (All Enhancements as Plugins)**：
   所有针对 Pi Web 前端的显示优化、计时器、工具条、快捷键、布局调优与交互补丁均封装为可独立启闭的微插件，统一注册在 `ENHANCEMENT_PLUGINS` 中。
2. **设置面板统一受控 (Controlled via Settings UI)**：
   在 Pi Web 原生“设置”弹窗中新增“增强插件”选项卡，所有插件均支持单独 Toggle 开关，并可批量开启、关闭或重置为默认值。
3. **即时热生效与状态清理 (Instant Toggle & Safe Cleanup)**：
   插件关闭时立即自动清理已渲染的 DOM 元素与定时器；开启时即时计算与挂载，无需硬刷新。
4. **持久化与防更新自愈 (LocalStorage Persistence & Self-Healing)**：
   用户偏好保存在 `localStorage`。更新 Pi Web 版本后，执行自愈脚本 `patch-pi-web.js` 即可自动完成补丁重新注入，零痛点平滑升级。

---

## 主要插件与特性一览

### 1. 交互与控制增强
- **会话右键快捷菜单 (Session Row Context Menu)**：在侧边栏会话列表项上右键，支持一键复制 Session ID、完整文件路径、Prompt 提示词、工作目录 (CWD) 及快捷重命名。
- **快速划词引用工具栏 (Quick Action Quote Toolbar)**：在聊天回复区域中自由划词选中任意文本，立即唤出浮动工具栏，支持一键 `引用`、`解释`、`单测`、`排查`、`优化` 等动作，自动在输入框拼接格式化 Markdown 引用。
- **任务完成自动折叠工具调用 (Auto Collapse Tool Execution)**：长任务执行与工具链运行期间保持展开供实时监控；任务圆满完成后自动折叠中间过程（bash、edit 等），保持答复区清爽聚焦，且仍可随时点击卡片重新展开。
- **会话切换阅读位置记忆与恢复 (Session Scroll Position Restore)**：跨会话切换时自动记住每条会话的阅读偏移量与视口锚点，再次切回时平滑还原阅读进度，杜绝非预期贴底。
- **用户消息乐观状态对齐与大图去重 (User Message Reconcile)**：针对携带大型图片或附件的用户提问，毫秒级对齐乐观状态与服务端 SSE 流，根除气泡重复追加与闪烁。

### 2. 运行与监控指标
- **单步与全回合 Token/s 实时流速 (Model Generation Speed)**：在模型思考与输出流式传输期间实时显示供应商 Token/s 速率；单步完成后自动保留精确平均流速。
- **总耗时拆解徽标与进度条气泡 (Turn Duration Breakdown Tooltip)**：任务完成后在消息底部渲染精美的耗时徽章（如 `⏱️ 1分42秒`）；鼠标悬停或移动端轻触可查看思考、工具调用（细分子工具次数与耗时）和生成的详细耗时分布柱状图。

### 3. 显示与布局现代化
- **设置弹窗左侧导航与自适应加宽 (Settings Sidebar Layout)**：将设置弹窗的选项卡重构为符合现代 IDE 习惯的左侧垂直侧边栏导航，支持展开/收起为迷你图标模式，扩大面板可视面积。
- **常规设置双列仪表盘 (General Settings Dashboard)**：将常规面板升级为双列卡片仪表盘布局，大幅提升空间利用率，并集成一键重启/维护操作入口。
- **工具卡片全宽左对齐与布局稳定 (Tool Card Layout Stability)**：彻底消除工具卡片在不同屏幕分辨率下的阶梯式右偏或居中悬挂，保持 100% 全宽对齐与优雅截断。
- **子代理调度原生折叠卡片 (Subagent Dispatch Cards)**：无感替换旧式长文本广播，将子代理协作直接融入原生折叠卡片，并自动映射清晰的模型标识。

---

## 目录结构

```text
enhancements/
├── pi-web-enhancements.js         # 增强插件核心运行时脚本
├── patch-pi-web.js                # 自动化构建补丁注入与自愈脚本
├── install-pi-web-queue-actions.cjs # 消息队列操作支持补丁
├── pi-usage-delete-patch.cjs      # 用量账本防误删与持久化补丁
├── pi-web-native-collapse-patch.js # 原生折叠增强逻辑
├── pi-web-queue-actions.cjs       # 队列管理辅助工具
└── README.md                      # 本说明文档
```

---

## 快速使用

### 方式一：注入到已有 Pi Web 服务
在部署或安装了 `@agegr/pi-web` 的环境中直接执行：
```bash
node enhancements/patch-pi-web.js
```
脚本将自动定位本地的 Pi Web 静态资源与构建输出，安全注入增强脚本与热加载器。

### 方式二：静态资源直接引用
若作为 Next.js 独立运行，`public/pi-web-enhancements.js` 已经置于公共目录，可通过 HTML Head 或 Script 标签直接加载：
```html
<script src="/pi-web-enhancements.js" defer></script>
```

---

## 插件开关与配置

打开 Pi Web 界面后：
1. 点击左下角 ⚙️ **设置** 按钮；
2. 选择 **增强插件** 选项卡；
3. 根据个人使用偏好，自由勾选或关闭对应的插件项，状态将立即在当前页面生效并自动持久化。
