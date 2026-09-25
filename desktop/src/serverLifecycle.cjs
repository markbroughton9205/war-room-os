/**
 * War Room Desktop — runtime ownership verification (Linux).
 *
 * Electron spawns UI/Core children detached on Linux so they can outlive a crashed
 * Electron process for normal restart continuity. That same detachment means an
 * abnormal Electron death can leave a runtime process listening on 3847/3848. The
 * next launch must not treat "port already open" as license to reuse or kill blind —
 * it must positively identify the port owner via live /proc state before doing either.
 *
 * Authority order: live PID -> /proc/<pid>/cwd -> RUNTIME_MANIFEST.json in that cwd.
 * The lock file written by writeLockFile() is diagnostic only and never authorizes
 * a kill by itself (see readLockFile()).
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const MANIFEST_FILENAME = 'RUNTIME_MANIFEST.json'

function isProcessAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    if (err && err.code === 'EPERM') return true
    return false
  }
}

function readProcCwd(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    return null
  }
}

function readRuntimeManifest(runtimeRoot) {
  if (!runtimeRoot) return null
  try {
    const manifestPath = path.join(runtimeRoot, MANIFEST_FILENAME)
    if (!fs.existsSync(manifestPath)) return null
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Positive identification only: cwd + RUNTIME_MANIFEST.json. Never title/exe-name/port.
 *
 * desktop/runtime/boot-ui.cjs chdirs the packaged Next UI server into
 * `<runtimeRoot>/ui` after spawn (verified against the live running UI process's
 * /proc/<pid>/cwd), so the manifest sits one level above the UI child's actual cwd.
 * Core has no such chdir — its cwd is the runtime root directly. Checking the exact
 * known `ui` shape (not an unbounded walk-up) keeps this from drifting into a
 * pattern/name-based guess.
 */
function isWarRoomRuntime(pid) {
  const cwd = readProcCwd(pid)
  if (!cwd) return { verified: false, runtimeRoot: null, manifest: null }
  const directManifest = readRuntimeManifest(cwd)
  if (directManifest) return { verified: true, runtimeRoot: cwd, manifest: directManifest }
  if (path.basename(cwd) === 'ui') {
    const parent = path.dirname(cwd)
    const parentManifest = readRuntimeManifest(parent)
    if (parentManifest) return { verified: true, runtimeRoot: parent, manifest: parentManifest }
  }
  return { verified: false, runtimeRoot: cwd, manifest: null }
}

function listenInodesForPort(port) {
  const targetHex = port.toString(16).toUpperCase().padStart(4, '0')
  const inodes = new Set()
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let content
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of content.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/)
      const local = cols[1]
      const state = cols[3]
      const inode = cols[9]
      if (!local || !inode) continue
      const portHex = local.split(':')[1]
      if (portHex && portHex.toUpperCase() === targetHex && state === '0A') {
        inodes.add(inode)
      }
    }
  }
  return inodes
}

/**
 * Resolve the exact PID holding a listening socket on `port` via /proc introspection.
 * Never pkill/killall/name-matching. A process whose fd table this user cannot read
 * (permission denied) is silently skipped rather than guessed at — that yields
 * "unresolved" for that PID, not a false match.
 */
function findPidOwningPort(port) {
  if (process.platform !== 'linux') return null
  const inodes = listenInodesForPort(port)
  if (inodes.size === 0) return null
  let entries
  try {
    entries = fs.readdirSync('/proc')
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    let fds
    try {
      fds = fs.readdirSync(`/proc/${entry}/fd`)
    } catch {
      continue
    }
    for (const fd of fds) {
      let target
      try {
        target = fs.readlinkSync(`/proc/${entry}/fd/${fd}`)
      } catch {
        continue
      }
      const m = /^socket:\[(\d+)\]$/.exec(target)
      if (m && inodes.has(m[1])) return pid
    }
  }
  return null
}

/**
 * Classify the current owner of `port` relative to `currentRuntimeRoot`.
 * status is one of: SAME_RUNTIME | STALE_RUNTIME | UNKNOWN_OWNER.
 * UNKNOWN_OWNER covers every case where ownership could not be positively proven —
 * unresolved PID, unreadable cwd, missing/malformed manifest, or a race where the
 * PID died between resolution and verification. Callers must never kill on UNKNOWN_OWNER.
 */
function classifyPortOwner({ port, currentRuntimeRoot, log }) {
  const emit = typeof log === 'function' ? log : () => {}
  const pid = findPidOwningPort(port)
  if (pid == null) {
    return { status: 'UNKNOWN_OWNER', pid: null, runtimeRoot: null, manifest: null, sourceCommit: null, reason: 'pid_unresolved' }
  }
  emit(`PORT_OWNER_FOUND port=${port} pid=${pid}`)
  if (!isProcessAlive(pid)) {
    return { status: 'UNKNOWN_OWNER', pid, runtimeRoot: null, manifest: null, sourceCommit: null, reason: 'pid_not_alive_race' }
  }
  const identity = isWarRoomRuntime(pid)
  if (!identity.verified) {
    return { status: 'UNKNOWN_OWNER', pid, runtimeRoot: identity.runtimeRoot, manifest: null, sourceCommit: null, reason: 'not_war_room_runtime' }
  }
  const sourceCommit = typeof identity.manifest.source_commit === 'string' ? identity.manifest.source_commit : null
  emit(`WAR_ROOM_RUNTIME_VERIFIED port=${port} pid=${pid} runtimeRoot=${identity.runtimeRoot} sourceCommit=${sourceCommit || 'n/a'}`)
  const sameRoot = path.resolve(identity.runtimeRoot) === path.resolve(String(currentRuntimeRoot || ''))
  return {
    status: sameRoot ? 'SAME_RUNTIME' : 'STALE_RUNTIME',
    pid,
    runtimeRoot: identity.runtimeRoot,
    manifest: identity.manifest,
    sourceCommit,
  }
}

/**
 * Linux process start time (field 22 of /proc/<pid>/stat, in clock ticks since boot).
 * Two processes can share a PID number over time (the kernel recycles them), but not
 * the same start time — this is the standard technique for proving "the exact process
 * instance I looked at earlier" rather than just "some process with this PID number."
 */
function getProcessStartTicks(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2)
    const fields = afterComm.trim().split(/\s+/)
    return fields[19] || null
  } catch {
    return null
  }
}

/**
 * Snapshot a SAME_RUNTIME-verified owner at the moment reuse is adopted. Not a
 * ChildProcess — just the verified identity chain (pid, port, runtimeRoot) plus a
 * process-generation token, so shutdown can prove it's still the same process before
 * ever terminating it.
 */
function captureReusedOwnership({ pid, port, runtimeRoot }) {
  return {
    pid,
    port,
    runtimeRoot: path.resolve(String(runtimeRoot || '')),
    startTicks: getProcessStartTicks(pid),
    capturedAt: new Date().toISOString(),
  }
}

/**
 * Re-run the full verification chain (alive -> same process generation -> cwd/manifest
 * -> still owns the port) against a previously captured reused-ownership record. Only
 * an `ok: true` result may be passed to terminateVerifiedStaleRuntime(). Never consults
 * a lock file — that's diagnostic-only and must never authorize a kill.
 */
function reverifyReusedOwnership(record, { log } = {}) {
  const emit = typeof log === 'function' ? log : () => {}
  if (!record || typeof record.pid !== 'number') {
    return { ok: false, reason: 'no_record' }
  }
  if (!isProcessAlive(record.pid)) {
    return { ok: false, reason: 'pid_not_alive' }
  }
  const currentStartTicks = getProcessStartTicks(record.pid)
  if (!currentStartTicks || currentStartTicks !== record.startTicks) {
    return { ok: false, reason: 'generation_mismatch' }
  }
  const identity = isWarRoomRuntime(record.pid)
  if (!identity.verified) {
    return { ok: false, reason: 'identity_lost' }
  }
  if (path.resolve(identity.runtimeRoot) !== record.runtimeRoot) {
    return { ok: false, reason: 'runtime_root_mismatch' }
  }
  if (findPidOwningPort(record.port) !== record.pid) {
    return { ok: false, reason: 'port_ownership_changed' }
  }
  emit(`REUSED_OWNERSHIP_REVERIFIED port=${record.port} pid=${record.pid} runtimeRoot=${record.runtimeRoot}`)
  return { ok: true, reason: 'verified' }
}

/**
 * Terminate a positively-verified stale runtime PID: process-group SIGTERM, then
 * SIGKILL fallback if it hasn't exited. Mirrors killOwned()'s escalation but operates
 * on a bare verified PID (no live child handle) since the owning process belongs to a
 * prior launch, not this one. Callers must only pass a PID that classifyPortOwner
 * returned as STALE_RUNTIME.
 */
async function terminateVerifiedStaleRuntime(pid, options = {}) {
  if (process.platform !== 'linux') return false
  if (!isProcessAlive(pid)) return true
  const termTimeoutMs = options.termTimeoutMs || 3000
  const killTimeoutMs = options.killTimeoutMs || 2000
  const pollMs = options.pollMs || 100

  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* ignore */
    }
  }
  let deadline = Date.now() + termTimeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true
    await new Promise(r => setTimeout(r, pollMs))
  }

  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* ignore */
    }
  }
  deadline = Date.now() + killTimeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true
    await new Promise(r => setTimeout(r, pollMs))
  }
  return !isProcessAlive(pid)
}

function lockFilePath(runtimeDataDir, port) {
  return path.join(runtimeDataDir, `server-lifecycle-${port}.lock.json`)
}

/** Defense in depth only — see module header. Written after a successful owned spawn. */
function writeLockFile(runtimeDataDir, info) {
  try {
    fs.mkdirSync(runtimeDataDir, { recursive: true })
    const payload = {
      pid: info.pid,
      port: info.port,
      runtimeRoot: info.runtimeRoot,
      sourceCommit: info.sourceCommit ?? null,
      startedAt: info.startedAt || new Date().toISOString(),
      adopted: Boolean(info.adopted),
    }
    fs.writeFileSync(lockFilePath(runtimeDataDir, info.port), JSON.stringify(payload, null, 2))
    return true
  } catch {
    return false
  }
}

/** Malformed/missing/partial content returns null — never partially trusted. */
function readLockFile(runtimeDataDir, port) {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockFilePath(runtimeDataDir, port), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.port !== 'number' ||
      typeof parsed.runtimeRoot !== 'string'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function clearLockFile(runtimeDataDir, port) {
  try {
    fs.rmSync(lockFilePath(runtimeDataDir, port), { force: true })
    return true
  } catch {
    return false
  }
}

module.exports = {
  MANIFEST_FILENAME,
  isProcessAlive,
  readProcCwd,
  readRuntimeManifest,
  isWarRoomRuntime,
  findPidOwningPort,
  classifyPortOwner,
  getProcessStartTicks,
  captureReusedOwnership,
  reverifyReusedOwnership,
  terminateVerifiedStaleRuntime,
  lockFilePath,
  writeLockFile,
  readLockFile,
  clearLockFile,
}
