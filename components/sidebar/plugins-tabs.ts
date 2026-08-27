/**
 * The built-in catalog of TAB-registration plugins (sidebar pages),
 * shown in the "add tab plugin" modal (Side card settings → 侧边栏内容 grid
 * → the dashed card). Adding an entry: append one object here (unique
 * `id` = npm package name, `url` = GitHub repo, `description` =
 * i18n-friendly (add a `pluginXxxDesc` key in locales.ts), `install` = the
 * full one-line install script — it starts with `cd ~/.dsh` so the install
 * runs with the DSH home as the working directory). Data integrity is
 * guarded by `tests/plugin-list.spec.ts`.
 */
import { t } from './locales'
import type { PluginEntry } from './plugins-shared'

/** Tab-registration plugins (alphabetical order). */
export const builtinTabPlugins: readonly PluginEntry[] = [
  {
    id: '@dsh-external/dsh-sentinel',
    name: 'dsh-sentinel 唤醒系统',
    url: 'https://github.com/fuhefei/dsh-sentinel',
    description: () => t('pluginSentinelDesc'),
    // The official one-line bundle-channel install (git source, build
    // artifacts committed — no build step needed). The `github:…` form is
    // the upstream's documented command, `cd ~/.dsh` keeps the profile
    // context consistent with the other entries.
    install: 'cd ~/.dsh && dsh plugin --profile web add "github:fuhefei/dsh-sentinel#v0.7.0"',
  },
  {
    id: '@dsh-external/ego-browser',
    name: 'ego-browser Agent 浏览器',
    url: 'https://github.com/Fisfzy/ego-browser',
    description: () => t('pluginEgoBrowserDesc'),
    // Registers a sidebar tab for the agent browser; optional peer of
    // better-sidebar (auto-tab when present, floating bubble when not).
    install: 'cd ~/.dsh && dsh plugin --profile web add dsh-better-sidebar && dsh plugin --profile web add git+https://github.com/Fisfzy/ego-browser.git',
  },
  {
    id: 'dsh-docs-panel',
    name: 'dsh-docs-panel 全局文档',
    url: 'https://github.com/mlosun/dsh-docs-panel',
    description: () => t('pluginDocsPanelDesc'),
    // dsh-docs-panel hard-depends on dsh-better-sidebar (required peer), so
    // the install line installs the prerequisite first, then the plugin.
    install: 'cd ~/.dsh && dsh plugin --profile web add dsh-better-sidebar && dsh plugin --profile web add dsh-docs-panel',
  },
  {
    id: 'dsh-flowglass',
    name: 'dsh-flowglass 流镜',
    url: 'https://github.com/Iwctwbh/dsh-flowglass',
    description: () => t('pluginFlowglassDesc'),
    // Flowglass keeps its standalone drawer as a fallback and registers the
    // native tab automatically when better-sidebar is present.
    install: 'cd ~/.dsh && dsh plugin --profile web add dsh-better-sidebar && dsh plugin --profile web add dsh-flowglass',
  },
  {
    id: 'dsh-git-forge',
    name: 'dsh-git-forge Git 凭据',
    url: 'https://github.com/thirsty5034/dsh-git-forge',
    description: () => t('pluginGitForgeDesc'),
    // Peer-depends on dsh-better-sidebar (Git Forge tab). Install the
    // prerequisite first; package is GitHub-sourced until npm publish.
    install: 'cd ~/.dsh && dsh plugin --profile web add dsh-better-sidebar && dsh plugin --profile web add "dsh-git-forge@github:thirsty5034/dsh-git-forge"',
  },
  {
    id: 'dsh-git-remotes',
    name: 'dsh-git-remotes Git 远程',
    url: 'https://github.com/yq04/dsh-git-remotes',
    description: () => t('pluginGitRemotesDesc'),
    install: 'cd ~/.dsh && dsh plugin --profile web add dsh-better-sidebar && dsh plugin --profile web add git+https://github.com/yq04/dsh-git-remotes.git',
  },
  {
    id: 'dsh-sidebar-qa',
    name: 'dsh-sidebar-qa 划选追问',
    url: 'https://github.com/ChenRuoT/dsh-sidebar-qa',
    description: () => t('pluginSidebarQaDesc'),
    // dsh-sidebar-qa hard-depends on dsh-better-sidebar (required peer), so
    // the install line installs the prerequisite first, then the plugin.
    install: 'cd ~/.dsh && dsh plugin --profile web add dsh-better-sidebar && dsh plugin --profile web add git+https://github.com/ChenRuoT/dsh-sidebar-qa.git',
  },
  {
    id: 'dsh-ssh-tunnel',
    name: 'dsh-ssh-tunnel SSH 隧道',
    url: 'https://github.com/thirsty5034/dsh-ssh-tunnel',
    description: () => t('pluginSshTunnelDesc'),
    // Peer-depends on dsh-better-sidebar (SSH Tunnel tab + center terminal/SFTP).
    // Install the prerequisite first; package is GitHub-sourced until npm publish.
    install: 'cd ~/.dsh && dsh plugin --profile web add dsh-better-sidebar && dsh plugin --profile web add "dsh-ssh-tunnel@github:thirsty5034/dsh-ssh-tunnel"',
  },
  {
    id: 'dsh-turn-review',
    name: 'dsh-turn-review 本轮审查',
    url: 'https://github.com/yq04/dsh-turn-review',
    description: () => t('pluginTurnReviewDesc'),
    // Needs dsh-better-sidebar (optional peer) for the tab; no model tools.
    install: 'cd ~/.dsh && dsh plugin --profile web add dsh-better-sidebar && dsh plugin --profile web add git+https://github.com/yq04/dsh-turn-review.git',
  },
]
