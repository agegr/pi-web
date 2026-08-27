import { NextRequest } from 'next/server'
import { writeWorkspaceUpload } from '@/lib/sidebar/fs-operations'
import { okResponse, errorResponse, SidebarError } from '@/lib/sidebar/wire'

const UPLOAD_LIMIT = 100 * 1024 * 1024 // 100MB

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const dir = searchParams.get('dir')
    const relativePath = searchParams.get('relativePath')
    let cwd = searchParams.get('cwd')
    if (!cwd) cwd = process.cwd()

    if (!dir || !relativePath) {
      throw new SidebarError('bad-request', 'missing "dir" or "relativePath" query param', 400)
    }

    if (!request.body) {
      throw new SidebarError('bad-request', 'missing request body', 400)
    }

    // Convert Web ReadableStream to AsyncIterable<Uint8Array>
    const stream = request.body as unknown as AsyncIterable<Uint8Array>
    const result = await writeWorkspaceUpload({
      cwd,
      dir,
      relativePath,
      chunks: stream,
      limit: UPLOAD_LIMIT,
    })

    return okResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
