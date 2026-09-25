/**
 * Foundry Workbench W0 host — spawn/stop/health for the Code-OSS REH-web Node server.
 * No model routing. No Tool Broker. No AI filesystem authority.
 */
'use strict'

const { spawn, spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { sanitizeWorkbenchEnv } = require('./sanitize-env.cjs')
const { resolveAllowedWorkspace, projectsRoot } = require('./allowlist.cjs')
const { writePolicy } = require('./policy.cjs')
const { installFoundryAdapter } = require('./install-adapter.cjs')
const { disableExtensionArgs: governedDisableArgs } = require('./governed-extensions.cjs')
const {
  FOUNDRY_WORKBENCH_HOST,
  FOUNDRY_WORKBENCH_PORT,
  FOUNDRY_WORKBENCH_FLAG,
  isFoundryWorkbenchW0Enabled,
} = require('./constants.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const RUNTIME = path.join(ROOT, 'desktop', 'runtime', 'workbench', 'openvscode-server')
const BIN = path.join(RUNTIME, 'bin', 'openvscode-server')
const NODE_BIN = path.join(RUNTIME, 'node')
const SERVER_MAIN = path.join(RUNTIME, 'out', 'server-main.js')

let ownedChild = null
let ownedPid = null
let ownedStartedAt = null
let stoppingOwned = false
let recovering = false
let crashRestarts = 0
const OWNER = 'war-room-desktop'
const TOKEN_LIFECYCLE = 'persist-across-desktop-sessions'

function redact(text) {
  return String(text || '')
    .replace(/tkn=[^&\s"']+/gi, 'tkn=[REDACTED]')
    .replace(/connection-token[= ]+\S+/gi, 'connection-token=[REDACTED]')
}

function stateDir() {
  if (process.env.FOUNDRY_WORKBENCH_STATE_DIR) return path.resolve(process.env.FOUNDRY_WORKBENCH_STATE_DIR)
  try {
    const { resolveAppDataPaths } = require('../src/appDataRoot.cjs')
    return path.join(resolveAppDataPaths().data, 'foundry', 'workbench')
  } catch {
    const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
    return path.join(xdg, 'war-room-os', 'data', 'foundry', 'workbench')
  }
}

function ensureStateDir() {
  const dir = stateDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(path.join(dir, 'user-data'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'server-data'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'extensions'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
  try { fs.chmodSync(dir, 0o700) } catch { /* best-effort */ }
  return dir
}

function tokenPath() {
  return path.join(ensureStateDir(), 'connection.token')
}

function pidPath() {
  return path.join(ensureStateDir(), 'server.pid')
}

function loadOrCreateToken() {
  const file = tokenPath()
  try {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (existing.length >= 24) return existing
  } catch {
    /* create */
  }
  const created = crypto.randomBytes(32).toString('base64url')
  fs.writeFileSync(file, created, { encoding: 'utf8', mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch { /* best-effort */ }
  return created
}

function readToken() {
  try {
    return fs.readFileSync(tokenPath(), 'utf8').trim()
  } catch {
    return null
  }
}

function requestedWorkspace() {
  if (process.env.FOUNDRY_WORKBENCH_W0_FOLDER?.trim()) return path.resolve(process.env.FOUNDRY_WORKBENCH_W0_FOLDER.trim())
  return path.join(projectsRoot(), 'w0-workbench-spike')
}

function fixtureRoot() {
  const allowed = resolveAllowedWorkspace(requestedWorkspace())
  if (!allowed.ok) return path.join(projectsRoot(), 'w0-workbench-spike')
  return allowed.folder
}

function ensureFixture() {
  const allowed = resolveAllowedWorkspace(fixtureRoot())
  if (!allowed.ok) {
    throw new Error(allowed.error)
  }
  const root = allowed.folder
  fs.mkdirSync(root, { recursive: true })
  const file = path.join(root, 'hello.ts')
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, 'export const W0_HELLO = "foundry-workbench"\n', 'utf8')
  }
  return root
}

function dirtyPath() {
  return path.join(ensureStateDir(), 'dirty-buffers.json')
}

function writeDirtyBuffers(paths) {
  const unique = [...new Set((Array.isArray(paths) ? paths : []).filter(item => typeof item === 'string'))]
  fs.writeFileSync(dirtyPath(), `${JSON.stringify({ paths: unique, updatedAt: new Date().toISOString() }, null, 2)}\n`)
  return unique
}

function readDirtyBuffers() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dirtyPath(), 'utf8'))
    return Array.isArray(parsed.paths) ? parsed.paths.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

function runtimeReady() {
  return fs.existsSync(BIN) && fs.existsSync(NODE_BIN) && fs.existsSync(SERVER_MAIN) && fs.existsSync(path.join(RUNTIME, 'product.json'))
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readPidFile() {
  try {
    const pid = Number(fs.readFileSync(pidPath(), 'utf8').trim())
    return Number.isInteger(pid) ? pid : null
  } catch {
    return null
  }
}

function writePidFile(pid) {
  fs.writeFileSync(pidPath(), String(pid), 'utf8')
}

function processCmdline(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
  } catch {
    return ''
  }
}

function isOwnedWorkbenchProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  const cmd = processCmdline(pid)
  return cmd.includes('desktop/runtime/workbench/openvscode-server')
    && (cmd.includes('server-main.js') || cmd.includes('openvscode-server'))
    && cmd.includes(`--port ${FOUNDRY_WORKBENCH_PORT}`)
    && cmd.includes('--host 127.0.0.1')
}

function descendantPids(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return []
  const out = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
  const kids = String(out.stdout || '').split(/\s+/).map(Number).filter(n => Number.isInteger(n) && n > 0)
  return [...kids, ...kids.flatMap(child => descendantPids(child))]
}

function portOwner() {
  const probe = spawnSync('ss', ['-ltnp'], { encoding: 'utf8' })
  const text = `${probe.stdout || ''}\n${probe.stderr || ''}`
  const line = text.split('\n').find(item => item.includes(`:${FOUNDRY_WORKBENCH_PORT}`) && item.includes('127.0.0.1'))
  if (!line) return null
  const match = /pid=(\d+)/.exec(line)
  return match ? Number(match[1]) : null
}

async function adoptOwnedListener(folder) {
  const owner = portOwner()
  if (!owner || !isOwnedWorkbenchProcess(owner) || !pidAlive(owner)) return null
  ownedPid = owner
  writePidFile(owner)
  const token = readToken() || loadOrCreateToken()
  const ready = await waitReady(token, 8000)
  return publicHealth({
    ok: ready.ok,
    ready: ready.ok,
    reused: true,
    pid: owner,
    folder,
    nakedStatus: ready.naked,
    authedStatus: ready.authed,
  })
}

function listenExclusive() {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', err => {
      resolve({ ok: false, code: err && err.code })
    })
    server.listen({ host: FOUNDRY_WORKBENCH_HOST, port: FOUNDRY_WORKBENCH_PORT, exclusive: true }, () => {
      server.close(() => resolve({ ok: true }))
    })
  })
}

function httpGet(pathname, token) {
  return new Promise(resolve => {
    const req = http.request({
      host: FOUNDRY_WORKBENCH_HOST,
      port: FOUNDRY_WORKBENCH_PORT,
      path: pathname || '/',
      method: 'GET',
      timeout: 2500,
      headers: token ? { Cookie: `vscode-tkn=${token}` } : {},
    }, res => {
      res.resume()
      resolve({ status: res.statusCode || 0 })
    })
    req.on('error', () => resolve({ status: 0 }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0 })
    })
    req.end()
  })
}

async function waitReady(token, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const naked = await httpGet('/')
    if (naked.status === 403 || naked.status === 401) {
      const authed = await httpGet(`/?tkn=${encodeURIComponent(token)}`, token)
      if (authed.status && authed.status < 500) return { ok: true, naked: naked.status, authed: authed.status }
    }
    if (naked.status === 200) {
      const authed = await httpGet(`/?tkn=${encodeURIComponent(token)}`, token)
      return { ok: true, naked: naked.status, authed: authed.status }
    }
    await new Promise(r => setTimeout(r, 250))
  }
  return { ok: false, error: 'workbench did not become ready' }
}

function publicHealth(extra = {}) {
  return {
    enabled: isFoundryWorkbenchW0Enabled(),
    ready: extra.ready === true,
    bind: FOUNDRY_WORKBENCH_HOST,
    port: FOUNDRY_WORKBENCH_PORT,
    folder: extra.folder || fixtureRoot(),
    pid: extra.pid || ownedPid || readPidFile(),
    runtimeReady: runtimeReady(),
    owner: OWNER,
    startedAt: extra.startedAt || ownedStartedAt,
    recovering: recovering === true,
    tokenLifecycle: TOKEN_LIFECYCLE,
    authenticatedUrl: undefined,
    token: undefined,
    ...extra,
  }
}

function authenticatedUrl(token) {
  return `http://${FOUNDRY_WORKBENCH_HOST}:${FOUNDRY_WORKBENCH_PORT}/?tkn=${encodeURIComponent(token)}&folder=${encodeURIComponent(fixtureRoot())}`
}

async function startOwned(options = {}) {
  if (!isFoundryWorkbenchW0Enabled() && options.force !== true) {
    return publicHealth({ ok: false, error: `${FOUNDRY_WORKBENCH_FLAG} is off`, ready: false })
  }
  if (!runtimeReady()) {
    return publicHealth({ ok: false, error: 'workbench runtime is not prepared', ready: false })
  }
  const allowed = resolveAllowedWorkspace(requestedWorkspace())
  if (!allowed.ok) {
    return publicHealth({ ok: false, error: allowed.error, code: allowed.code, ready: false })
  }
  const folder = ensureFixture()
  const earlyDir = ensureStateDir()
  writePolicy(path.join(earlyDir, 'user-data'))
  installFoundryAdapter(path.join(earlyDir, 'extensions'), earlyDir)
  const existingPid = readPidFile()
  if (existingPid && pidAlive(existingPid) && isOwnedWorkbenchProcess(existingPid)) {
    ownedPid = existingPid
    const token = readToken()
    const ready = token ? await waitReady(token, 8000) : { ok: false }
    return publicHealth({
      ok: ready.ok,
      ready: ready.ok,
      reused: true,
      pid: existingPid,
      folder,
      nakedStatus: ready.naked,
      authedStatus: ready.authed,
    })
  }
  const adopted = await adoptOwnedListener(folder)
  if (adopted) return adopted
  const free = await listenExclusive()
  if (!free.ok) {
    const retry = await adoptOwnedListener(folder)
    if (retry) return retry
    const owner = portOwner()
    if (owner && !isOwnedWorkbenchProcess(owner)) {
      return publicHealth({
        ok: false,
        ready: false,
        code: 'FOREIGN_PORT_OWNER',
        error: `port ${FOUNDRY_WORKBENCH_PORT} occupied by foreign pid ${owner}; fail closed`,
        foreignPid: owner,
      })
    }
    return publicHealth({ ok: false, error: `port ${FOUNDRY_WORKBENCH_PORT} busy pid=${owner}`, ready: false })
  }
  const dir = ensureStateDir()
  writePolicy(path.join(dir, 'user-data'))
  installFoundryAdapter(path.join(dir, 'extensions'), dir)
  const token = loadOrCreateToken()
  const args = [
    '--host', FOUNDRY_WORKBENCH_HOST,
    '--port', String(FOUNDRY_WORKBENCH_PORT),
    '--connection-token-file', tokenPath(),
    '--user-data-dir', path.join(dir, 'user-data'),
    '--server-data-dir', path.join(dir, 'server-data'),
    '--extensions-dir', path.join(dir, 'extensions'),
    '--default-folder', folder,
    '--disable-workspace-trust',
    '--accept-server-license-terms',
    '--disable-telemetry',
    '--telemetry-level', 'off',
    '--enable-proposed-api', 'foundry.foundry-adapter',
    ...governedDisableArgs(dir),
  ]
  stoppingOwned = false
  recovering = false
  const child = spawn(NODE_BIN, [SERVER_MAIN, ...args], {
    cwd: RUNTIME,
    env: sanitizeWorkbenchEnv(process.env),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })
  ownedChild = child
  ownedPid = child.pid
  ownedStartedAt = new Date().toISOString()
  writePidFile(child.pid)
  const logFile = path.join(dir, 'logs', 'server.log')
  const log = fs.createWriteStream(logFile, { flags: 'a' })
  child.stdout.on('data', chunk => { try { log.write(redact(String(chunk))) } catch { /* ignore */ } })
  child.stderr.on('data', chunk => { try { log.write(redact(String(chunk))) } catch { /* ignore */ } })
  child.on('exit', () => {
    if (ownedPid === child.pid) {
      ownedChild = null
      ownedPid = null
      try { fs.unlinkSync(pidPath()) } catch { /* ignore */ }
    }
    try { log.end() } catch { /* ignore */ }
    if (!stoppingOwned && isFoundryWorkbenchW0Enabled() && crashRestarts < 2) {
      crashRestarts += 1
      recovering = true
      setTimeout(() => {
        void startOwned({ force: true }).then(() => { recovering = false }).catch(() => { recovering = true })
      }, 400)
    }
  })
  const ready = await waitReady(token, options.timeoutMs || 25000)
  if (!ready.ok) {
    await stopOwned()
    return publicHealth({ ok: false, error: ready.error, ready: false, folder })
  }
  const result = publicHealth({
    ok: true,
    ready: true,
    pid: child.pid,
    folder,
    nakedStatus: ready.naked,
    authedStatus: ready.authed,
    startedAt: ownedStartedAt,
    owner: OWNER,
  })
  if (options.includeSecrets === true) result.authenticatedUrl = authenticatedUrl(token)
  return result
}

async function stopOwned() {
  stoppingOwned = true
  recovering = false
  crashRestarts = 0
  const listener = portOwner()
  const seeds = [ownedPid, readPidFile(), listener]
    .filter((pid, index, all) => Number.isInteger(pid) && all.indexOf(pid) === index)
    .filter(pid => pid === ownedPid || isOwnedWorkbenchProcess(pid))
  const pids = [...new Set(seeds.flatMap(pid => [pid, ...descendantPids(pid)]))]
  for (const pid of pids) {
    if (!pidAlive(pid)) continue
    try { process.kill(pid, 'SIGTERM') } catch { /* ignore */ }
  }
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    if (pids.every(pid => !pidAlive(pid))) break
    await new Promise(r => setTimeout(r, 100))
  }
  for (const pid of pids) {
    if (pidAlive(pid)) {
      try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
    }
  }
  ownedChild = null
  ownedPid = null
  ownedStartedAt = null
  try { fs.unlinkSync(pidPath()) } catch { /* ignore */ }
  return publicHealth({ ok: true, ready: false, stopped: true, owner: OWNER })
}

async function health() {
  const pid = ownedPid || readPidFile()
  const token = readToken()
  const naked = await httpGet('/')
  const authed = token ? await httpGet(`/?tkn=${encodeURIComponent(token)}`, token) : { status: 0 }
  const ready = pidAlive(pid) && (naked.status === 401 || naked.status === 403 || (naked.status > 0 && authed.status > 0 && authed.status < 500))
  return publicHealth({
    ok: true,
    ready,
    pid,
    nakedStatus: naked.status,
    authedStatus: authed.status,
    authRequired: naked.status === 401 || naked.status === 403 || (naked.status === 200 && authed.status === 200),
  })
}

async function restartOwned(options = {}) {
  await stopOwned()
  await new Promise(r => setTimeout(r, 350))
  return startOwned(options)
}

function secretsForHost() {
  const token = readToken() || loadOrCreateToken()
  return { tokenPresent: true, authenticatedUrl: authenticatedUrl(token) }
}

module.exports = {
  FOUNDRY_WORKBENCH_HOST,
  FOUNDRY_WORKBENCH_PORT,
  FOUNDRY_WORKBENCH_FLAG,
  BIN,
  RUNTIME,
  OWNER,
  TOKEN_LIFECYCLE,
  isFoundryWorkbenchW0Enabled,
  runtimeReady,
  ensureFixture,
  fixtureRoot,
  requestedWorkspace,
  startOwned,
  stopOwned,
  restartOwned,
  health,
  secretsForHost,
  readToken,
  publicHealth,
  httpGet,
  stateDir,
  redact,
  writeDirtyBuffers,
  readDirtyBuffers,
  resolveAllowedWorkspace,
}
