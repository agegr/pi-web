'use strict'

/**
 * Main window lifecycle for the pi-web desktop shell.
 *
 * First run: no stored URL -> settings dialog first, only then create
 * and load the main window. On `did-fail-load` the window shows the
 * shell-owned connection-error page, which offers "Server settings…".
 * A saved URL change persists and `loadURL`s the new origin.
 */

const { BrowserWindow, ipcMain } = require('electron')
const path = require('path')

const {
  loadSettings,
  saveSettings,
  normalizeServerUrl
} = require('./settings')
const { openSettingsDialog } = require('./settings-window')
const { attachNavigation, originOf } = require('./navigation')
const { applyNotificationPolicy } = require('./notifications')

const ERROR_HTML_PATH = path.join(__dirname, 'pages', 'connection-error.html')
const ERROR_PRELOAD_PATH = path.join(__dirname, 'preload-error.js')

let mainWindow = null
let configuredOrigin = null
let showingErrorPage = false
let isQuitting = null // () => boolean, injected by main.js
let lastLoadedUrl = null

function getMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 400,
    show: false,
    title: 'pi-web',
    backgroundColor: '#1e1f24',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Minimal error-page preload (spec: error:open-settings channel only).
      // Without it window.piwebError is undefined on the connection-error page
      // and its "Server settings…" button throws instead of opening the dialog.
      preload: ERROR_PRELOAD_PATH
      // no webSecurity relaxations: defaults stay hardened
    }
  })

  // Close-to-tray: hide instead of closing unless the app is quitting.
  win.on('close', (event) => {
    if (isQuitting && !isQuitting()) {
      event.preventDefault()
      win.hide()
    }
  })

  // Show the window unconditionally with a short fallback: a blackholed
  // unreachable server fires neither ready-to-show nor did-fail-load for a
  // long time, and gating visibility solely on ready-to-show left the user
  // with NO window at all (gen-2 review blocker).
  const shown = { done: false }
  const showOnce = () => {
    if (!shown.done) {
      shown.done = true
      win.show()
    }
  }
  win.once('ready-to-show', showOnce)
  setTimeout(showOnce, 1500)

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    if (errorCode === -3 /* ERR_ABORTED */) return
    if (showingErrorPage) return
    showingErrorPage = true
    win.loadFile(ERROR_HTML_PATH)
  })

  win.webContents.on('did-finish-load', () => {
    const currentUrl = win.webContents.getURL()
    showingErrorPage = currentUrl.startsWith('file://')
  })

  attachNavigation(win, () => configuredOrigin)

  return win
}

/**
 * Point the shell at a server URL: persist, update navigation origin
 * and notification policy, and load the URL in the main window.
 */
function applyServerUrl(serverUrl) {
  const normalized = normalizeServerUrl(serverUrl)
  if (!normalized) return false
  saveSettings({ serverUrl: normalized })
  lastLoadedUrl = normalized
  configuredOrigin = originOf(normalized)
  applyNotificationPolicy(configuredOrigin)
  const win = getMainWindow()
  showingErrorPage = false
  if (win) {
    win.loadURL(normalized)
  }
  return true
}

/**
 * Open the settings dialog (first run or re-edit) and, when the user
 * saved a URL, apply it. Resolves with the applied URL or null.
 */
async function openSettingsAndApply() {
  const url = await openSettingsDialog({
    currentUrl: lastLoadedUrl || loadSettings().serverUrl,
    parent: getMainWindow() || undefined
  })
  if (!url) return null
  applyServerUrl(url)
  return url
}

/**
 * App entry: orchestrate the main window flow.
 *
 * @param {object} options
 * @param {() => boolean} options.isQuitting  close-to-tray guard
 */
async function startApp({ isQuitting: isQuittingFn }) {
  isQuitting = isQuittingFn

  // Connection-error page affordance.
  ipcMain.handle('error:open-settings', async () => {
    const url = await openSettingsAndApply()
    return !!url
  })

  const settings = loadSettings()
  let serverUrl = normalizeServerUrl(settings.serverUrl)

  if (!serverUrl) {
    // Development convenience: seed the URL from the environment
    // (see desktop/README.md) without going through the dialog.
    const envUrl = normalizeServerUrl(process.env.PI_WEB_SERVER_URL)
    if (envUrl) {
      serverUrl = envUrl
    } else {
      // First run: configure before showing anything.
      const url = await openSettingsDialog({ currentUrl: null })
      if (!url) {
        // Nothing to host; user declined configuration.
        const { app } = require('electron')
        app.quit()
        return null
      }
      serverUrl = url
    }
  }

  mainWindow = createMainWindow()
  applyServerUrl(serverUrl)
  return mainWindow
}

module.exports = {
  startApp,
  applyServerUrl,
  openSettingsAndApply,
  getMainWindow
}
