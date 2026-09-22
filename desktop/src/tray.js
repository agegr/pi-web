'use strict'

/**
 * System tray with basic window controls:
 * Show/Focus, Server Settings…, Quit.
 *
 * The tray owns no window logic — main.js supplies the callbacks —
 * but it guarantees that `destroy()` removes the icon cleanly so a
 * quitting app leaves no lingering tray icon.
 */

const { Tray, Menu, nativeImage } = require('electron')
const path = require('path')

const TRAY_ICON_PATH = path.join(__dirname, '..', 'build', 'icons', 'tray.png')

function createTray({ onShow, onSettings, onQuit }) {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH)
  const tray = new Tray(icon)
  tray.setToolTip('pi-web')

  const menu = Menu.buildFromTemplate([
    { label: 'Show / Focus', click: onShow },
    { label: 'Server Settings…', click: onSettings },
    { type: 'separator' },
    { label: 'Quit pi-web', click: onQuit }
  ])
  tray.setContextMenu(menu)

  // Single (left) click also shows the window, the conventional
  // behavior on Windows/Linux.
  tray.on('click', onShow)

  return tray
}

module.exports = { createTray }
