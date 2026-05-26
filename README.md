# pi-web

[pi 编程智能体](https://github.com/badlogic/pi-mono) 的网页界面。在浏览器中浏览会话、与智能体对话、分叉对话、切换消息分支。

## 快速开始

**无需安装，直接运行：**

```bash
npx @agegr/pi-web@latest
```

**或全局安装后使用：**

```bash
npm install -g @agegr/pi-web
pi-web
```

启动后打开 [http://localhost:30141](http://localhost:30141)。

**可选参数：**

```bash
pi-web --port 8080               # 自定义端口
pi-web --hostname 127.0.0.1      # 仅本机访问
pi-web -p 8080 -H 127.0.0.1     # 组合使用

PORT=8080 pi-web                 # 也支持环境变量
```

## 功能介绍

- **会话浏览器** — 按工作目录分组展示所有 pi 会话
- **实时对话** — 通过 SSE 流式输出与智能体实时交互
- **输入框 `@` 智能文件联想** — 输入框任意位置键入 `@` 即可召唤极速本地工程文件检索列表，支持键盘 `Tab`/`Enter` 快速补全并附带专属语言后缀扁平图标，在引用本地代码上下文时感觉极其行云流水。
- **卓越的面包屑工作区路径切换器** — “Browse folder” 支持多级面包屑点击直接跨级秒跳转，双击或铅笔图标手写/粘贴完整路径，并提供内联子文件夹模糊快速过滤。
- **右侧缩略导航 Minimap** — 引入右侧微动效 Minimap 会话概览条，Hover 自动高亮邻近消息并呈献带角色的双行内容摘要气泡；点击点位直接 Smooth Scroll 使对应的历史消息卡片居中，方便长会话精准定位。
- **长会话渲染性能优化** — 采用 `React.memo` 优化会话历史节点级联重绘，并在侧边 Minimap 的位置计算中加入 150ms 节流拦截器，确保在频繁流式打字与滚屏时保持 constant $O(Tokens)$ 级的 60fps 丝滑体验。
- **会话分叉** — 从任意用户消息创建独立的新会话分支
- **会话内分支** — 回退到任意节点继续对话，在同一文件内创建分支
- **分支导航器** — 可视化切换同一会话内的各个分支
- **模型切换及热重载** — 对话中途随时切换模型，拦截设置指令加入主动重载，完美解决并热感知 `models.json` 中突变和热插拔添加的自定模型。
- **工具面板** — 控制智能体可使用的工具
- **压缩会话** — 对长会话进行摘要，节省上下文窗口
- **引导 / 追加** — 打断正在运行的智能体，或在其完成后追加消息

## 注意事项

- **数据目录** — 默认读取 `~/.pi/agent/sessions` 下的会话文件。可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他目录。
- **模型配置** — 从智能体数据目录下的 `models.json` 读取可用模型，可在侧边栏的「Models」面板中编辑。
- **文件浏览** — 侧边栏内置文件浏览器，可在标签页中查看当前工作目录下的文件。

## 开发

```bash
npm install
npm run dev   # 端口 30141
```

## 项目结构

```
app/
  api/
    sessions/      # 读写会话文件
    agent/         # 发送命令、SSE 事件流
    files/         # 文件内容读取
    models/        # 可用模型列表与默认模型
    models-config/ # 读写 models.json
components/        # UI 组件
lib/
  session-reader.ts  # 解析 .jsonl 会话文件
  rpc-manager.ts     # 管理 AgentSession 生命周期
  normalize.ts       # 规范化 toolCall 字段名
  types.ts
```

会话文件存储路径：`~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`
