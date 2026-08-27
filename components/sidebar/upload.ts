/**
 * File-upload plumbing for the files window: turn a file picker or a drag-drop
 * into per-file raw-byte uploads through the sidebar's `/sidebar/upload` route.
 *
 * Folders keep their tree in both flows: the picker's `webkitdirectory`
 * selection arrives as Files with `webkitRelativePath` filled, and dropped
 * folders — which never surface in `dataTransfer.files` — are traversed via
 * `webkitGetAsEntry`, so the relative path is preserved for every nested file
 * and the host recreates the tree under the chosen directory. The File is
 * streamed straight into the POST body (no base64 inflation); uploads run
 * sequentially so one slow file cannot starve the others, and each result
 * reports its own outcome (the tree keeps going after a failure). An
 * optional `AbortSignal` stops the queue at the next item boundary and
 * aborts the in-flight request; the host cleans up its temp file when the
 * request stream dies.
 */
import { api, SidebarApiError, type SessionScope } from './api'
import { isAbsolutePath } from './paths'
import type { CopyKey } from './locales'

/** One pending file: the browser File plus the workspace-relative target path. */
export interface UploadItem {
  file: File
  relativePath: string
}

/** One settled upload. */
export interface UploadResult {
  relativePath: string
  ok: boolean
  path?: string
  /** Wire error code when the host refused the upload ('too-large', ...). */
  code?: string
  /** The host's error message (English wire text; localize via `code`). */
  error?: string
}

/** Sanitize a relative target: absolute paths, traversal, and empty segments
 *  are rejected (the host enforces the same rules with a 400). */
function sanitizeRelativePath(rel: string): string | undefined {
  if (rel === '' || isAbsolutePath(rel)) return undefined
  if (rel.split(/[\\/]/).some((s) => s === '' || s === '.' || s === '..')) return undefined
  return rel
}

/** The picker's relative path: webkitRelativePath when present, else the name. */
function relativePathOf(file: File): string | undefined {
  return sanitizeRelativePath(file.webkitRelativePath || file.name || '')
}

/** Collect a picker selection (webkitdirectory folders carry relative paths). */
export function uploadItemsFromFiles(files: FileList | readonly File[]): UploadItem[] {
  const items: UploadItem[] = []
  for (const file of files) {
    const rel = relativePathOf(file)
    if (rel !== undefined) items.push({ file, relativePath: rel })
  }
  return items
}

/** Read one dropped file-system entry into upload items; directories
 *  recurse, prefixing their name onto every descendant's relative path. */
async function itemsFromEntry(entry: FileSystemEntry, prefix: string): Promise<UploadItem[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      ;(entry as FileSystemFileEntry).file(resolve, reject)
    })
    const rel = sanitizeRelativePath(prefix + file.name)
    return rel === undefined ? [] : [{ file, relativePath: rel }]
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    const entries: FileSystemEntry[] = []
    // readEntries returns one BATCH per call; drain until an empty batch.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject)
      })
      if (batch.length === 0) break
      entries.push(...batch)
    }
    const nested = await Promise.all(entries.map(child => itemsFromEntry(child, `${prefix}${entry.name}/`)))
    return nested.flat()
  }
  return []
}

/**
 * Collect a drag-drop payload. Dropped folders do NOT surface in
 * `dataTransfer.files` — they arrive as directory items, so entries are
 * captured via `webkitGetAsEntry` and traversed (draining readEntries
 * batches), keeping each nested file's relative path. MUST be invoked
 * synchronously from the drop handler: the dataTransfer enters protected
 * mode once the event dispatch ends, while the captured entry handles stay
 * readable asynchronously. Falls back to the flat file list when the entry
 * API is unavailable; an entry that fails to read is skipped, not fatal.
 */
export async function uploadItemsFromDrop(data: DataTransfer | undefined): Promise<UploadItem[]> {
  if (data === undefined) return []
  // Synchronous section: capture every entry handle before returning.
  const entries = [...data.items]
    .map(item => (item.kind === 'file' ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null)
  if (entries.length === 0) return uploadItemsFromFiles(data.files)
  const nested = await Promise.all(entries.map(entry => itemsFromEntry(entry, '').catch(() => [])))
  return nested.flat()
}

/**
 * Client-side pre-check cap. Mirrors the host's default (config `uploadLimit`)
 * only — the host enforces the real, configurable limit, so a lowered host
 * limit surfaces as a `too-large` wire error, never as a silent pass.
 */
export const MAX_UPLOAD_BYTES = 128 * 1024 * 1024

/** How long a success hint stays before fading (failures stay until the next action). */
export const UPLOAD_HINT_MS = 3500

/**
 * One-line upload progress text: 'Uploading into {dir}…' while no file is in
 * flight, then 'Uploading {done}/{total}: {name}' per file. Shared by the tree
 * hint and the full-window upload overlay.
 */
export function uploadHintText(
  done: number,
  total: number,
  current: string,
  dir: string,
  t: (key: CopyKey, params?: Record<string, string | number>) => string,
): string {
  return current === '' ? t('uploadingTo', { dir }) : t('uploadProgress', { done, total, name: current })
}

/**
 * Upload every item into `dir` (absolute, inside the session workspace),
 * sequentially, reporting progress as `(done, total, currentRelativePath)`.
 * Resolves with one result per item — never rejects; `signal.aborted` stops
 * the queue at the next item boundary (completed items stay uploaded).
 */
export async function uploadToDir(
  scope: SessionScope,
  dir: string,
  items: UploadItem[],
  onProgress?: (done: number, total: number, current: string) => void,
  signal?: AbortSignal,
): Promise<UploadResult[]> {
  const results: UploadResult[] = []
  let done = 0
  for (const item of items) {
    if (signal?.aborted) break
    onProgress?.(done, items.length, item.relativePath)
    try {
      if (item.file.size > MAX_UPLOAD_BYTES) {
        results.push({ relativePath: item.relativePath, ok: false, code: 'too-large' })
      } else {
        const res = await api.uploadFile(scope, dir, item.relativePath, item.file, signal)
        results.push({ relativePath: item.relativePath, ok: true, path: res.path })
      }
    } catch (error) {
      // An aborted in-flight request is a cancel, not a failure: stop quietly.
      if (error instanceof DOMException && error.name === 'AbortError') break
      results.push({
        relativePath: item.relativePath,
        ok: false,
        code: error instanceof SidebarApiError ? error.code : undefined,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    done++
  }
  onProgress?.(done, items.length, '')
  return results
}

/** Fold a result list into a one-line status for the tree hint. */
export function summarizeResults(
  results: UploadResult[],
  t: (key: CopyKey, params?: Record<string, string | number>) => string,
): string {
  const okCount = results.filter((r) => r.ok).length
  const failed = results.find((r) => !r.ok)
  if (failed !== undefined) {
    const detail = failed.code === 'too-large' ? t('uploadTooLarge') : (failed.error ?? t('uploadFailedUnknown'))
    return t('uploadFailed', { error: detail })
  }
  return t('uploadDone', { count: okCount })
}
