# My Agent Web 智能体网页版技术设计与维护大纲

---

## 🛠 本次重点功能更新维护说明

本章对近期新增的几项高阶底层重构、交互体验改进和项目归属化定制进行整合与文档归档，确立为团队维护及二次开发的标准规范。

### 1. 鱼眼放大的微缩导航机制 (Fish-eye Lens & Dynamic Displaced Minimap)

* **设计初衷**：在长会话、消息密集的交互场景中，原版的 Minimap 消息气泡和小圆点紧密排列连成一片，无法准确交互和选取。
* **物理畸变逻辑 (Distortion & Spreading)**：
  * 引进空间广角变焦算法。在鼠标悬浮位置 `mouseYRatio` 上下 **15% 的高宽扇区范围内**，对消息点位的 visual 物理 top 值应用二次递减插值。
  * 处于鼠标最近临界区（Proximity Range）的小圆点会自动被**推开、摊直、并平滑排开**，获得最大 **1.8x** 的缩放比例。
  * 采用流畅的 `cubic-bezier(0.16, 1, 0.3, 1)` 力学回弹变焦动效。当离开时，微缩圆点以 `0.1s` 秒极速无损复位。
  * 联动的**变焦悬浮框气泡（Displaced Tooltip）**：Tooltip 解析坐标紧随经过物理鱼眼计算后的变形节点视觉坐标，保持动态绝对对齐，彻底解决重叠、遮挡、难以点按的宿疾。

### 2. 光标感知与上下文技能斜杠唤醒 (Caret-Aware Slash Skill Trigger)

* **技术重构**：重构了传统全局 `startsWith("/")` 的唤醒方案。
* **底层升级**：
  * **按需光标切分 (Caret Selection Split)**：每次打字时，提取当前光标所处的子切片 `textBeforeCaret = fullValue.slice(0, selectionStart)`。
  * 以正则表达式、反向查找方式分析光标左侧最后一个字符结构。只要符合“行首斜杠 `^/`” 或“空格斜杠 ` /`”，即可随地、中途和任意文字段落中急速激活 `SkillMenu`。
  * **非破坏性替换 (Non-Destruction Insertion)**：在菜单选定高吞吐量技能（如 `/skill:caveman`）时，**精确使用指针重绘该斜杠片段**并完整保留前后原有的文案输入，真正做到行云流水级技能注入。

### 3. 长文流式安全呼吸滚动策略 (Safe viewport buffering on stream)

* **设计缺陷修复**：废除无限制强顶 `scrollTop = scrollHeight` 和一整屏撑高的假占位符（原 `80vh` 占位）。解决新生成消息和精细代码卡片首部“直接被强制塞入屏幕上方屏幕边缘并不可见”的显示漏洞。
* **改进策略**：
  * **预设下边缘呼吸空腔 (Safe buffering spacer)**：在内容底部只保留一个 `140px` 呼吸安全底座和额外的折行观察区。
  * **阈值精确平滑跟焦**：在消息接收事件 (`message_update`) 时，根据新生成内容和视口长宽实时计算：`scrollTarget = scrollHeight - clientHeight`。只有当确定内容有实际增量且用户没有锁定滚动时，系统才温和滑移到此高度。
  * 完美解决了代码展示的长文本，大面积在视口内清晰、自底向下流式渲染跃迁的视觉舒适感。

### 4. 专属组织级品牌定制与打包 (Private Brand Customization & Production Build)

* **独立包装**：
  * 已将元数据更改为专属自研项目 **`pi-web`** 模块，版本起航至发布级标杆 `1.0.0`。
  * 本地 CLI 启动脚本更新为可以直接使用 **`pi-web --port <30141>`** 命令启动宿主服务，完成了完整的项目品牌、名称以及标题归宿净化。
  * `package.json` 的打包流程已兼容 Webpack 与 Turbopack 环境调试，确保在任何复杂环境中均可顺畅打包通过。

### 5. 宿主原生终端一键唤醒机制 (Native System Terminal Spawner)

* **设计初衷**：为避免在 Web 浏览器沙盒中集成过于繁重的主题、快捷键、PTY 缓冲区通信以及由此带来的幽灵进程内存泄漏，本方案放弃了网页端构建仿真终端，直接一键拉起宿主原生的专业终端。
* **技术实现与降级（Spawn & Robust Fallback）**：
  * **Windows**：首选利用 `child_process.spawn` 静默拉起 `wt.exe`（Windows Terminal）并精准定位到选定项目的 `CWD` 参数。在没有安装或不支持 `wt` 的旧版本 Windows 下，自动拦截 `ENOENT` 异常并**平滑降级（Graceful Fallback）**拉起系统原生的富功能 `PowerShell`。
  * **macOS**：一键激活系统自带的 `Terminal.app`（`open -a Terminal <path>`），在用户桌面原汁原味地打开目标文件夹。
  * **Linux**：尝试查找系统的 `x-terminal-emulator`，或安全回归至主流的 `gnome-terminal`。
  * **优势**：极佳地结合了本地工具链（Local-Toolchain）的高生产力，零内存负荷，交互 100% 还原系统终端级别。

---

## 📖 核心词汇表 (Domain Glossary)

* **Host-Process (宿主服务进程)：** 运行 Node.js 运行时和 Next.js 生产服务器后端（包括 RpcManager 消息流控制、本地文件读写、SSE 路由）的进程。
* **Client-Shell (客户端壳体)：** 供用户交互的视窗载体。在本方案中为由 **Tauri** 建立的原生轻量窗体（Windows 上使用的是 Microsoft Edge WebView2 渲染内核）。
* **Sidecar (伴随/子进程)：** Tauri 的原生机制，允许主程序安全拉起并维护一个独立的二进制辅助进程。在本方案中，指被打包成单文件二进制的 Node.js/Next.js 后端服务。
* **Local-Toolchain (本地工具链)：** 本机上安装的开发工具（Git、Node/Npm、编译器等）。无论是何种打包方案，都必须继承并安全调用操作系统的本地开发工具链。
* **Dynamic Port Scanning (动态端口搜寻避让)：** 运行时检测操作系统可用空闲网络套接字端口的机制，用于防止两款应用或两个实例抢占 `30141` 默认端口导致故障。
* **Orphan Prevention (孤儿伴随进程自杀与清理机制)：** 客户端退出或崩溃时，确保维护的后台子二进制程序不会残留后台，通过 Rust-kill 和 Node-ipc 断开监听双重保障进行内存清理。
