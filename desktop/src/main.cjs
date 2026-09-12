/**
 * War Room Desktop — Electron main process (foundation).
 * Does NOT open https://warroomos.com.
 * Loads local core at http://127.0.0.1:3847 only.
 */
const { app, BrowserWindow, shell, ipcMain } = require('electron')
const path = require('node:path')

const LOCAL_CORE_ORIGIN = process.env.WAR_ROOM_LOCAL_CORE_ORIGIN || 'http://127.0.0.1:3847'
const PUBLIC_HOSTS = new Set(['warroomos.com', 'www.warroomos.com'])

function isAllowedLocalUrl(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol === 'file:') return true
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return false
    const port = u.port ? Number(u.port) : 80
    return port === 3847 || port === 3001 || port === 3000
  } catch {
    return false
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
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
    // External: open outside privileged shell
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedLocalUrl(url)) {
      event.preventDefault()
      if (PUBLIC_HOSTS.has(new URL(url).hostname)) {
        // Explicitly refuse loading public site inside privileged window
        return
      }
      void shell.openExternal(url)
    }
  })

  // CRITICAL: local core only — never warroomos.com
  void win.loadURL(LOCAL_CORE_ORIGIN + '/')
}

ipcMain.handle('sovereign.getRuntimeTruth', async () => ({
  DESKTOP_APP: 'IMPLEMENTED_FOUNDATION',
  start_url: LOCAL_CORE_ORIGIN,
  website_fallback: 'DENIED',
}))

ipcMain.handle('sovereign.openExternalSafe', async (_evt, url) => {
  if (typeof url !== 'string') return { ok: false }
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false }
    // Never grant bridge privileges; OS browser only
    await shell.openExternal(u.toString())
    return { ok: true }
  } catch {
    return { ok: false }
  }
})

// Deny dangerous channels if somehow invoked
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
  app.whenReady().then(createWindow)
  app.on('window-all-closed', () => {
    // Do not kill cloudflared / production / Ollama
    if (process.platform !== 'darwin') app.quit()
  })
}
