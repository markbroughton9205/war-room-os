import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = join(__dirname, 'server.mjs')
const RUNTIME_DIR = join(__dirname, '.runtime')
const LOG_DIR = join(RUNTIME_DIR, 'logs')
const PID_PATH = join(RUNTIME_DIR, 'bridge.pid')
const LOG_PATH = join(LOG_DIR, 'commander-bridge.log')
const CRASH_HISTORY_PATH = join(RUNTIME_DIR, 'crash-history.jsonl')
const RECONNECT_HISTORY_PATH = join(RUNTIME_DIR, 'reconnect-history.jsonl')
const MIN_BACKOFF_MS = 2_000
const MAX_BACKOFF_MS = 60_000
const MAX_LOG_BYTES = 1024 * 1024

let restartCount = Number.parseInt(process.env.WAR_ROOM_BRIDGE_RESTART_COUNT || '0', 10) || 0
let stopping = false
let lastCrashReason = process.env.WAR_ROOM_BRIDGE_LAST_CRASH_REASON || ''

function nextBackoffMs(count) {
  return Math.min(MIN_BACKOFF_MS * 2 ** Math.min(count, 5), MAX_BACKOFF_MS)
}

function ensureRuntimeDir() {
  mkdirSync(LOG_DIR, { recursive: true })
}

function pidIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function acquireLock() {
  ensureRuntimeDir()
  if (existsSync(PID_PATH)) {
    const existingPid = Number.parseInt(readFileSync(PID_PATH, 'utf8').trim(), 10)
    if (pidIsRunning(existingPid)) {
      console.error(`[bridge:supervisor] another Commander Node supervisor is already running as PID ${existingPid}`)
      process.exit(1)
    }
  }
  writeFileSync(PID_PATH, `${process.pid}\n`, { encoding: 'utf8' })
}

function releaseLock() {
  try {
    const existingPid = Number.parseInt(readFileSync(PID_PATH, 'utf8').trim(), 10)
    if (existingPid === process.pid) rmSync(PID_PATH, { force: true })
  } catch {
    // Lock cleanup is best effort during shutdown.
  }
}

function rotateLogIfNeeded() {
  try {
    if (!existsSync(LOG_PATH)) return
    const size = readFileSync(LOG_PATH).byteLength
    if (size < MAX_LOG_BYTES) return
    renameSync(LOG_PATH, join(LOG_DIR, `commander-bridge-${Date.now()}.log`))
  } catch {
    // Logging must never prevent supervisor recovery.
  }
}

function logLine(message) {
  rotateLogIfNeeded()
  const line = `[${new Date().toISOString()}] ${message}\n`
  process.stdout.write(line)
  void appendFile(LOG_PATH, line).catch(() => undefined)
}

function appendJsonLine(path, value) {
  void appendFile(path, `${JSON.stringify(value)}\n`).catch(() => undefined)
}

function startBridge() {
  const lastRestartAt = restartCount > 0 ? new Date().toISOString() : process.env.WAR_ROOM_BRIDGE_LAST_RESTART_AT || ''
  rotateLogIfNeeded()
  const output = createWriteStream(LOG_PATH, { flags: 'a' })
  const child = spawn(process.execPath, [SERVER_PATH], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      WAR_ROOM_BRIDGE_SUPERVISED: '1',
      WAR_ROOM_BRIDGE_LAUNCH_MODE: process.env.WAR_ROOM_BRIDGE_LAUNCH_MODE || 'supervised',
      WAR_ROOM_BRIDGE_SERVICE_MODE: process.env.WAR_ROOM_BRIDGE_SERVICE_MODE || '0',
      WAR_ROOM_BRIDGE_STARTUP_MODE: process.env.WAR_ROOM_BRIDGE_STARTUP_MODE || 'manual',
      WAR_ROOM_BRIDGE_RESTART_COUNT: String(restartCount),
      WAR_ROOM_BRIDGE_LAST_RESTART_AT: lastRestartAt,
      WAR_ROOM_BRIDGE_LAST_CRASH_REASON: lastCrashReason,
      WAR_ROOM_BRIDGE_LOG_PATH: relative(join(__dirname, '..', '..'), LOG_PATH).replace(/\\/g, '/'),
    },
  })

  child.stdout?.pipe(output, { end: false })
  child.stderr?.pipe(output, { end: false })

  child.on('exit', (code, signal) => {
    output.end()
    if (stopping || code === 0) return
    restartCount += 1
    const backoffMs = nextBackoffMs(restartCount)
    lastCrashReason = `bridge exited with ${signal ?? code}`
    logLine(`[bridge:supervisor] ${lastCrashReason}; restarting in ${backoffMs}ms`)
    appendJsonLine(CRASH_HISTORY_PATH, {
      at: new Date().toISOString(),
      restartCount,
      reason: lastCrashReason,
      backoffMs,
    })
    appendJsonLine(RECONNECT_HISTORY_PATH, {
      at: new Date().toISOString(),
      restartCount,
      backoffMs,
      state: 'scheduled_restart',
    })
    setTimeout(startBridge, backoffMs)
  })
}

process.on('SIGINT', () => {
  stopping = true
  releaseLock()
  process.exit(0)
})

process.on('SIGTERM', () => {
  stopping = true
  releaseLock()
  process.exit(0)
})

process.on('exit', releaseLock)

acquireLock()
logLine('[bridge:supervisor] starting Commander Node supervisor')
startBridge()
