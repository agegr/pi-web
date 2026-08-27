import { NextRequest, NextResponse } from 'next/server'
import { stat, readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { ensureWorkspacePath } from '@/lib/sidebar/path-security'
import { requireAbsolute } from '@/lib/sidebar/fs-tree'
import { errorResponse, SidebarError } from '@/lib/sidebar/wire'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const filePath = searchParams.get('path')
    let cwd = searchParams.get('cwd')
    if (!cwd) cwd = process.cwd()

    if (!filePath) {
      throw new SidebarError('bad-request', 'missing "path" query param', 400)
    }

    const absolute = requireAbsolute(filePath)
    const safePath = await ensureWorkspacePath(cwd, absolute)
    const fileStat = await stat(safePath)
    if (fileStat.isDirectory()) {
      throw new SidebarError('bad-request', 'path is a directory', 400)
    }

    const fileBuffer = await readFile(safePath)
    const ext = extname(safePath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    const fileName = basename(safePath)
    const isDownload = searchParams.get('download') === '1'

    const headers = new Headers({
      'Content-Type': contentType,
      'Content-Length': fileStat.size.toString(),
      'Cache-Control': 'no-cache',
    })

    if (isDownload) {
      headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`)
    }

    return new NextResponse(fileBuffer, { headers })
  } catch (error) {
    return errorResponse(error)
  }
}
