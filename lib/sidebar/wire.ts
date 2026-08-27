import { NextResponse } from 'next/server'

export type SidebarErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'forbidden'
  | 'method-error'
  | 'too-large'
  | 'fs-error'
  | 'git-error'
  | 'pty-error'
  | 'pty-deps-missing'
  | 'job-error'
  | 'sidechat-error'
  | 'subagents-unavailable'
  | 'settings-rejected'
  | 'settings-conflict'
  | 'internal'

export class SidebarError extends Error {
  constructor(
    readonly code: SidebarErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export interface SidebarOk<T> {
  ok: true
  value: T
}

export interface SidebarErr {
  ok: false
  error: {
    code: SidebarErrorCode
    message: string
  }
}

export function okResponse<T>(value: T, init?: ResponseInit): NextResponse<SidebarOk<T>> {
  return NextResponse.json({ ok: true, value }, { status: 200, ...init })
}

export function errorResponse(error: unknown): NextResponse<SidebarErr> {
  if (error instanceof SidebarError) {
    return NextResponse.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  const message = error instanceof Error ? error.message : String(error)
  return NextResponse.json(
    { ok: false, error: { code: 'internal', message } },
    { status: 500 },
  )
}

export function requireString(payload: unknown, key: string): string {
  const record = payload as Record<string, unknown> | null
  const value = record?.[key]
  if (typeof value !== 'string' || value === '') {
    throw new SidebarError('bad-request', `missing or invalid "${key}"`)
  }
  return value
}

export function optionalString(payload: unknown, key: string): string | undefined {
  const record = payload as Record<string, unknown> | null
  const value = record?.[key]
  if (typeof value === 'string' && value !== '') {
    return value
  }
  return undefined
}
