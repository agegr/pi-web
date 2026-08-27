import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { SidebarError } from './wire'

function getSettingsPath(): string {
  const baseDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent')
  return join(baseDir, 'sidebar-settings.json')
}

export interface SidebarSettingsStore {
  value: Record<string, unknown>
  revision: number
}

let memorySettings: SidebarSettingsStore = {
  value: {},
  revision: 1,
}

export async function getSidebarSettings(): Promise<SidebarSettingsStore> {
  const filePath = getSettingsPath()
  if (!existsSync(filePath)) {
    return memorySettings
  }
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as { value?: Record<string, unknown>; revision?: number }
    if (parsed && typeof parsed === 'object') {
      memorySettings = {
        value: parsed.value ?? {},
        revision: typeof parsed.revision === 'number' ? parsed.revision : 1,
      }
    }
  } catch {
    // Ignore read failure and return memorySettings
  }
  return memorySettings
}

export async function updateSidebarSettings(
  patch: Record<string, unknown>,
  expectedRevision?: number,
): Promise<SidebarSettingsStore> {
  const current = await getSidebarSettings()
  if (expectedRevision !== undefined && expectedRevision !== current.revision) {
    throw new SidebarError('settings-conflict', 'settings revision conflict, please reload', 409)
  }
  const newValue = { ...current.value, ...patch }
  const newRevision = current.revision + 1
  const updated: SidebarSettingsStore = {
    value: newValue,
    revision: newRevision,
  }
  memorySettings = updated

  const filePath = getSettingsPath()
  try {
    const dir = join(filePath, '..')
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, JSON.stringify(updated, null, 2), 'utf8')
  } catch {
    // Persistence error (not fatal)
  }

  return updated
}
