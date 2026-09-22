'use strict'

/**
 * Settings dialog preload — the complete IPC surface for the settings
 * page is exactly `settings:load` and `settings:save`.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('piwebSettings', {
  load: () => ipcRenderer.invoke('settings:load'),
  save: (serverUrl) => ipcRenderer.invoke('settings:save', serverUrl)
})
