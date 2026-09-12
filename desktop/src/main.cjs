/**
 * War Room Desktop — Electron main process (Phase 11A).
 * Loads FULL local War Room Next UI at http://127.0.0.1:3848/
 * Never opens https://warroomos.com.
 */
const { app, BrowserWindow, shell, ipcMain } = require('electron')
const path = require('node:path')
const { spawn } = require('node:child_process')
const net = require('node:net')
const fs = require('node:fs')

const LOCAL_UI_ORIGIN = process.env.WAR_ROOM_LOCAL_UI_ORIGIN || 'http://127.0.0.1:3848'
const LOCAL_CORE_ORIGIN = process.env.WAR_ROOM_LOCAL_CORE_ORIGIN || 'http://127.0.0.1:3847'
const PUBLIC_HOSTS = new Set(['warroomos.com', 'www.warroomos.com'])
const ALLOWED_PORTS = new Set([3847, 3848, 3000, 3001])

/** Child Next process owned by this desktop instance (if we started it). */
let ownedUiChild = null
let ownedCoreChild = null

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

async function waitForUi(ms = 60000) {
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

function repoRootFromDesktop() {
  // desktop/src → repo root
  return path.resolve(__dirname, '..', '..')
}

function startOwnedNext(repoRoot) {
  const nextJs = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
  if (!fs.existsSync(nextJs)) return null
  if (!fs.existsSync(path.join(repoRoot, '.next', 'BUILD_ID'))) return null
  const child = spawn(process.execPath, [nextJs, 'start', '--hostname', '127.0.0.1', '--port', '3848'], {
    cwd: repoRoot,
    env: { ...process.env, WAR_ROOM_RUNTIME_SURFACE: 'DESKTOP_LOCAL', PORT: '3848', HOSTNAME: '127.0.0.1' },
    stdio: 'ignore',
    windowsHide: true,
  })
  return child
}

function startOwnedCore(repoRoot) {
  const runner = path.join(repoRoot, 'scripts', 'run-war-room-local-core.mjs')
  const loader = path.join(repoRoot, 'scripts', 'ts-extension-loader.mjs')
  if (!fs.existsSync(runner)) return null
  const child = spawn(
    process.execPath,
    ['--loader', loader, '--experimental-transform-types', runner],
    {
      cwd: repoRoot,
      env: { ...process.env, WAR_ROOM_RUNTIME_SURFACE: 'DESKTOP_LOCAL' },
      stdio: 'ignore',
      windowsHide: true,
    },
  )
  return child
}

function killOwned(child) {
  if (!child || child.killed || child.exitCode !== null) return
  try {
    child.kill('SIGTERM')
  } catch {
    /* ignore */
  }
}

async function ensureRuntimes() {
  const root = repoRootFromDesktop()
  // Core (optional control plane)
  if (!(await probePort(3847))) {
    ownedCoreChild = startOwnedCore(root)
  }
  // Full War Room UI
  if (!(await probePort(3848))) {
    ownedUiChild = startOwnedNext(root)
  }
  const ready = await waitForUi()
  return ready
}

function createWindow(startUrl) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'War Room',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

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

  void win.loadURL(startUrl)
}

ipcMain.handle('sovereign.getRuntimeTruth', async () => ({
  DESKTOP_APP: 'IMPLEMENTED_LOCAL_UI',
  FULL_WAR_ROOM_UI_LOCAL: 'IMPLEMENTED',
  start_url: LOCAL_UI_ORIGIN,
  core_origin: LOCAL_CORE_ORIGIN,
  website_fallback: 'DENIED',
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

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
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
    const ready = await ensureRuntimes()
    if (!ready) {
      // Diagnostic only — still never fall back to warroomos.com
      createWindow(LOCAL_CORE_ORIGIN + '/')
      return
    }
    createWindow(LOCAL_UI_ORIGIN + '/')
  })
  app.on('window-all-closed', () => {
    killOwned(ownedUiChild)
    killOwned(ownedCoreChild)
    // Do not kill cloudflared / production / Ollama / unknown
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    killOwned(ownedUiChild)
    killOwned(ownedCoreChild)
  })
}
