'use strict'

// Next logs uncaught stream errors. If Electron crashes and closes its log pipes,
// logging EPIPE to the same pipe can recursively raise EPIPE and starve cleanup.
function installUiProcessLifecycle(proc = process, drain = () => {}) {
  // Run before Next's signal handler closes the listening socket.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const beginDrain = () => {
      drain()
      // A failed/early startup may not yet have installed Next's exit handler.
      if (proc.listeners(signal).every(listener => listener === beginDrain)) {
        proc.exit(signal === 'SIGTERM' ? 143 : 130)
      }
    }
    proc.prependListener(signal, beginDrain)
  }
  for (const stream of [proc.stdout, proc.stderr]) {
    stream?.on('error', error => {
      if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') throw error
    })
  }
  let stopping = false
  const parentGone = () => {
    if (stopping) return
    stopping = true
    // Dispatch through Next's normal signal cleanup (or the OS default if startup
    // failed before Next installed it). This signals only the current process.
    proc.kill(proc.pid, 'SIGTERM')
  }
  if (typeof proc.send === 'function') proc.once('disconnect', parentGone)
}
function runOwnedUiServer(boot) {
  const http = require('node:http')
  const { ownHttpDrain } = require('./ownedHttpDrain.cjs')
  const original = http.createServer
  const drains = []
  installUiProcessLifecycle(process, () => {
    for (const drain of drains) drain.begin()
  })
  // Capture only HTTP servers synchronously created by the standalone Next entry.
  // Restore the factory immediately: later project/preview servers are untouched.
  http.createServer = function (...args) {
    const server = original.apply(this, args)
    drains.push(ownHttpDrain(server))
    return server
  }
  try { return boot() } finally { http.createServer = original }
}
module.exports = { installUiProcessLifecycle, runOwnedUiServer }
