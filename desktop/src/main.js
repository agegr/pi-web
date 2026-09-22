'use strict'

/**
 * pi-web desktop shell — main process.
 *
 * A thin Electron shell that hosts a user-self-hosted pi-web server in
 * a desktop window. It ships no server of its own; the pi-web Next.js
 * app is never bundled or modified.
 */

const { app, BrowserWindow } = require('electron')

const { createTray } = require('./tray')
const {
  startApp,
  openSettingsAndApply,
  getMainWindow
} = require('./window-flow')

// Windows: identify the app so notifications render with the right
// identity while the window is hidden to tray.
app.setAppUserModelId('dev.piweb.desktop')

let tray = null
let quitting = false

function isQuitting() {
  return quitting
}

function showMainWindow() {
  const win = getMainWindow()
  if (!win) return
  if (!win.isVisible()) win.show()
  if (win.isMinimized()) win.restore()
  win.focus()
}

function quitFromTray() {
  quitting = true
  const win = getMainWindow()
  if (win) win.destroy()
  if (tray) {
    tray.destroy()
    tray = null
  }
  app.quit()
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(() => {
    tray = createTray({
      onShow: showMainWindow,
      onSettings: () => {
        showMainWindow()
        openSettingsAndApply()
      },
      onQuit: quitFromTray
    })

    startApp({ isQuitting })
  })

  app.on('window-all-closed', () => {
    // With close-to-tray this only fires during a real quit; keep the
    // conventional darwin exception anyway.
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', () => {
    quitting = true
  })
}
