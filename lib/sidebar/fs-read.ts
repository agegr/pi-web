import { open, stat, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { SidebarError } from './wire'

export const DEFAULT_READ_LIMIT = 2 * 1024 * 1024 // 2MB
export const READ_HEAD_LIMIT = 512

export interface FsReadResult {
  kind: 'text' | 'binary'
  content?: string
  head?: string
  size: number
  truncated: boolean
}

export async function readTextOrBinary(path: string, readLimit = DEFAULT_READ_LIMIT): Promise<FsReadResult> {
  const info = await stat(path).catch((error: unknown) => {
    throw new SidebarError('fs-error', `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
  })
  if (info.isDirectory()) {
    throw new SidebarError('fs-error', `"${path}" is a directory`, 400)
  }
  const size = info.size
  const truncated = size > readLimit
  const handle = await open(path, 'r').catch((error: unknown) => {
    throw new SidebarError('fs-error', `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
  })
  try {
    const buffer = Buffer.alloc(Math.min(size, readLimit))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const slice = buffer.subarray(0, bytesRead)
    const binary = slice.includes(0)
    const head = binary
      ? slice.subarray(0, Math.min(slice.length, READ_HEAD_LIMIT)).toString('base64')
      : undefined
    return {
      kind: binary ? 'binary' : 'text',
      content: binary ? '' : slice.toString('utf8'),
      truncated,
      size,
      head,
    }
  } finally {
    await handle.close()
  }
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  const tmp = `${path}.pi-sidebar-tmp-${process.pid}-${Date.now()}`
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw new SidebarError('fs-error', `cannot write "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
  }
}
