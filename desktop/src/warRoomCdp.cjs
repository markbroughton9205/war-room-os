/**
 * War Room-owned loopback CDP endpoint.
 * Never assumes exclusive ownership of 9222 (Cursor may already hold it).
 * Never binds 0.0.0.0 / LAN / public. Never kills other processes.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { resolveAppDataPaths } = require('./appDataRoot.cjs')

const LOOPBACK = '127.0.0.1'
const PREFERRED_PORT = 9222
const RANGE_START = 9230
const RANGE_END = 9249
const DESKTOP_RUNTIME_FILE = 'desktop-runtime.json'

function desktopRuntimePath(runtimeDirOverride) {
  const runtimeDir = runtimeDirOverride || resolveAppDataPaths().runtime
  return path.join(runtimeDir, DESKTOP_RUNTIME_FILE)
}

function readDesktopRuntime(runtimeDirOverride) {
  try {
    const parsed = JSON.parse(fs.readFileSync(desktopRuntimePath(runtimeDirOverride), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function persistDesktopRuntime(record, runtimeDirOverride) {
  const runtimeDir = runtimeDirOverride || resolveAppDataPaths().runtime
  fs.mkdirSync(runtimeDir, { recursive: true })
  const dest = path.join(runtimeDir, DESKTOP_RUNTIME_FILE)
  const tmp = `${dest}.tmp-${process.pid}`
  const body = {
    cdpAddress: LOOPBACK,
    bind: LOOPBACK,
    cdpPort: record.cdpPort,
    pid: record.pid ?? process.pid,
    selectedAt: record.selectedAt ?? new Date().toISOString(),
    preferredPort: PREFERRED_PORT,
    range: { start: RANGE_START, end: RANGE_END },
    allocation: record.allocation ?? 'range',
    cursorPortCollision: record.cursorPortCollision === true,
    ephemeral: record.ephemeral === true,
  }
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8')
  fs.renameSync(tmp, dest)
  return body
}

function loopbackPortInUse(port) {
  const n = Number(port)
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return true
  const script = [
    'const net=require("net");',
    'const s=net.createServer();',
    's.once("error",(e)=>{process.stdout.write("1");});',
    `s.listen({host:${JSON.stringify(LOOPBACK)},port:${n},exclusive:true},()=>{s.close(()=>{process.stdout.write("0");});});`,
  ].join('')
  try {
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 1200 })
    if (String(r.stdout).trim() === '0') return false
  } catch {
    /* fail closed */
  }
  return true
}

function uniquePorts(ports) {
  const seen = new Set()
  const out = []
  for (const port of ports) {
    const n = Number(port)
    if (!Number.isInteger(n) || n <= 0 || n > 65535) continue
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

function candidatePorts(runtimeDirOverride) {
  const envPort = Number(process.env.WAR_ROOM_CDP_PORT)
  const persisted = readDesktopRuntime(runtimeDirOverride)
  const ports = []
  if (Number.isInteger(envPort) && envPort > 0) ports.push(envPort)
  if (Number.isInteger(Number(persisted?.cdpPort)) && Number(persisted.cdpPort) > 0) ports.push(Number(persisted.cdpPort))
  ports.push(PREFERRED_PORT)
  for (let port = RANGE_START; port <= RANGE_END; port += 1) ports.push(port)
  return uniquePorts(ports)
}

function bindEphemeralLoopback() {
  const script = [
    'const net=require("net");',
    'const s=net.createServer();',
    `s.listen({host:${JSON.stringify(LOOPBACK)},port:0,exclusive:true},()=>{`,
    'const p=s.address().port;s.close(()=>{process.stdout.write(String(p));});',
    '});',
  ].join('')
  try {
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 1500 })
    const port = Number(String(r.stdout).trim())
    if (Number.isInteger(port) && port > 0) return port
  } catch {
    /* ignore */
  }
  return 0
}

function claimWarRoomCdpEndpoint(options) {
  const runtimeDirOverride = options?.runtimeDirOverride
  const occupiedPreferred = loopbackPortInUse(PREFERRED_PORT)
  for (const port of candidatePorts(runtimeDirOverride)) {
    if (loopbackPortInUse(port)) continue
    const allocation = port === PREFERRED_PORT ? 'preferred' : (port >= RANGE_START && port <= RANGE_END ? 'range' : 'configured')
    return persistDesktopRuntime({
      cdpPort: port,
      allocation,
      cursorPortCollision: occupiedPreferred && port !== PREFERRED_PORT,
      ephemeral: false,
      pid: process.pid,
    }, runtimeDirOverride)
  }
  const ephemeral = bindEphemeralLoopback()
  if (ephemeral > 0) {
    return persistDesktopRuntime({
      cdpPort: ephemeral,
      allocation: 'ephemeral',
      cursorPortCollision: occupiedPreferred,
      ephemeral: true,
      pid: process.pid,
    }, runtimeDirOverride)
  }
  return persistDesktopRuntime({
    cdpPort: 0,
    allocation: 'ephemeral',
    cursorPortCollision: occupiedPreferred,
    ephemeral: true,
    pid: process.pid,
  }, runtimeDirOverride)
}

function recordResolvedCdpPort(port, runtimeDirOverride) {
  const n = Number(port)
  if (!Number.isInteger(n) || n <= 0) return readDesktopRuntime(runtimeDirOverride)
  const previous = readDesktopRuntime(runtimeDirOverride) || {}
  return persistDesktopRuntime({
    ...previous,
    cdpPort: n,
    ephemeral: previous.ephemeral === true && n === 0,
    allocation: previous.allocation || 'ephemeral',
    cursorPortCollision: previous.cursorPortCollision === true,
    pid: process.pid,
  }, runtimeDirOverride)
}

module.exports = {
  LOOPBACK,
  PREFERRED_PORT,
  RANGE_START,
  RANGE_END,
  DESKTOP_RUNTIME_FILE,
  desktopRuntimePath,
  readDesktopRuntime,
  persistDesktopRuntime,
  loopbackPortInUse,
  candidatePorts,
  claimWarRoomCdpEndpoint,
  recordResolvedCdpPort,
}
