/**
 * The built-in catalog of FILE-PREVIEWER plugins (file-type previewers),
 * shown in the "add preview plugin" modal (Side card settings → 文件预览
 * grid → the dashed card). Adding an entry: append one object here (unique
 * `id` = npm package name, `url` = GitHub repo, `description` =
 * i18n-friendly, `install` = the full shell command pre-filled into the
 * install terminal — it starts with `cd ~/.dsh` so the install runs with
 * the DSH home as the working directory). Data integrity is guarded by
 * `tests/plugin-list.spec.ts`.
 */
import { t } from './locales'
import type { PluginEntry } from './plugins-shared'

/** File-previewer plugins (alphabetical order). */
export const builtinViewerPlugins: readonly PluginEntry[] = [
  {
    id: '@huanlin/dsh-plugin-better-sidebar-plugin-office',
    name: 'Office 预览插件',
    url: 'https://github.com/HuanLinOTO/dsh-plugin-better-sidebar-plugin-office',
    description: () => t('pluginOfficeDesc'),
    install: 'cd ~/.dsh && dsh plugin --profile web add @huanlin/dsh-plugin-better-sidebar-plugin-office',
  },
  {
    id: 'dsh-video-preview',
    name: '视频预览插件',
    url: 'https://github.com/zemul/dsh-video-preview',
    description: () => t('pluginVideoPreviewDesc'),
    install: 'cd ~/.dsh && dsh plugin --profile web add dsh-video-preview',
  },
]
