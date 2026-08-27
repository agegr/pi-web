/**
 * Mark this plugin's row in the DSH settings navigation so its bundled CSS
 * can replace the shell's fallback gear with the Side card glyph.
 *
 * DSH 0.1.x projects only `id`, `order`, and `label` from a
 * `settings.section` registration, then chooses icons inside the settings
 * shell from a closed list of built-in ids. Until that public contract grows
 * an icon field, the plugin identifies only its own localized row after the
 * dialog mounts. The marker owns no shell structure and is removed on fiber
 * disposal, so the adaptation remains HMR-safe.
 */

export const SETTINGS_NAV_MARKER = 'data-dsh-better-sidebar-settings-nav'

/**
 * Keep the marker on the settings-nav button whose visible text is this
 * plugin's current localized section label.
 * @param label - locale-aware label resolver used by the section registration.
 * @returns disposer that disconnects observation and removes owned markers.
 */
export function registerSettingsNavIcon(label: () => string): () => void {
  let disposed = false

  const sync = (): void => {
    if (disposed) return
    const currentLabel = label().trim()
    const buttons = document.querySelectorAll<HTMLButtonElement>('[role="dialog"] nav button')
    for (const button of buttons) {
      const matches = currentLabel.length > 0 && button.textContent?.trim() === currentLabel
      if (matches) button.setAttribute(SETTINGS_NAV_MARKER, '')
      else button.removeAttribute(SETTINGS_NAV_MARKER)
    }
  }

  sync()
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

  return () => {
    disposed = true
    observer.disconnect()
    document.querySelectorAll(`[${SETTINGS_NAV_MARKER}]`)
      .forEach(element => { element.removeAttribute(SETTINGS_NAV_MARKER) })
  }
}
