"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const { contextBridge, ipcRenderer } = require("electron");

// Keep the renderer bridge narrow: desktop detection plus the existing native
// directory-picker capability. Remote webviews do not receive this preload.
contextBridge.exposeInMainWorld("piDesktop", Object.freeze({
  isDesktop: true,
  platform: process.platform,
  selectDirectory: () => ipcRenderer.invoke("pi-web:select-directory"),
}));
