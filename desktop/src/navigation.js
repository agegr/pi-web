'use strict'

/**
 * External-link policy for the main window.
 *
 * - Every `window.open` / `target="_blank"` is routed to the system
 *   browser via `shell.openExternal`; no new BrowserWindow is ever
 *   created for web content.
 * - `will-navigate` keeps same-origin (scheme/host/port) navigations
 *   inside the window and delegates cross-origin ones to the system
 *   browser.
 *
 * The configured origin is supplied as a getter so a settings change
 * takes effect immediately without re-attaching listeners.
 */

const { shell } = require('electron')

function originOf(rawUrl) {
  try {
    const u = new URL(rawUrl)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

/** Normalize with explicit default ports so http://h:80 === http://h */
function normalizedOrigin(rawUrl) {
  try {
    const u = new URL(rawUrl)
    const port =
      (u.port === '' && u.protocol === 'https:') ? 443 :
      (u.port === '' && u.protocol === 'http:') ? 80 :
      Number(u.port)
    return `${u.protocol}//${u.hostname}:${port}`
  } catch {
    return null
  }
}

function isSameOrigin(url, configuredOrigin) {
  if (!configuredOrigin) return false
  return normalizedOrigin(url) === normalizedOrigin(configuredOrigin)
}

function attachNavigation(win, getConfiguredOrigin) {
  const webContents = win.webContents

  // window.open / target=_blank: always the system browser.
  webContents.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:/i.test(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // In-window navigation: same-origin stays, anything else goes out.
  webContents.on('will-navigate', (event, url) => {
    if (!url) return
    const configuredOrigin = getConfiguredOrigin()
    if (isSameOrigin(url, configuredOrigin)) {
      return // ordinary in-app navigation, allowed
    }
    event.preventDefault()
    if (/^https?:/i.test(url)) {
      shell.openExternal(url)
    }
  })
}

module.exports = { originOf, normalizedOrigin, isSameOrigin, attachNavigation }
