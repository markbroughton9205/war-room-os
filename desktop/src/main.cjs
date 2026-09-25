/**
 * War Room Desktop — Electron main (Phase 11D installable Windows app).
 * Packaged: starts owned Core + Next from resources/runtime (repo-independent).
 * Dev: may use repo checkout runtimes.
 * Never opens https://warroomos.com. Never kills prod/DEV/cloudflared/Ollama.
 */
const { app, BrowserWindow, shell, ipcMain, nativeImage, session } = require('electron')
const path = require('node:path')
const { spawn } = require('node:child_process')
const net = require('node:net')
const fs = require('node:fs')
const { applyWindowsUserEnvironmentToProcess, presenceSummary } = require('./windowsUserEnv.cjs')
const { applyCouncilRoutingDefault } = require('./councilRoutingBootstrap.cjs')
const { resolveAppDataRoot, resolveAppDataPaths } = require('./appDataRoot.cjs')
const serverLifecycle = require('./serverLifecycle.cjs')
const desktopTrust = require('./desktopTrust.cjs')
const { resolveRendererSandbox } = require('./rendererSandbox.cjs')
const warRoomBrowser = require('./warRoomBrowser.cjs')
const warRoomCdp = require('./warRoomCdp.cjs')
const foundryWorkbenchView = require('./foundryWorkbench.cjs')
const foundryWorkbenchHost = require('../workbench-host/index.cjs')
const hvsNavigation = require('./hvsNavigation.cjs')

app.commandLine.appendSwitch('force-renderer-accessibility', 'complete')
app.commandLine.appendSwitch('enable-features', 'AccessibilityObjectModel,RendererAccessibility')
// W1: never normalize Chromium sandbox bypass flags as production policy. Guest workbench remains sandboxed.
const REMOTE_DEBUGGING_ADDRESS = '127.0.0.1'
const claimedCdp = process.platform === 'linux' ? warRoomCdp.claimWarRoomCdpEndpoint() : null
const REMOTE_DEBUGGING_PORT = claimedCdp ? String(claimedCdp.cdpPort) : ''
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'x11')
  app.commandLine.appendSwitch('ozone-platform', 'x11')
  app.commandLine.appendSwitch('remote-debugging-address', REMOTE_DEBUGGING_ADDRESS)
  if (REMOTE_DEBUGGING_PORT) {
    app.commandLine.appendSwitch('remote-debugging-port', REMOTE_DEBUGGING_PORT)
  }
  process.env.GDK_BACKEND = 'x11'
  const modules = String(process.env.GTK_MODULES || '')
  if (!modules.includes('atk-bridge')) {
    process.env.GTK_MODULES = [modules, 'gail:atk-bridge'].filter(Boolean).join(':')
  }
  process.env.GNOME_ACCESSIBILITY = '1'
  process.env.ACCESSIBILITY_ENABLED = '1'
}
try { app.setName('War Room OS') } catch { /* ignore */ }

const LOCAL_UI_ORIGIN = process.env.WAR_ROOM_LOCAL_UI_ORIGIN || 'http://127.0.0.1:3848'
const LOCAL_CORE_ORIGIN = process.env.WAR_ROOM_LOCAL_CORE_ORIGIN || 'http://127.0.0.1:3847'
const PUBLIC_HOSTS = new Set(['warroomos.com', 'www.warroomos.com'])
const ALLOWED_PORTS = new Set([3847, 3848, 3849, 3000, 3001])

let ownedUiChild = null
let ownedCoreHandle = null
let ownedCoreChild = null
let mainWindow = null
let browserSurface = null
let workbenchSurface = null
// SAME_RUNTIME-verified processes this instance reused rather than spawned. Not a
// ChildProcess — see serverLifecycle.captureReusedOwnership(). Re-verified in full
// before shutdown is ever allowed to terminate either one.
let reusedUiOwnership = null
let reusedCoreOwnership = null

function isPackaged() {
  return app.isPackaged === true
}

function linuxChromeSandboxStatus() {
  const prepare = require('../workbench-host/prepare-linux-chrome-sandbox.cjs')
  const candidates = [
    path.join(path.dirname(process.execPath), 'chrome-sandbox'),
    isPackaged() ? path.join(process.resourcesPath || '', '..', 'chrome-sandbox') : '',
    path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'chrome-sandbox'),
  ].filter(Boolean)
  const helper = candidates.find(item => fs.existsSync(item)) || candidates[candidates.length - 1]
  return prepare.inspectHelper(helper)
}

function resolveIconPath() {
  const windowsCandidates = [
    path.join(__dirname, '..', 'assets', 'war-room-os.ico'),
    path.join(process.resourcesPath || '', 'assets', 'war-room-os.ico'),
    path.join(__dirname, '..', 'assets', 'war-room-os-icon.png'),
    path.join(process.resourcesPath || '', 'assets', 'war-room-os-icon.png'),
  ]
  const linuxCandidates = [
    path.join(__dirname, '..', 'assets', 'war-room-os.png'),
    path.join(process.resourcesPath || '', 'assets', 'war-room-os.png'),
    path.join(__dirname, '..', 'assets', 'war-room-os-icon.png'),
    path.join(process.resourcesPath || '', 'assets', 'war-room-os-icon.png'),
  ]
  const candidates = process.platform === 'win32' ? windowsCandidates : linuxCandidates
  return candidates.find(p => p && fs.existsSync(p)) || null
}

function runtimeRoot() {
  if (isPackaged()) {
    return path.join(process.resourcesPath, 'runtime')
  }
  // Dev: prefer prepared desktop/runtime, else repo
  const prepared = path.join(__dirname, '..', 'runtime')
  if (fs.existsSync(path.join(prepared, 'RUNTIME_MANIFEST.json'))) return prepared
  return path.resolve(__dirname, '..', '..')
}

function repoRootFromDesktop() {
  return path.resolve(__dirname, '..', '..')
}

function appDataRoot() {
  return resolveAppDataRoot()
}

function ensureAppDataDirs() {
  const paths = resolveAppDataPaths()
  for (const dir of [paths.root, paths.data, paths.logs, paths.cache, paths.exports, paths.runtime]) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return paths.root
}

/**
 * Commander-owned mutable data lives under the platform app-data root /data.
 * Windows: %LOCALAPPDATA%\War Room OS\data
 * Linux:   $XDG_DATA_HOME/war-room-os/data or ~/.local/share/war-room-os/data
 * WAR_ROOM_LOCAL_DATA_DIR overrides the root for isolated/clean-profile testing.
 */
function localDataDir() {
  const dir = resolveAppDataPaths().data
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function pinChildDataRoot() {
  process.env.WAR_ROOM_LOCAL_DATA_DIR = appDataRoot()
}

function appendLog(line) {
  try {
    const dir = path.join(appDataRoot(), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, 'desktop-main.log')
    const safe = String(line).replace(/password|Bearer\s+\S+|sk-[A-Za-z0-9]+|service[_-]?role/gi, '[REDACTED]')
    fs.appendFileSync(f, `[${new Date().toISOString()}] ${safe}\n`)
  } catch {
    /* ignore */
  }
}

function isAllowedLocalUrl(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol === 'file:') return true
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return false
    const port = u.port ? Number(u.port) : 80
    return ALLOWED_PORTS.has(port)
  } catch {
    return false
  }
}

function probePort(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = open => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(400)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

async function waitForUi(ms = 90000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const res = await fetch(LOCAL_UI_ORIGIN + '/', {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(2000),
      })
      if (res.status === 200 || res.status === 307 || res.status === 302) {
        try {
          const hvs = await fetch(LOCAL_UI_ORIGIN + '/higher-vision-studios', {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(2000),
          })
          appendLog(`hvs route status=${hvs.status}`)
        } catch (err) {
          appendLog(`hvs route probe_failed: ${err}`)
        }
        return true
      }
    } catch {
      /* retry */
    }
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

/** Pipe owned UI child output into AppData logs so UI_FAILED is diagnosable. */
function attachUiChildLogging(child) {
  if (!child) return
  const write = prefix => data => appendLog(`ui:${prefix} ${String(data).trim().slice(0, 2000)}`)
  if (child.stdout) child.stdout.on('data', write('out'))
  if (child.stderr) child.stderr.on('data', write('err'))
  appendLog(`UI_CHILD_START pid=${child.pid ?? 'unknown'}`)
  child.on('exit', (code, signal) => {
    appendLog(`UI_CHILD_EXIT code=${code} signal=${signal ?? 'none'}`)
    appendLog(`ui:exit code=${code} signal=${signal}`)
  })
  child.on('error', err => appendLog(`ui:error ${err}`))
}

function ownedSpawnExtras() {
  return process.platform === 'win32' ? { windowsHide: true } : { windowsHide: true, detached: true }
}

function killOwned(child) {
  if (!child || child.killed || child.exitCode !== null) return
  const pid = child.pid
  if (process.platform !== 'win32' && typeof pid === 'number') {
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }
    setTimeout(() => {
      try {
        if (child.exitCode === null && !child.killed) process.kill(-pid, 'SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }
    }, 3000)
    return
  }
  try {
    child.kill('SIGTERM')
  } catch {
    /* ignore */
  }
}

function startOwnedNextDev(repoRoot) {
  const nextJs = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
  if (!fs.existsSync(nextJs)) return null
  if (!fs.existsSync(path.join(repoRoot, '.next', 'BUILD_ID'))) return null
  return spawn(process.execPath, [nextJs, 'start', '--hostname', '127.0.0.1', '--port', '3848'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      WAR_ROOM_RUNTIME_SURFACE: 'DESKTOP_LOCAL',
      PORT: '3848',
      HOSTNAME: '127.0.0.1',
    },
    stdio: 'ignore',
    ...ownedSpawnExtras(),
  })
}

function startOwnedCoreDev(repoRoot) {
  const runner = path.join(repoRoot, 'scripts', 'run-war-room-local-core.mjs')
  const loader = path.join(repoRoot, 'scripts', 'ts-extension-loader.mjs')
  if (!fs.existsSync(runner)) return null
  return spawn(
    process.execPath,
    ['--loader', loader, '--experimental-transform-types', runner],
    {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WAR_ROOM_RUNTIME_SURFACE: 'DESKTOP_LOCAL' },
      stdio: 'ignore',
      ...ownedSpawnExtras(),
    },
  )
}

/**
 * Decide whether ensureRuntimes() should spawn a new owned process for `port`.
 * Returns { spawn, reused }:
 *   spawn=true, reused=null   => port is free (or a verified stale runtime was just
 *                                 terminated) — caller should spawn its own child.
 *   spawn=false, reused=<rec> => a SAME_RUNTIME-verified owner was adopted by
 *                                 reference (see serverLifecycle.captureReusedOwnership).
 *   spawn=false, reused=null  => reuse an already-open port with no adoption (non-Linux),
 *                                 or abort because ownership could not be safely resolved.
 * Never kills on anything less than a positive RUNTIME_MANIFEST.json match.
 */
async function resolvePortForSpawn(port, rt, label) {
  if (!(await probePort(port))) return { spawn: true, reused: null }

  if (process.platform !== 'linux') {
    appendLog(`${label} port ${port} already open — reuse (no kill)${process.platform === 'darwin' ? ' [macOS ownership verification: FOLLOW_UP_REQUIRED]' : ''}`)
    return { spawn: false, reused: null }
  }

  const ownership = serverLifecycle.classifyPortOwner({ port, currentRuntimeRoot: rt, log: appendLog })
  if (ownership.status === 'SAME_RUNTIME') {
    appendLog(`SAME_RUNTIME_REUSE ${label} port=${port} pid=${ownership.pid} runtimeRoot=${ownership.runtimeRoot} sourceCommit=${ownership.sourceCommit || 'n/a'} — same runtime root, verified owner, reuse`)
    const reused = serverLifecycle.captureReusedOwnership({ pid: ownership.pid, port, runtimeRoot: ownership.runtimeRoot })
    return { spawn: false, reused }
  }
  if (ownership.status === 'STALE_RUNTIME') {
    appendLog(`STALE_RUNTIME_FOUND ${label} port=${port} pid=${ownership.pid} runtimeRoot=${ownership.runtimeRoot} sourceCommit=${ownership.sourceCommit || 'n/a'}`)
    const killed = await serverLifecycle.terminateVerifiedStaleRuntime(ownership.pid)
    const stillOpen = await probePort(port)
    if (killed && !stillOpen) {
      appendLog(`STALE_RUNTIME_TERMINATED ${label} port=${port} pid=${ownership.pid} — port released, spawning current runtime`)
      return { spawn: true, reused: null }
    }
    appendLog(`PORT_CONFLICT_SAFE_ABORT ${label} port=${port} pid=${ownership.pid} reason=stale_termination_incomplete killed=${killed} stillOpen=${stillOpen}`)
    return { spawn: false, reused: null }
  }
  appendLog(`UNKNOWN_PORT_OWNER ${label} port=${port} pid=${ownership.pid ?? 'unresolved'} reason=${ownership.reason} — PORT_CONFLICT_SAFE_ABORT (process left running, never destroyed on unproven ownership)`)
  return { spawn: false, reused: null }
}

async function ensureRuntimes() {
  ensureAppDataDirs()
  pinChildDataRoot()
  try {
    desktopTrust.loadOrCreateDesktopTrustSecret()
    appendLog('desktopTrust ready')
  } catch (err) {
    appendLog(`desktopTrust init_failed: ${err}`)
  }
  const packaged = isPackaged()
  const rt = runtimeRoot()
  const dataDir = localDataDir()
  const runtimeDataDir = resolveAppDataPaths().runtime
  const currentManifest = serverLifecycle.readRuntimeManifest(rt)
  const currentSourceCommit = currentManifest && typeof currentManifest.source_commit === 'string' ? currentManifest.source_commit : null
  appendLog(`ensureRuntimes packaged=${packaged} runtimeRoot=${rt} dataDir=${dataDir} sourceCommit=${currentSourceCommit || 'n/a'}`)

  const coreResolution = await resolvePortForSpawn(3847, rt, 'Core')
  if (coreResolution.spawn) {
    const startCorePath = packaged
      ? path.join(process.resourcesPath, 'runtime', 'start-core.cjs')
      : path.join(__dirname, '..', 'runtime', 'start-core.cjs')
    if (fs.existsSync(startCorePath)) {
      try {
        const coreMod = require(startCorePath)
        try {
          ownedCoreHandle = await coreMod.startCoreInProcess({
            runtimeRoot: rt,
            localDataDir: appDataRoot(),
          })
          appendLog('CORE_START mode=in-process')
          appendLog('Core started in-process')
        } catch (err) {
          appendLog(`Core in-process failed: ${err}`)
          ownedCoreChild = coreMod.startCoreChild({ runtimeRoot: rt, electronExec: process.execPath })
        }
      } catch (err) {
        appendLog(`Core packaged start error: ${err}`)
        if (!packaged) ownedCoreChild = startOwnedCoreDev(repoRootFromDesktop())
      }
    } else if (!packaged) {
      ownedCoreChild = startOwnedCoreDev(repoRootFromDesktop())
    }
    const coreOwnedPid = ownedCoreChild ? ownedCoreChild.pid : (ownedCoreHandle ? process.pid : null)
    if (coreOwnedPid) {
      serverLifecycle.writeLockFile(runtimeDataDir, { pid: coreOwnedPid, port: 3847, runtimeRoot: rt, sourceCommit: currentSourceCommit })
    }
  } else if (coreResolution.reused) {
    reusedCoreOwnership = coreResolution.reused
    serverLifecycle.writeLockFile(runtimeDataDir, { pid: reusedCoreOwnership.pid, port: 3847, runtimeRoot: reusedCoreOwnership.runtimeRoot, sourceCommit: currentSourceCommit, adopted: true })
  }

  const uiResolution = await resolvePortForSpawn(3848, rt, 'UI')
  if (uiResolution.spawn) {
    if (packaged || fs.existsSync(path.join(rt, 'ui'))) {
      try {
        const startUiPath = packaged
          ? path.join(process.resourcesPath, 'runtime', 'start-ui.cjs')
          : path.join(__dirname, '..', 'runtime', 'start-ui.cjs')
        const { startUi } = require(startUiPath)
        ownedUiChild = startUi({ runtimeRoot: rt, electronExec: process.execPath, stdio: 'pipe' })
        attachUiChildLogging(ownedUiChild)
        appendLog('UI_CHILD_START source=packaged')
        appendLog('UI child spawned from packaged runtime')
      } catch (err) {
        appendLog(`UI packaged start error: ${err}`)
        if (!packaged) ownedUiChild = startOwnedNextDev(repoRootFromDesktop())
      }
    } else {
      ownedUiChild = startOwnedNextDev(repoRootFromDesktop())
    }
    if (ownedUiChild) {
      serverLifecycle.writeLockFile(runtimeDataDir, { pid: ownedUiChild.pid, port: 3848, runtimeRoot: rt, sourceCommit: currentSourceCommit })
    }
  } else if (uiResolution.reused) {
    reusedUiOwnership = uiResolution.reused
    serverLifecycle.writeLockFile(runtimeDataDir, { pid: reusedUiOwnership.pid, port: 3848, runtimeRoot: reusedUiOwnership.runtimeRoot, sourceCommit: currentSourceCommit, adopted: true })
  }

  const ready = await waitForUi()
  if (!ready) appendLog('UI_FAILED / PORT_CONFLICT — diagnostic Core URL may be used')
  return ready
}

function createWindow(startUrl, diagnosticDetail, sessionToken) {
  const iconPath = resolveIconPath()
  // Secure by default: the renderer sandbox stays ON. Only an explicit operator opt-in
  // (WAR_ROOM_DISABLE_RENDERER_SANDBOX=1, Linux only) turns it off, for environments where
  // AT-SPI/accessibility compatibility requires an unsandboxed renderer. See rendererSandbox.cjs.
  const linuxRendererSandboxDisabled = resolveRendererSandbox(process.platform, process.env).disabledByOverride
  const winOpts = {
    width: 1440,
    height: 900,
    title: 'War Room OS',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      // nodeIntegration stays false and contextIsolation stays true regardless of the sandbox gate.
      sandbox: !linuxRendererSandboxDisabled,
      enableBlinkFeatures: 'AccessibilityObjectModel',
    },
  }
  if (iconPath) {
    try {
      winOpts.icon = nativeImage.createFromPath(iconPath)
    } catch {
      winOpts.icon = iconPath
    }
  }

  const win = new BrowserWindow(winOpts)
  mainWindow = win
  appendLog('WINDOW_CREATED')
  appendLog(`rendererSandbox = ${linuxRendererSandboxDisabled ? 'disabled-by-explicit-linux-override' : 'enabled'}`)
  win.on('closed', () => appendLog('WINDOW_CLOSED'))
  browserSurface = warRoomBrowser.attach(win)
  workbenchSurface = foundryWorkbenchView.attach(win)
  try { win.setTitle('War Room OS') } catch { /* ignore */ }
  try { if (typeof win.setAccessibleTitle === 'function') win.setAccessibleTitle('War Room OS') } catch { /* ignore */ }
  win.webContents.on('did-finish-load', () => {
    try { app.setAccessibilitySupportEnabled(true) } catch { /* ignore */ }
  })

  // Commander-explicit My Location uses Chromium geolocation. Electron must answer the
  // permission check/request or Linux/Chromium reports POSITION_UNAVAILABLE even when
  // navigator.geolocation exists. OS location still comes from GeoClue2 / xdg-desktop-portal;
  // coordinates are never invented here.
  win.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'geolocation') {
      appendLog('geolocation permission request granted (Commander My Location)')
      callback(true)
      return
    }
    callback(false)
  })
  win.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'geolocation'
  })
  if (process.platform === 'linux') {
    appendLog('linux geolocation: Chromium uses GeoClue2 (geoclue-2.0 / org.freedesktop.GeoClue2) via xdg-desktop-portal')
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    const rewritten = hvsNavigation.rewriteFileHvsToInstalledUi(url, LOCAL_UI_ORIGIN)
    if (rewritten) {
      void win.loadURL(rewritten)
      return { action: 'deny' }
    }
    if (hvsNavigation.isOwnedUiOrigin(url, LOCAL_UI_ORIGIN)) {
      void win.loadURL(url)
      return { action: 'deny' }
    }
    if (isAllowedLocalUrl(url)) return { action: 'allow' }
    if (browserSurface) void browserSurface.open({ url })
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const rewritten = hvsNavigation.rewriteFileHvsToInstalledUi(url, LOCAL_UI_ORIGIN)
    if (rewritten) {
      event.preventDefault()
      appendLog(`hvs file-route rewritten origin=${LOCAL_UI_ORIGIN}`)
      void win.loadURL(rewritten)
      return
    }
    if (hvsNavigation.isOwnedUiOrigin(url, LOCAL_UI_ORIGIN)) {
      return
    }
    if (foundryWorkbenchView.isWorkbenchUrl(url)) {
      event.preventDefault()
      return
    }
    if (warRoomBrowser.isLoopbackHttp(url)) {
      event.preventDefault()
      void browserSurface.open({ url })
      return
    }
    if (!isAllowedLocalUrl(url)) {
      event.preventDefault()
    }
  })

  if (diagnosticDetail) {
    const html = `<!doctype html><html><body style="font-family:system-ui;background:#0b0f14;color:#e8eef7;padding:2rem">
      <h1>War Room OS</h1>
      <p style="letter-spacing:.2em;font-weight:700">HIGHER VISION STUDIOS UNAVAILABLE</p>
      <p>War Room UI runtime is not ready.</p>
      <p><button onclick="location.href='${LOCAL_UI_ORIGIN}/'" style="background:#123;color:#e8eef7;border:1px solid #4ade80;padding:.5rem 1rem;cursor:pointer">RETRY</button></p>
      <details><summary>Advanced details</summary>
      <pre>${String(diagnosticDetail).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>
      <p>Installed UI: ${LOCAL_UI_ORIGIN}</p>
      <p>Core: ${LOCAL_CORE_ORIGIN}</p>
      </details>
      <p>Website fallback: DENIED</p>
      <p>AppData: ${appDataRoot()}</p>
    </body></html>`
    void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    return
  }

  const secret = process.env.WAR_ROOM_DESKTOP_TRUST_SECRET
  desktopTrust.attachDesktopTrustHeaders(win.webContents.session, secret)
  void (async () => {
    if (sessionToken) {
      try {
        await desktopTrust.applyLocalSessionCookie(win.webContents.session, LOCAL_UI_ORIGIN, sessionToken)
        appendLog('desktopTrust cookie=ok')
      } catch (err) {
        appendLog(`desktopTrust cookie_failed: ${err}`)
      }
    }
    void win.loadURL(startUrl)
  })()
}

ipcMain.handle('sovereign.getRuntimeTruth', async () => ({
  DESKTOP_APP: 'IMPLEMENTED_LOCAL_UI',
  FULL_WAR_ROOM_UI_LOCAL: 'IMPLEMENTED',
  WINDOWS_INSTALLABLE_APPLICATION: isPackaged() ? 'IMPLEMENTED' : 'DEV_SHELL',
  start_url: LOCAL_UI_ORIGIN,
  core_origin: LOCAL_CORE_ORIGIN,
  website_fallback: 'DENIED',
  packaged: isPackaged(),
  app_data: appDataRoot(),
  auto_start_with_windows: 'OFF',
}))

ipcMain.handle('sovereign.getHealth', async () => {
  try {
    const r = await fetch(LOCAL_CORE_ORIGIN + '/api/local/health', { signal: AbortSignal.timeout(2000) })
    return { ok: r.ok, status: r.status }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('sovereign.getBootState', async () => ({
  ui: (await probePort(3848)) ? 'UI_READY' : 'UI_FAILED',
  core: (await probePort(3847)) ? 'CORE_READY' : 'CORE_FAILED',
}))

ipcMain.handle('warRoomBrowser.open', async (_evt, payload) => browserSurface ? browserSurface.open(payload) : { ok: false, error: 'browser not ready' })
ipcMain.handle('warRoomBrowser.navigate', async (_evt, payload) => browserSurface ? browserSurface.navigate(payload) : { ok: false })
ipcMain.handle('warRoomBrowser.back', async () => browserSurface ? browserSurface.back() : { ok: false })
ipcMain.handle('warRoomBrowser.forward', async () => browserSurface ? browserSurface.forward() : { ok: false })
ipcMain.handle('warRoomBrowser.reload', async () => browserSurface ? browserSurface.reload() : { ok: false })
ipcMain.handle('warRoomBrowser.stop', async () => browserSurface ? browserSurface.stop() : { ok: false })
ipcMain.handle('warRoomBrowser.hide', async () => browserSurface ? browserSurface.hide() : { ok: false })

ipcMain.handle('sovereign.openExternalSafe', async (_evt, url) => {
  if (typeof url !== 'string') return { ok: false }
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false }
    await shell.openExternal(u.toString())
    return { ok: true }
  } catch {
    return { ok: false }
  }
})

ipcMain.handle('warRoom.browser.open', async (_evt, payload) => {
  if (!browserSurface) return { open: false, activeTabId: null, tabs: [] }
  return browserSurface.openUrl(payload?.url)
})
ipcMain.handle('warRoom.browser.navigate', async (_evt, payload) => {
  if (!browserSurface) return { open: false, activeTabId: null, tabs: [] }
  return browserSurface.navigate(payload)
})
ipcMain.handle('warRoom.browser.back', async () => browserSurface ? browserSurface.back() : { open: false, activeTabId: null, tabs: [] })
ipcMain.handle('warRoom.browser.forward', async () => browserSurface ? browserSurface.forward() : { open: false, activeTabId: null, tabs: [] })
ipcMain.handle('warRoom.browser.reload', async () => browserSurface ? browserSurface.reload() : { open: false, activeTabId: null, tabs: [] })
ipcMain.handle('warRoom.browser.stop', async () => browserSurface ? browserSurface.stop() : { open: false, activeTabId: null, tabs: [] })
ipcMain.handle('warRoom.browser.closeTab', async (_evt, payload) => browserSurface ? browserSurface.closeTab(payload) : { open: false, activeTabId: null, tabs: [] })
ipcMain.handle('warRoom.browser.close', async () => browserSurface ? browserSurface.closeAll() : { open: false, activeTabId: null, tabs: [] })
ipcMain.handle('warRoom.browser.setBounds', async (_evt, bounds) => browserSurface ? browserSurface.setBounds(bounds) : { open: false, activeTabId: null, tabs: [] })
ipcMain.handle('warRoom.browser.getState', async () => browserSurface ? browserSurface.getState() : { open: false, activeTabId: null, tabs: [] })

ipcMain.handle('foundry.workbench.ensure', async () => workbenchSurface ? workbenchSurface.ensure() : { ok: false, error: 'workbench not ready' })
ipcMain.handle('foundry.workbench.setBounds', async (_evt, bounds) => workbenchSurface ? workbenchSurface.setBounds(bounds) : { viewOpen: false })
ipcMain.handle('foundry.workbench.hide', async () => workbenchSurface ? workbenchSurface.hide() : { viewOpen: false })
ipcMain.handle('foundry.workbench.getState', async () => workbenchSurface ? workbenchSurface.getState() : { viewOpen: false })
ipcMain.handle('foundry.workbench.stop', async () => foundryWorkbenchHost.stopOwned())
ipcMain.handle('foundry.workbench.returnFocus', async () => workbenchSurface ? workbenchSurface.returnFocus() : { viewOpen: false })
ipcMain.handle('foundry.workbench.recover', async () => foundryWorkbenchHost.restartOwned())

function parseGeoClueWhereAmI(text) {
  const lat = /Latitude:\s*(-?\d+(?:\.\d+)?)°/.exec(text)
  const lon = /Longitude:\s*(-?\d+(?:\.\d+)?)°/.exec(text)
  const acc = /Accuracy:\s*(-?\d+(?:\.\d+)?)\s*meters/i.exec(text)
  if (!lat || !lon) return null
  const latitude = Number(lat[1])
  const longitude = Number(lon[1])
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null
  const accuracyMeters = acc && Number.isFinite(Number(acc[1])) ? Number(acc[1]) : null
  return { latitude, longitude, accuracyMeters }
}

ipcMain.handle('terra.nativeLocation.getFix', async () => {
  if (process.platform !== 'linux') {
    return { ok: false, reason: `NATIVE LOCATION UNAVAILABLE on ${process.platform}. GeoClue adapter is Linux-only.` }
  }
  const candidates = [
    '/usr/libexec/geoclue-2.0/demos/where-am-i',
    '/usr/lib/geoclue-2.0/demos/where-am-i',
    'where-am-i',
  ]
  for (const command of candidates) {
    try {
      const parsed = await new Promise((resolve) => {
        const child = spawn(command, ['-t', '8'], { stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        const timer = setTimeout(() => {
          child.kill('SIGTERM')
          resolve(null)
        }, 9000)
        child.stdout.on('data', chunk => { stdout += String(chunk) })
        child.on('error', () => {
          clearTimeout(timer)
          resolve(null)
        })
        child.on('close', () => {
          clearTimeout(timer)
          resolve(parseGeoClueWhereAmI(stdout))
        })
      })
      if (!parsed) continue
      const accuracyMeters = parsed.accuracyMeters
      return {
        ok: true,
        lat: parsed.latitude,
        lon: parsed.longitude,
        accuracyMeters,
        altitude: null,
        heading: null,
        speed: null,
        timestamp: Date.now(),
        source: accuracyMeters != null && accuracyMeters > 500 ? 'NETWORK_COARSE' : 'NATIVE_GEOCLUE',
      }
    } catch {
      continue
    }
  }
  return { ok: false, reason: 'NATIVE LOCATION UNAVAILABLE. GeoClue where-am-i demo was not found or returned no coordinates. Browser geolocation remains the primary source. Coordinates were not invented.' }
})

for (const ch of ['shell.exec', 'powershell.run', 'fs.write', 'child_process']) {
  ipcMain.handle(ch, async () => ({ ok: false, error: 'DENIED' }))
}

/**
 * Terminate a SAME_RUNTIME process this instance adopted by reference (never spawned,
 * so killOwned() has no handle for it). Re-runs the full verification chain first —
 * alive, same process generation, cwd/manifest, still owns the port — and refuses to
 * touch anything if any of that has changed since adoption. Never consults the lock
 * file for this decision.
 */
async function terminateReusedOwnership(record, port, runtimeDataDir) {
  if (!record) return
  const verdict = serverLifecycle.reverifyReusedOwnership(record, { log: appendLog })
  if (!verdict.ok) {
    appendLog(`REUSED_OWNERSHIP_SAFE_ABORT port=${port} pid=${record.pid} reason=${verdict.reason} — not terminating`)
    return
  }
  const killed = await serverLifecycle.terminateVerifiedStaleRuntime(record.pid)
  if (killed) {
    appendLog(`REUSED_OWNERSHIP_TERMINATED port=${port} pid=${record.pid}`)
    serverLifecycle.clearLockFile(runtimeDataDir, port)
  } else {
    appendLog(`REUSED_OWNERSHIP_TERMINATION_FAILED port=${port} pid=${record.pid}`)
  }
}

function packageIdentity() {
  const execPath = String(process.execPath || '')
  const marker = `${path.sep}.local${path.sep}opt${path.sep}`
  const idx = execPath.indexOf(marker)
  if (idx < 0) return 'unpackaged'
  const rest = execPath.slice(idx + marker.length)
  const installId = rest.split(path.sep)[0]
  return installId || 'unpackaged'
}

function quitFor(reason) {
  appendLog(`APP_QUIT_CALLED reason=${reason}`)
  app.quit()
}

async function shutdownOwned() {
  appendLog('SHUTDOWN_OWNED_START')
  appendLog('CORE_STOP')
  const runtimeDataDir = resolveAppDataPaths().runtime
  if (ownedUiChild) serverLifecycle.clearLockFile(runtimeDataDir, 3848)
  if (ownedCoreChild || ownedCoreHandle) serverLifecycle.clearLockFile(runtimeDataDir, 3847)
  killOwned(ownedUiChild)
  killOwned(ownedCoreChild)
  if (ownedCoreHandle && typeof ownedCoreHandle.close === 'function') {
    try {
      await ownedCoreHandle.close()
    } catch {
      /* ignore */
    }
  }
  ownedUiChild = null
  ownedCoreChild = null
  ownedCoreHandle = null

  await terminateReusedOwnership(reusedUiOwnership, 3848, runtimeDataDir)
  await terminateReusedOwnership(reusedCoreOwnership, 3847, runtimeDataDir)
  reusedUiOwnership = null
  reusedCoreOwnership = null
  try { await foundryWorkbenchHost.stopOwned() } catch { /* ignore */ }
  try { workbenchSurface?.destroy?.() } catch { /* ignore */ }
  workbenchSurface = null
  appendLog('SHUTDOWN_OWNED_END')
}

process.on('uncaughtException', err => {
  appendLog('UNCAUGHT_EXCEPTION')
  appendLog(`FATAL uncaughtException: ${err && err.stack ? err.stack : err}`)
})
process.on('unhandledRejection', err => {
  appendLog('UNHANDLED_REJECTION')
  appendLog(`FATAL unhandledRejection: ${err && err.stack ? err.stack : err}`)
})
for (const signalName of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signalName, () => {
    appendLog(signalName)
    quitFor(signalName)
  })
}
process.on('exit', code => {
  try { appendLog(`PROCESS_EXIT code=${code}`) } catch { /* ignore */ }
})

appendLog(`APP_START package=${packageIdentity()} pid=${process.pid} packaged=${isPackaged()}`)
appendLog(`boot pid=${process.pid} packaged=${isPackaged()} exec=${process.execPath}`)
if (process.platform === 'linux') {
  try {
    app.setDesktopName('war-room-os.desktop')
  } catch {
    /* ignore */
  }
}
if (process.platform === 'win32') {
  const overlayNames = applyWindowsUserEnvironmentToProcess()
  appendLog(`windowsUserEnv overlay names=${overlayNames.length} ${presenceSummary()}`)
}
try {
  const routingSource = applyCouncilRoutingDefault()
  appendLog(`councilRouting source=${routingSource} mode=${process.env.COUNCIL_ROUTING_MODE || 'UNSET'}`)
} catch (err) {
  appendLog(`councilRouting bootstrap skipped: ${err}`)
}

const holderPackage = packageIdentity()
const gotLock = app.requestSingleInstanceLock({ packageId: holderPackage })
if (!gotLock) {
  appendLog(`SECOND_INSTANCE incoming=${holderPackage} holder=already-locked`)
  appendLog('SECOND_INSTANCE — focusing existing War Room OS window, quitting this launch')
  quitFor('SECOND_INSTANCE')
} else {
  app.on('second-instance', (_event, _argv, _cwd, additionalData) => {
    const incoming = additionalData && typeof additionalData.packageId === 'string' ? additionalData.packageId : 'unknown'
    appendLog(`SECOND_INSTANCE holder=${holderPackage} incoming=${incoming}`)
    const wins = BrowserWindow.getAllWindows()
    if (wins[0]) {
      if (wins[0].isMinimized()) wins[0].restore()
      wins[0].focus()
    }
  })
  app.whenReady().then(async () => {
    try { app.setAccessibilitySupportEnabled(true) } catch { /* ignore */ }
    if (process.platform === 'linux') {
      try {
        const userData = app.getPath('userData')
        const activePortFile = path.join(userData, 'DevToolsActivePort')
        if (fs.existsSync(activePortFile)) {
          const reported = Number(String(fs.readFileSync(activePortFile, 'utf8')).split(/\r?\n/)[0])
          if (Number.isInteger(reported) && reported > 0) {
            warRoomCdp.recordResolvedCdpPort(reported)
          }
        } else if (claimedCdp?.cdpPort) {
          warRoomCdp.recordResolvedCdpPort(claimedCdp.cdpPort)
        }
      } catch (err) {
        appendLog(`cdp persist_failed: ${err}`)
      }
    }
    appendLog(`APP_READY package=${holderPackage}`)
    appendLog('app ready — starting owned runtimes')
    if (process.platform === 'win32') {
      try {
        app.setAppUserModelId('com.warroomos.desktop')
      } catch {
        /* ignore */
      }
    }
    const ready = await ensureRuntimes()
    try {
      desktopTrust.attachDesktopTrustHeaders(session.defaultSession, process.env.WAR_ROOM_DESKTOP_TRUST_SECRET)
    } catch (err) {
      appendLog(`desktopTrust attach_failed: ${err}`)
    }
    if (!ready) {
      const coreUp = await probePort(3847)
      if (coreUp) {
        createWindow(LOCAL_CORE_ORIGIN + '/', null, null)
      } else {
        createWindow(
          null,
          `UI_FAILED / possible PORT_CONFLICT on 3848.\nCore :3847 also unavailable.\nNo website fallback.\nCheck ${path.join(appDataRoot(), 'logs', 'desktop-main.log')}`,
          null,
        )
      }
      return
    }
    let sessionToken = null
    try {
      sessionToken = await desktopTrust.mintTrustedDesktopSession(LOCAL_UI_ORIGIN, process.env.WAR_ROOM_DESKTOP_TRUST_SECRET)
      appendLog(`desktopTrust session=${sessionToken ? 'ok' : 'mint_failed'}`)
    } catch (err) {
      appendLog(`desktopTrust mint_error: ${err}`)
    }
    createWindow(LOCAL_UI_ORIGIN + '/', null, sessionToken)
    if (foundryWorkbenchHost.isFoundryWorkbenchW0Enabled()) {
      try {
        const sandbox = linuxChromeSandboxStatus()
        appendLog(`workbench lazy-start; sandbox verdict=${sandbox.verdict} mode=${sandbox.mode || 'none'} uid=${sandbox.uid ?? 'n/a'} helper=${sandbox.helper || 'none'}`)
        appendLog('workbench owned child deferred until foundry.workbench.ensure')
      } catch (err) {
        appendLog(`workbench sandbox inspect failed: ${err}`)
      }
    }
  })
  app.on('window-all-closed', () => {
    appendLog('WINDOW_ALL_CLOSED')
    void shutdownOwned().then(() => {
      if (process.platform !== 'darwin') quitFor('WINDOW_ALL_CLOSED')
    })
  })
  app.on('before-quit', () => {
    appendLog('BEFORE_QUIT')
    void shutdownOwned()
  })
  app.on('will-quit', () => appendLog('WILL_QUIT'))
  app.on('quit', (_event, code) => appendLog(`QUIT code=${code}`))
}
