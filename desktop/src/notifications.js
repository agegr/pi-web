'use strict'

/**
 * Desktop notifications policy.
 *
 * The embedded Chromium exposes the standard HTML5 Notification API;
 * pi-web already uses it, so the shell only has to grant the
 * permission. The grant is scoped to the configured pi-web origin:
 * any other origin that ever loads inside the window (e.g. the
 * connection-error page, which is file://) is refused.
 *
 * Notifications keep rendering while the window is hidden to tray:
 * hiding the window does not suspend its renderer, and the Windows
 * AppUserModelID set in main.js makes the notifications app-identifiable
 * so they are delivered even when the app has no visible window.
 */

const { session } = require('electron')

const { isSameOrigin } = require('./navigation')

const ALLOWED_PERMISSIONS = new Set(['notifications'])

function applyNotificationPolicy(configuredOrigin) {
  const defaultSession = session.defaultSession

  // Permission requests (e.g. new Notification() without an
  // existing grant): allow `notifications` only for the configured
  // pi-web origin.
  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (!configuredOrigin) {
      callback(false)
      return
    }
    const requestOrigin =
      (details && details.requestingUrl) ||
      (webContents && webContents.getURL()) ||
      ''
    // Exact normalized-origin comparison (never a string prefix: a raw
    // startsWith would grant lookalike origins like http://host:port.evil.com).
    const sameOrigin = isSameOrigin(requestOrigin, configuredOrigin)
    callback(sameOrigin && ALLOWED_PERMISSIONS.has(permission))
  })

  // Synchronous permission checks (Notification.permission query):
  // mirror the request handler so the API reports the same state.
  defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (!configuredOrigin) return false
    if (!ALLOWED_PERMISSIONS.has(permission)) return false
    const origin = requestingOrigin || (details && details.requestingUrl) || ''
    return isSameOrigin(origin, configuredOrigin)
  })
}

module.exports = { applyNotificationPolicy }
