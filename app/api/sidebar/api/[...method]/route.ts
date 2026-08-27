import { NextRequest } from 'next/server'
import { dispatchSidebarMethod } from '@/lib/sidebar/dispatcher'
import { okResponse, errorResponse, SidebarError } from '@/lib/sidebar/wire'

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ method: string[] }> },
) {
  try {
    const { method } = await props.params
    const methodName = method.join('.')
    let payload: unknown = {}
    try {
      payload = await request.json()
    } catch {
      payload = {}
    }
    const result = await dispatchSidebarMethod(methodName, payload)
    return okResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function GET() {
  return errorResponse(new SidebarError('bad-request', 'sidebar api requires POST method', 405))
}
