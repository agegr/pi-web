import { PtyManager, ensureSpawnHelper, defaultShell, shellSpawnArgs } from './pty-manager'

declare global {
  // eslint-disable-next-line no-var
  var __piSidebarPtyManager: PtyManager | undefined
}

export function getPtyManager(): PtyManager {
  if (!globalThis.__piSidebarPtyManager) {
    ensureSpawnHelper()
    globalThis.__piSidebarPtyManager = new PtyManager(defaultShell(), 10, shellSpawnArgs())
  }
  return globalThis.__piSidebarPtyManager
}
