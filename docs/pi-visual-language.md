# Pi Web 的视觉语言（对齐 pi.dev）

Pi Web 是 pi coding agent 的浏览器界面，所以它的视觉语言直接取自 pi 官网
`https://pi.dev`：**同一套配色、同一套排版分工、同一套面板语法**。本文记录扒下来的
原始规则、它们映射到了哪些 token，以及新增的可复用 class。

改样式前先读这一页；不要在组件里重新发明颜色或圆角。

---

## 1. 官网的五条规则

从 `https://pi.dev/style.css` 里读出来的、真正定义"pi 味道"的东西：

| 规则 | 官网做法 |
|---|---|
| **纸** | 页面底色是 canvas（暗色 `#161d27` / 亮色 moonstone `#ebe7e4`），上面铺 4px 细格 + 20px 粗格 + 粗格交点的十字刻度，像工程纸 |
| **面板** | 1px 细线（`--line`）、**直角**（`border-radius: 0`）、半透明面板色，让格子隐约透出来 |
| **排版分工** | 正文/标题是衬线（Plantin MT Pro，斜体作标题）；短、固定、低频的标牌和顶层操作用像素等宽大写；日期、状态和密集控件用常规等宽 |
| **强调色** | 只有一个冷蓝（暗色 `#6a9fcc` / 亮色 tidal blue `#335a8c`），所有 tint 都是这一个色相在固定 alpha 上叠出来的 |
| **按钮** | 没有实心填充块。主操作是 `[ LABEL ]` —— 方括号用强调色，hover 时向两侧张开 |

另外两个小签名：选中项左侧 3px 竖条（暗色下 62% accent + 38% 深蓝的渐变），
以及方形、accent 染色的 6px 滚动条。

---

## 2. 字体

官网用三个字体，两个能带、一个不能：

| 字体 | 官网用途 | 这里的处理 |
|---|---|---|
| **Departure Mono**（像素等宽） | 面板标牌、顶层导航、短主操作 | **已随包分发**，`public/fonts/DepartureMono-Regular.woff2`（22KB） |
| Commit Mono | 正文等宽 | 沿用项目原有的 Noto Sans Mono stack |
| Plantin MT Pro | 正文衬线 | Monotype 商业字体，**不能分发** —— 走官网自己的 fallback |

Departure Mono 是 Helena Zhang 的作品，SIL OFL 1.1，许可证按 OFL 要求放在字体旁边
（`public/fonts/DepartureMono-OFL.txt`）。它只有拉丁字形，所以 token 里跟了一条回退：

```
--font-pixel: 'Departure Mono', var(--font-mono);
--font-serif: Georgia, 'Times New Roman', 'Songti SC', STSong, 'Noto Serif CJK SC', serif;
```

中文标签会逐字回退到常规等宽，不会整行丢字。face 用 `font-display: block` 并在
`app/layout.tsx` 里 preload，避免首屏那些少量标牌在换字时抖一下。

像素字体是强调，不是默认 UI 字体：只给**短、固定、低频、全大写**的标牌或顶层操作。
日期、时间、状态、用户内容和三个以上并排的密集控件一律用常规 `--font-mono`。

**要 100% 一致**只差衬线：把 Plantin 的 woff2 放进 `public/fonts/` 再加一条 `@font-face`
即可，但那份文件只能本地自用，不能随 npm 包发布。

---

## 3. Token 映射（`app/globals.css`）

`--pi-*` 是从官网抄下来的**原始色**，组件里永远不要直接用；语义 token 才是接口。

| 语义 token | 暗色（pi 深色主题） | 亮色（pi parchment 主题） |
|---|---|---|
| `--bg` | `#161d27` canvas | `#ebe7e4` moonstone |
| `--bg-deep` | `#0d1116` | `#dacbc2` parchment |
| `--bg-panel` | `#212730` | `#f4f2f0` |
| `--border` | slate 55% | warm-30 55% |
| `--text` / `--copy` | moonstone / 75% | evening blue / 86% |
| `--accent` | `#6a9fcc` 蓝 | `#8b513c` 赤陶（低饱和） |
| `--danger` / `--success` / `--warning` | terracotta / sage-green / sunkissed | `#9b3227` / 同色相的深色版 |

**两套主题的 accent 是反向的，这是故意的**：暗色留着 pi 自己的蓝；亮色走暖 —— 亮色是
parchment 纸，冷蓝放在暖纸上每一处都像外来件，而 pi.dev 自己的亮色 accent
（`--pi-tidal-blue #4b607c`）又跟墨色太近、读起来发灰。`#8b513c` 不是更亮的橙：饱和度
压在 pi 自己这个色相的水平上（`--pi-terracotta` 约 38%，60% 饱和的橙放在纸上比页面里
任何东西都吵），亮度取 parchment 地面（含 dashboard 压深过的那层）上作为文字还能过
4.5:1 的那一档。色淡了之后 accent 阶梯的 alpha 整体上调一档，否则染色表面会糊掉。

连带两处避让：`--danger` 保持更红更饱和的 `#9b3227`（告警是唯一该比 accent 吵的东西，
也才不会跟链接混），`--accent-amber` 推到橄榄金 `#6d5929`（否则待办行和事件行是同一片
桃色洗）。侧边栏/顶栏的 `--nav-panel-background` 横向染色也从 tidal-blue 换成同一个赤陶。

`--accent-faint → subtle → soft → fill → line → line-strong` 是官网那套「一个色相、
固定 alpha」的表面阶梯，需要染色表面时从这里取，不要新拌 `rgba()`。

### 跳色：`--accent-teal` / `--accent-amber`

官网只有一个蓝，chrome 上这样是对的，但页面里每一类东西看起来就都一样了。所以额外留了
两个**刻意不进语义集**的强调色（`--accent-teal` 青、`--accent-amber` 橙，各带一个
`-soft` 表面）：它们标的是**不同种类**，不是不同状态 —— 别拿它们当 danger/warning 用，
否则一个青色 chip 会被读成告警。

现在只用在三处，"时不时"就是这个密度：

| 位置 | 色 | 为什么 |
|---|---|---|
| 日历上的**今天**（`--today-mark` / `--today-wash`） | 亮色鲜橙 / 暗色青 | 见下；亮色下它自成一个色，暗色下才等于 `--accent-teal` |
| Agenda 里的待办行、待办面板的 TODAY 分组 | 橙 | 一堆日程里一眼挑出要做的事 |
| 侧边栏"正在运行"的会话圆点 | 青 | live 信号，从那片蓝里分出来 |

两个色在深浅两套主题下作为文字都过 4:1，重新调色时保持住。

### 日历的配色规则（`components/robin/eventSurface.ts`）

日历上所有色块只由一个函数发色，两条轴：

- **色相只有 accent 一个**——青已经被"今天"占了，橙被待办占了，再来第三个事件色就只是
  装饰。
- **深浅表示种类**：跨天/全天条用 `--accent-fill`，定时事件用 `--accent-soft`（何况两者
  形状本来就不同：横贯整周的条 vs 格子里的 chip）。
- **左侧竖线表示归属**：本地日历（可编辑）是实心 `--accent`，订阅进来的 Google 日历是
  `--accent-line-strong`。归属**不动填充**——连上 Google 之后整张日历都是订阅的，不能让
  它整张画成最淡的那一档。

改之前这套是反过来的（色相给归属、订阅事件全部用中性灰），结果就是一张没有颜色的格子。

### 今天：`--today-mark` / `--today-wash`

这个色只留给今天，别处不用。**两套主题拉开的维度不同**：暗色 accent 是蓝，今天靠色相拉开
——走青（`--accent-teal`）；亮色 accent 是低饱和赤陶，今天靠饱和度拉开 —— 同一个橙色家族
但饱和度是它的两倍多（`#b34a12`），整页哑光陶土里唯一鲜的一块。`#b34a12` 已经是这个色相
在"日期块上反白的 `--on-accent` 还能过 4.5:1"前提下最鲜的一档；`--today-wash` 的 alpha
也比 `--accent-soft` 高，格子才比里面的事件块亮。组件里一律只认 `--today-mark`，不要写死
其中任何一个。

今天在三个视图里是同一套：实心底反白的日期块（`.pi-today-badge`）、整格/整列的
`--today-wash` 洗色（比 mark 更浅更粉，才压得住底下的事件块）、以及月视图里
`border + inset box-shadow` 叠出来的双层框（用内阴影而不是 2px 边框，格子才不会在细线
网格里错位）。周视图的当前时间线、月视图当前周的左侧竖线也走 `--today-mark`。

### Dashboard 的纸感：`--dashboard-ground` / `--card-shadow`

聊天是一整份连续文档，保持官网那种平的半透明面板；dashboard 是几张分开的纸，所以地面用
`--dashboard-ground` 往 parchment 压一档（半透明，网格仍透得出来），`.pi-card` 反过来
改成**不透明** `--bg-panel` + 一层很淡的 `--card-shadow`。没有这一步两者会糊在一起。

侧边栏和顶栏的背景走 pi 的 `--nav-panel-background`：竖向暖白→纸色渐变上，叠一层
横向的 honey `#eacd7c` → tidal-blue 的染色洗。这是亮色主题里唯一的暖色，去掉后整页
只有冷墨+冷纸，所以保留（对应 `--pi-honey`）。

圆角：`--control-radius / --card-radius / --panel-radius` 全部为 `0`，Tailwind 的
`--radius-*` 也一并压平；只有 `--pill-radius` 和 `50%`（头像、状态点）保留圆形。

---

## 4. 可复用 class

| class | 用途 |
|---|---|
| `.pi-label` | 面板标题：等宽大写、左侧 2px accent 竖线的方框标签 |
| `.pi-eyebrow` | 常规等宽的不带框元数据标记（分组标题、日期行、字段标签） |
| `.pi-panel` / `.pi-card` | 直角细线半透明面板（`.pi-card` 是 dashboard 作用域内的） |
| `.pi-bracket` | `[ LABEL ]` 按钮，配合 `.ui-action` 使用 |
| `.pi-chrome-label` | 像素等宽大写，用在短、固定的顶层按钮/导航文字上 |
| `.pi-active-stripe` | 选中行左侧的 accent 竖条 |
| `.pi-today-badge` | 实心青底反白的日期块，日历里"今天"的标记（灰度下也认得出） |
| `.pi-prose` | 衬线正文（消息、文档、dashboard 文案） |
| `.pi-topbar` | 加在聊天顶栏容器上，仅直接的桌面 toolbar 操作取像素 chrome，弹层内容不继承 |

`.ui-action` 那套 `data-state` / `data-hover` / 变体 class 保持不变 —— 它已经全部走
token，换主题不需要改它。

---

## 5. 已经按这套语言改过的地方

- **Token 层**：`app/globals.css` 的调色板、排版、纸背景、滚动条、选区、Departure Mono
- **聊天外壳**：侧边栏 tab 与页脚、顶栏、会话列表选中态、输入区发送键、空状态标题、
  代码块头部、消息正文（衬线）
- **Dashboard**：页头、四个面板（日历/待办/链接/助手栏）、表单控件、日程色块；纸感分层
  （压深的地面 + 不透明带阴影的卡片）、今天的青色标记、逾期待办的 `--danger-soft` 底色
- **日历排版**：事件标题走衬线（内容），时间/星期/日期走等宽 tabular（数据）；刻度改成每
  小时都标、贴在线下方；半小时以内的块不再硬塞两行（时间只留在 tooltip 里）
- **全局清理**：1145 处内联样式里的硬编码色值（红/绿/黄/蓝的 tailwind 色）全部折叠到
  语义 token；实心 accent 按钮改成 accent 染色 + 细线 + 大写标签

未逐像素梳理的：`ModelsConfig` / `SkillsConfig` / `PluginsConfig` / `FileViewer` /
终端面板的**布局细节**（它们的颜色与圆角已经跟着 token 走了，但间距和层级还是原样）。
