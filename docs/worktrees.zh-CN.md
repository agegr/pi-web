# Pi Web 里的 Worktree

Pi Web 会把同一个 Git 项目的 main checkout 和 linked worktree 放在同一个项目下。你可以用它在不同分支之间切换工作目录，同时保留统一的会话列表。

## 什么时候会看到 Worktree 控件

当左上角选择的是 Git 仓库根目录时，项目选择器下面会出现 worktree 切换控件。

以下情况不会显示：

- 当前目录不是 Git 仓库。
- 当前目录在某个 Git 仓库里面，但不是仓库根目录。
- Git 无法读取这个仓库的 worktree 列表。

如果你在仓库子目录里，先从项目选择器打开仓库根目录，再管理 worktree。

## 切换 Worktree 会影响什么

worktree 切换器决定 Pi Web 接下来使用哪个 checkout。

它会影响：

- 从侧边栏新建的会话。
- 左侧 Explorer 浏览的文件。
- 从 Explorer 插入到输入框里的文件路径。

已有会话仍然按同一个 project root 分组。点击一个已有会话时，侧边栏会回到这个会话原本所在的 checkout。

新会话也可以直接在输入框上方选 checkout。新会话还没发消息时，输入框上方有一个小栏，显示它所在的项目；在仓库根目录时还会显示 worktree。选另一个项目或 worktree，新会话就会移过去，已经输入的文字、附加的图片和选好的模型、思考强度都会保留（如果另一个项目不提供这个模型，就回到自动选择）。它的项目和 worktree 菜单和侧边栏「文件」标签页里的一样，项目菜单里也有 `使用默认目录` 和 `打开其他项目…`，可以选任意文件夹；只有「文件」标签页可以移除 worktree。侧边栏里项目旁的 `+` 会在这个项目当前使用的 worktree 里新建会话（其他项目则用 main checkout）；要换 worktree，就用输入框上方的小栏。

## 新建 Worktree

在 worktree 菜单里选择 `New worktree...`，输入 branch name。如果是在新会话输入框上方的小栏里创建的，新会话会直接移到新的 worktree 里。

Pi Web 会把 checkout 放在：

```text
<repo>-worktrees/<branch>
```

例如 main checkout 是：

```text
/Users/alex/Documents/Workspace/pi-web
```

新建 `codex/worktree-help` 时，目录会是：

```text
/Users/alex/Documents/Workspace/pi-web-worktrees/codex-worktree-help
```

如果这个 branch 已存在，Pi Web 会为它添加 worktree。如果 branch 不存在，Pi Web 会从当前 `HEAD` 创建这个 branch。

## 删除 Worktree

在「文件」标签页的 worktree 菜单里，非 main worktree 右侧有删除按钮。它删除的是这个 checkout 目录。

删除 worktree 不会删除：

- Git branch。
- Pi Web 的历史会话。
- main checkout。

如果 worktree 里有未提交或未跟踪文件，Git 会拒绝删除。Pi Web 会再显示 force remove。force remove 会丢弃这个 checkout 里的未提交文件，只在确定不需要这些改动时使用。

## 会话和 Worktree 的关系

Pi Web 按 project root 分组会话，所以 main checkout 和 linked worktree 里的会话会显示在一起。

但每个会话仍然记得自己创建时的 working directory：

- 在某个 worktree 创建的会话，会继续使用那个 worktree path。
- 在 main checkout 创建的会话，会继续使用 main checkout。
- 如果某个 worktree 已被删除，它的历史会话仍会显示在项目下，方便你找回上下文。

## 常见问题

**为什么我看不到 worktree 切换器？**
请确认当前选择的是 Git 仓库根目录。仓库子目录会显示一行轻提示，而不是切换器；非 Git 目录只显示项目选择器。

**为什么某个 branch 不能创建 worktree？**
Git 不允许同一个 branch 同时被多个 worktree checkout。你可以切到已有的 worktree，或者先删除那个 checkout。

**Git 里还有已经消失的 worktree 记录怎么办？**
Git 有时会保留 prunable worktree 记录。Pi Web 会过滤这些记录，不在切换器里显示。

**Explorer 和当前聊天看起来不在同一个分支？**
Explorer 跟随当前选择的 worktree；聊天跟随打开的会话。重新点击会话，可以把侧边栏切回这个会话所在的 checkout。
