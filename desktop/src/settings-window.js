'use strict'

/**
 * The shell-owned settings dialog.
 *
 * A frameless modal BrowserWindow loading `src/pages/settings.html`,
 * with `src/preload-settings.js` as its ONLY bridge to the main
 * process. The complete IPC surface is exactly two channels:
 * `settings:load` and `settings:save`.
 */

const { BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { normalizeServerUrl } = require('./settings')

const HTML_PATH = path.join(__dirname, 'pages', 'settings.html')
const PRELOAD_PATH = path.join(__dirname, 'preload-settings.js')

let dialogState = null // { currentUrl, resolve, window }

function ensureIpcRegistered() {
  if (ensureIpcRegistered.done) return
  ensureIpcRegistered.done = true

  ipcMain.handle('settings:load', () => {
    if (!dialogState) return null
    return dialogState.currentUrl
  })

  ipcMain.handle('settings:save', (event, rawUrl) => {
    if (!dialogState) {
      return { ok: false, error: 'No settings dialog is open.' }
    }
    const normalized = normalizeServerUrl(rawUrl)
    if (!normalized) {
      return {
        ok: false,
        error: 'Enter a valid http:// or https:// server URL.'
      }
    }
    const { resolve, window } = dialogState
    dialogState = null
    resolve(normalized)
    if (window && !window.isDestroyed()) window.close()
    return { ok: true, url: normalized }
  })
}

/**
 * Open the settings dialog.
 *
 * Resolves with the saved (normalized) server URL, or null when the
 * dialog is cancelled or closed without saving. Only one dialog at a
 * time: a second call focuses the existing window and returns a promise
 * that never races the first.
 */
function openSettingsDialog({ currentUrl, parent }) {
  ensureIpcRegistered()
  if (dialogState && dialogState.window && !dialogState.window.isDestroyed()) {
    dialogState.window.focus()
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    const window = new BrowserWindow({
      width: 480,
      height: 280,
      show: false,
      modal: !!parent,
      parent: parent || undefined,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'pi-web — Server Settings',
      webPreferences: {
        preload: PRELOAD_PATH,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    dialogState = { currentUrl: currentUrl || null, resolve, window }

    window.once('ready-to-show', () => window.show())

    // Cancelled / closed without saving.
    window.on('closed', () => {
      if (dialogState && dialogState.window === window) {
        dialogState = null
        resolve(null)
      }
    })

    window.loadFile(HTML_PATH)
  })
}

module.exports = { openSettingsDialog }
