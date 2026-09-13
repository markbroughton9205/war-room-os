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
const os = require('node:os')
const { applyWindowsUserEnvironmentToProcess, presenceSummary } = require('./windowsUserEnv.cjs')
const { applyCouncilRoutingDefault } = require('./councilRoutingBootstrap.cjs')

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
  const candidates = [
    path.join(__dirname, '..', 'assets', 'war-room-os.ico'),
    path.join(process.resourcesPath || '', 'assets', 'war-room-os.ico'),
    path.join(__dirname, '..', 'assets', 'war-room-os-icon.png'),
  ]
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
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return path.join(base, 'War Room OS')
}

function ensureAppDataDirs() {
  const root = appDataRoot()
  for (const sub of ['data', 'logs', 'cache', 'exports', 'runtime']) {
    fs.mkdirSync(path.join(root, sub), { recursive: true })
  }
  return root
}

/**
 * Commander-owned mutable data lives under %LOCALAPPDATA%\War Room OS\data.
 * WAR_ROOM_LOCAL_DATA_DIR overrides it for isolated/clean-profile testing; the
 * override is propagated so the owned UI child resolves the same store.
 */
function localDataDir() {
  const dir = process.env.WAR_ROOM_LOCAL_DATA_DIR?.trim() || path.join(appDataRoot(), 'data')
  fs.mkdirSync(dir, { recursive: true })
  process.env.WAR_ROOM_LOCAL_DATA_DIR = dir
  return dir
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

function killOwned(child) {
  if (!child || child.killed || child.exitCode !== null) return
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
    windowsHide: true,
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
      windowsHide: true,
    },
  )
}

async function ensureRuntimes() {
  ensureAppDataDirs()
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
            localDataDir: localDataDir(),
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
          'UI_FAILED / possible PORT_CONFLICT on 3848.\nCore :3847 also unavailable.\nNo website fallback.\nCheck %LOCALAPPDATA%\\War Room OS\\logs\\desktop-main.log',
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
