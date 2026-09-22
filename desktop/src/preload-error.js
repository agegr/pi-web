'use strict'

/**
 * Connection-error page preload — the only bridge for the failure page
 * is the "reopen settings" affordance.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('piwebError', {
  openSettings: () => ipcRenderer.invoke('error:open-settings')
})
