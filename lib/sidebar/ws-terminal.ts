import { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { getPtyManager } from './pty-singleton'
import { PTY_DEPS_MISSING } from './pty-deps'
import { resolve } from 'node:path'

function clampDims(cols: number, rows: number): { cols: number; rows: number } {
  return {
    cols: Math.max(10, Math.min(cols, 500)),
    rows: Math.max(2, Math.min(rows, 200)),
  }
}

export function attachTerminalWs(ws: WebSocket, req: IncomingMessage): void {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const sessionId = url.searchParams.get('sessionId') || 'default'
    const tabId = url.searchParams.get('tab') || 'terminal'
    const requestedCwd = url.searchParams.get('cwd')
    const cwd = requestedCwd ? resolve(requestedCwd) : process.cwd()

    const ptyManager = getPtyManager()
    if (!ptyManager) {
      ws.close(1011, PTY_DEPS_MISSING)
      return
    }

    const handle = ptyManager.open(sessionId, tabId, cwd, 80, 24)

    if (handle.transcript !== '') {
      ws.send(handle.transcript)
    }

    const onData = (data: string): void => {
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 4 * 1024 * 1024) {
        ws.send(data)
      }
    }

    const onExit = ({ exitCode }: { exitCode: number; signal?: number }): void => {
      onData(`\r\n[process exited with code ${String(exitCode)}]\r\n`)
    }

    const dataSub = handle.pty.onData(onData)
    const exitSub = handle.pty.onExit(onExit)

    ws.on('message', (data) => {
      const text = data.toString('utf8')
      let control: { type?: unknown; cols?: unknown; rows?: unknown } | null = null
      try {
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed === 'object') {
          control = parsed as { type?: unknown; cols?: unknown; rows?: unknown }
        }
      } catch {
        // Raw text input
      }

      if (control !== null && control.type === 'close') {
        ptyManager.scheduleClose(handle.key, 0)
        return
      }

      if (control !== null && control.type === 'park') {
        ptyManager.park(handle.key)
        return
      }

      if (handle.exited) return

      if (
        control !== null &&
        control.type === 'resize' &&
        typeof control.cols === 'number' &&
        typeof control.rows === 'number'
      ) {
        const dims = clampDims(control.cols, control.rows)
        handle.pty.resize(dims.cols, dims.rows)
      } else {
        handle.pty.write(text)
      }
    })

    ws.on('close', () => {
      try {
        dataSub.dispose()
        exitSub.dispose()
      } catch {
        // Disposed
      }
      ptyManager.scheduleClose(handle.key, 10000)
    })
  } catch (error) {
    ws.close(1011, error instanceof Error ? error.message : String(error))
  }
}

export function createSidebarWebSocketServer() {
  const wss = new WebSocketServer({ noServer: true })

  const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/sidebar/ws/terminal') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        attachTerminalWs(ws, req)
      })
      return true
    }
    return false
  }

  return { wss, handleUpgrade }
}
