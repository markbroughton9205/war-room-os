'use strict'

// server.close() closes the listener but an active keep-alive connection can
// finish a request and immediately accept the next poll. Fence requests FIRST,
// then let each accepted response finish with a graceful connection close.
function ownHttpDrain(server) {
  let draining = false
  const sockets = new Set()
  const responses = new Map()
  const originalEmit = server.emit
  const closeAfterResponse = response => {
    response.shouldKeepAlive = false
    if (!response.headersSent) response.setHeader('Connection', 'close')
  }
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.emit = function (name, ...args) {
    if (name === 'request') {
      const [request, response] = args
      if (draining) {
        closeAfterResponse(response)
        response.writeHead(503, { 'Content-Type': 'text/plain' })
        response.end('War Room is shutting down.\n')
        return true
      }
      const socket = request.socket
      responses.set(response, socket)
      response.once('finish', () => {
        responses.delete(response)
        if (draining && !socket.destroyed) socket.destroySoon()
      })
      response.once('close', () => responses.delete(response))
    }
    return originalEmit.call(this, name, ...args)
  }
  return {
    begin() {
      if (draining) return
      draining = true
      for (const response of responses.keys()) closeAfterResponse(response)
      // Node's HTTP Connection: close path uses destroySoon(): flush queued
      // writes, then close this owned connection. end() alone only sends FIN
      // and strands server.close() if a peer keeps its writable half open.
      // Never close a socket here while an accepted response is still active.
      for (const socket of sockets) {
        if (![...responses.values()].includes(socket) && !socket.destroyed) socket.destroySoon()
      }
    },
    snapshot: () => ({ draining, connections: sockets.size, activeResponses: responses.size }),
  }
}
module.exports = { ownHttpDrain }
