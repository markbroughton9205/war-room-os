/**
 * War Room Desktop — Electron main (Phase 11D installable Windows app).
 * Packaged: starts owned Core + Next from resources/runtime (repo-independent).
 * Dev: may use repo checkout runtimes.
 * Never opens https://warroomos.com. Never kills prod/DEV/cloudflared/Ollama.
 */
const { app, BrowserWindow, shell, ipcMain, nativeImage } = require('electron')
const path = require('node:path')
const { spawn } = require('node:child_process')
const net = require('node:net')
const fs = require('node:fs')
const { applyWindowsUserEnvironmentToProcess, presenceSummary } = require('./windowsUserEnv.cjs')
const { applyCouncilRoutingDefault } = require('./councilRoutingBootstrap.cjs')
const { resolveAppDataRoot, resolveAppDataPaths } = require('./appDataRoot.cjs')

const LOCAL_UI_ORIGIN = process.env.WAR_ROOM_LOCAL_UI_ORIGIN || 'http://127.0.0.1:3848'
const LOCAL_CORE_ORIGIN = process.env.WAR_ROOM_LOCAL_CORE_ORIGIN || 'http://127.0.0.1:3847'
const PUBLIC_HOSTS = new Set(['warroomos.com', 'www.warroomos.com'])
const ALLOWED_PORTS = new Set([3847, 3848, 3000, 3001])

let ownedUiChild = null
let ownedCoreHandle = null
let ownedCoreChild = null
let mainWindow = null

function isPackaged() {
  return app.isPackaged === true
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
      if (res.status === 200 || res.status === 307 || res.status === 302) return true
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
  child.on('exit', (code, signal) => appendLog(`ui:exit code=${code} signal=${signal}`))
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

async function ensureRuntimes() {
  ensureAppDataDirs()
  pinChildDataRoot()
  const packaged = isPackaged()
  const rt = runtimeRoot()
  const dataDir = localDataDir()
  appendLog(`ensureRuntimes packaged=${packaged} runtimeRoot=${rt} dataDir=${dataDir}`)

  if (!(await probePort(3847))) {
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
  } else {
    appendLog('Core port 3847 already open — reuse (no kill)')
  }

  if (!(await probePort(3848))) {
    if (packaged || fs.existsSync(path.join(rt, 'ui'))) {
      try {
        const startUiPath = packaged
          ? path.join(process.resourcesPath, 'runtime', 'start-ui.cjs')
          : path.join(__dirname, '..', 'runtime', 'start-ui.cjs')
        const { startUi } = require(startUiPath)
        ownedUiChild = startUi({ runtimeRoot: rt, electronExec: process.execPath, stdio: 'pipe' })
        attachUiChildLogging(ownedUiChild)
        appendLog('UI child spawned from packaged runtime')
      } catch (err) {
        appendLog(`UI packaged start error: ${err}`)
        if (!packaged) ownedUiChild = startOwnedNextDev(repoRootFromDesktop())
      }
    } else {
      ownedUiChild = startOwnedNextDev(repoRootFromDesktop())
    }
  } else {
    appendLog('UI port 3848 already open — reuse (no kill)')
  }

  const ready = await waitForUi()
  if (!ready) appendLog('UI_FAILED / PORT_CONFLICT — diagnostic Core URL may be used')
  return ready
}

function createWindow(startUrl, diagnosticDetail) {
  const iconPath = resolveIconPath()
  const winOpts = {
    width: 1440,
    height: 900,
    title: 'War Room OS',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
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
    if (isAllowedLocalUrl(url)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedLocalUrl(url)) {
      event.preventDefault()
      try {
        if (PUBLIC_HOSTS.has(new URL(url).hostname)) return
      } catch {
        return
      }
      void shell.openExternal(url)
    }
  })

  if (diagnosticDetail) {
    const html = `<!doctype html><html><body style="font-family:system-ui;background:#0b0f14;color:#e8eef7;padding:2rem">
      <h1>War Room OS</h1>
      <p>Local runtime diagnostic</p>
      <pre>${String(diagnosticDetail).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>
      <p>Website fallback: DENIED</p>
      <p>AppData: ${appDataRoot()}</p>
    </body></html>`
    void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    return
  }

  void win.loadURL(startUrl)
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

async function shutdownOwned() {
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
}

process.on('uncaughtException', err => {
  appendLog(`FATAL uncaughtException: ${err && err.stack ? err.stack : err}`)
})
process.on('unhandledRejection', err => {
  appendLog(`FATAL unhandledRejection: ${err && err.stack ? err.stack : err}`)
})

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

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  appendLog('SECOND_INSTANCE — focusing existing War Room OS window, quitting this launch')
  app.quit()
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows()
    if (wins[0]) {
      if (wins[0].isMinimized()) wins[0].restore()
      wins[0].focus()
    }
  })
  app.whenReady().then(async () => {
    appendLog('app ready — starting owned runtimes')
    if (process.platform === 'win32') {
      try {
        app.setAppUserModelId('com.warroomos.desktop')
      } catch {
        /* ignore */
      }
    }
    const ready = await ensureRuntimes()
    if (!ready) {
      const coreUp = await probePort(3847)
      if (coreUp) {
        createWindow(LOCAL_CORE_ORIGIN + '/', null)
      } else {
        createWindow(
          null,
          `UI_FAILED / possible PORT_CONFLICT on 3848.\nCore :3847 also unavailable.\nNo website fallback.\nCheck ${path.join(appDataRoot(), 'logs', 'desktop-main.log')}`,
        )
      }
      return
    }
    createWindow(LOCAL_UI_ORIGIN + '/', null)
  })
  app.on('window-all-closed', () => {
    void shutdownOwned().then(() => {
      if (process.platform !== 'darwin') app.quit()
    })
  })
  app.on('before-quit', () => {
    void shutdownOwned()
  })
}
