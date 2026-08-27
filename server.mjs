import http from 'node:http'
import { parse } from 'node:url'
import next from 'next'
import { createSidebarWebSocketServer } from './lib/sidebar/ws-terminal.js'

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.PI_WEB_HOSTNAME || '127.0.0.1'
const port = parseInt(process.env.PORT || '30141', 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true)
      await handle(req, res, parsedUrl)
    } catch (err) {
      console.error('Error occurred handling', req.url, err)
      res.statusCode = 500
      res.end('internal server error')
    }
  })

  const { handleUpgrade } = createSidebarWebSocketServer()

  server.on('upgrade', (req, socket, head) => {
    if (handleUpgrade(req, socket, head)) {
      return
    }
    socket.destroy()
  })

  server.listen(port, hostname, () => {
    console.log(`> Pi Web with BetterSidebar ready on http://${hostname}:${port}`)
  })
})
