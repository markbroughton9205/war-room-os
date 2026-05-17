import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = join(__dirname, 'server.mjs')
const MIN_BACKOFF_MS = 2_000
const MAX_BACKOFF_MS = 60_000

let restartCount = Number.parseInt(process.env.WAR_ROOM_BRIDGE_RESTART_COUNT || '0', 10) || 0
let stopping = false

function nextBackoffMs(count) {
  return Math.min(MIN_BACKOFF_MS * 2 ** Math.min(count, 5), MAX_BACKOFF_MS)
}

function startBridge() {
  const lastRestartAt = restartCount > 0 ? new Date().toISOString() : process.env.WAR_ROOM_BRIDGE_LAST_RESTART_AT || ''
  const child = spawn(process.execPath, [SERVER_PATH], {
    stdio: 'inherit',
    env: {
      ...process.env,
      WAR_ROOM_BRIDGE_SUPERVISED: '1',
      WAR_ROOM_BRIDGE_LAUNCH_MODE: process.env.WAR_ROOM_BRIDGE_LAUNCH_MODE || 'supervised',
      WAR_ROOM_BRIDGE_RESTART_COUNT: String(restartCount),
      WAR_ROOM_BRIDGE_LAST_RESTART_AT: lastRestartAt,
    },
  })

  child.on('exit', (code, signal) => {
    if (stopping || code === 0) return
    restartCount += 1
    const backoffMs = nextBackoffMs(restartCount)
    console.error(`[bridge:supervisor] bridge exited (${signal ?? code}); restarting in ${backoffMs}ms`)
    setTimeout(startBridge, backoffMs)
  })
}

process.on('SIGINT', () => {
  stopping = true
  process.exit(0)
})

process.on('SIGTERM', () => {
  stopping = true
  process.exit(0)
})

console.log('[bridge:supervisor] starting Commander Node supervisor')
startBridge()
