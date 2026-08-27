/**
 * Shared vocabulary of the recommended plugin catalogs: the entry shape and
 * the GitHub topic URL. The two catalogs live in sibling modules —
 * `plugins-tabs.ts` (tab registrations) and `plugins-viewers.ts` (file
 * previewer registrations) — and are shown in the two "add plugin" modals
 * (Side card settings → the dashed cards at the end of the 侧边栏内容 /
 * 文件预览 grids).
 */

/** The GitHub topic page listing every repo tagged `dsh-better-sidebar`. */
export const PLUGIN_TOPIC_URL = 'https://github.com/topics/dsh-better-sidebar'

/** One curated plugin entry (name / url / description / install script). */
export interface PluginEntry {
  /** Unique id (the npm package name). */
  id: string
  /** Short display name. */
  name: string
  /** GitHub repository URL. */
  url: string
  /** One-line description (i18n friendly: string or () => string). */
  description: string | (() => string)
  /** Optional catalog group heading (i18n friendly); entries without one
   *  render under the plain list (a flat catalog stays flat). */
  category?: string | (() => string)
  /** The full shell command pre-filled into the install terminal (not
   *  executed until the user presses Enter). */
  install: string
}
