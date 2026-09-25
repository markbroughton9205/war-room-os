/**
 * Foundry Workbench W0 guest — isolated WebContentsView for the REH-web surface.
 * Token stays in the main process. Renderer never receives it.
 */
'use strict'

const { session, WebContentsView, BrowserView } = require('electron')
const {
  FOUNDRY_WORKBENCH_HOST,
  FOUNDRY_WORKBENCH_PORT,
} = require('../workbench-host/constants.cjs')
const host = require('../workbench-host/index.cjs')

const BRANDING_RE = /OpenVSCode Server|OpenVSCode|Visual Studio Code|VS Code|Code-OSS/gi

function foundryTitle(raw) {
  return String(raw || 'Foundry Workbench').replace(BRANDING_RE, 'Foundry Workbench')
}

const BRANDING_SCRIPT = `(() => {
  const re = /OpenVSCode Server|OpenVSCode|Visual Studio Code|VS Code|Code-OSS/gi
  const apply = () => {
    if (re.test(document.title)) document.title = document.title.replace(re, 'Foundry Workbench')
  }
  apply()
  const obs = new MutationObserver(apply)
  const node = document.querySelector('title')
  if (node) obs.observe(node, { childList: true, characterData: true, subtree: true })
  setInterval(apply, 1500)
  return document.title
})()`
const PARTITION = 'persist:foundry-workbench'
const IPC = {
  ensure: 'foundry.workbench.ensure',
  setBounds: 'foundry.workbench.setBounds',
  hide: 'foundry.workbench.hide',
  getState: 'foundry.workbench.getState',
  stop: 'foundry.workbench.stop',
}

function isWorkbenchUrl(raw) {
  try {
    const parsed = new URL(String(raw || ''))
    const hostName = parsed.hostname.toLowerCase()
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && (hostName === '127.0.0.1' || hostName === 'localhost')
      && Number(port) === FOUNDRY_WORKBENCH_PORT
  } catch {
    return false
  }
}

function createGuestView() {
  const ses = session.fromPartition(PARTITION)
  const prefs = {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    javascript: true,
    webviewTag: false,
    session: ses,
  }
  if (typeof WebContentsView === 'function') {
    return { kind: 'web-contents-view', view: new WebContentsView({ webPreferences: prefs }) }
  }
  return { kind: 'browser-view', view: new BrowserView({ webPreferences: prefs }) }
}

function webContentsOf(entry) {
  return entry.view.webContents
}

function attachView(win, entry) {
  if (!win || win.isDestroyed()) return
  if (entry.kind === 'web-contents-view' && win.contentView && typeof win.contentView.addChildView === 'function') {
    win.contentView.addChildView(entry.view)
    return
  }
  if (typeof win.addBrowserView === 'function') win.addBrowserView(entry.view)
}

function detachView(win, entry) {
  if (!win || win.isDestroyed()) return
  try {
    if (entry.kind === 'web-contents-view' && win.contentView && typeof win.contentView.removeChildView === 'function') {
      win.contentView.removeChildView(entry.view)
      return
    }
    if (typeof win.removeBrowserView === 'function') win.removeBrowserView(entry.view)
  } catch {
    /* already detached */
  }
}

function applyBounds(entry, bounds) {
  const box = {
    x: Math.max(0, Math.round(bounds.x || 0)),
    y: Math.max(0, Math.round(bounds.y || 0)),
    width: Math.max(0, Math.round(bounds.width || 0)),
    height: Math.max(0, Math.round(bounds.height || 0)),
  }
  if (typeof entry.view.setBounds === 'function') entry.view.setBounds(box)
  if (typeof entry.view.setVisible === 'function') {
    entry.view.setVisible(Boolean(bounds.visible) && box.width > 8 && box.height > 8)
  } else if (!bounds.visible || box.width < 8) {
    try { entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }) } catch { /* ignore */ }
  }
}

function attach(win) {
  let entry = null
  let lastBounds = { x: 0, y: 0, width: 0, height: 0, visible: false }
  let dirtyTimer = null

  function snapshot() {
    let url = ''
    let title = ''
    try { url = entry ? webContentsOf(entry).getURL() : '' } catch { url = '' }
    try { title = entry ? foundryTitle(webContentsOf(entry).getTitle()) : '' } catch { title = '' }
    const health = host.publicHealth({ recovering: undefined })
    return {
      enabled: host.isFoundryWorkbenchW0Enabled(),
      viewOpen: Boolean(entry),
      partition: PARTITION,
      bind: FOUNDRY_WORKBENCH_HOST,
      port: FOUNDRY_WORKBENCH_PORT,
      urlHost: url ? (() => { try { return new URL(url).host } catch { return '' } })() : '',
      tokenInUrl: /tkn=/i.test(url),
      nestedElectron: false,
      title,
      owner: health.owner,
      pid: health.pid,
      folder: health.folder,
      recovering: health.recovering === true,
      guestCount: entry ? 1 : 0,
    }
  }

  async function syncDirtyBuffers() {
    if (!entry) {
      try { host.writeDirtyBuffers([]) } catch { /* ignore */ }
      return
    }
    try {
      const paths = await webContentsOf(entry).executeJavaScript(`(() => {
        const dirty = [...document.querySelectorAll('.tab.dirty, .tabs-container .dirty')]
        const labels = dirty.map(el => (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean)
        return labels
      })()`)
      const folder = host.fixtureRoot()
      const abs = (Array.isArray(paths) ? paths : []).map(label => {
        const name = String(label).replace(/•/g, '').trim().split(' ')[0]
        return name ? require('node:path').join(folder, name) : null
      }).filter(Boolean)
      host.writeDirtyBuffers(abs)
    } catch {
      /* guest may not be ready */
    }
  }

  function startDirtyWatch() {
    if (dirtyTimer) return
    dirtyTimer = setInterval(() => { void syncDirtyBuffers() }, 1000)
  }

  function stopDirtyWatch() {
    if (dirtyTimer) clearInterval(dirtyTimer)
    dirtyTimer = null
    try { host.writeDirtyBuffers([]) } catch { /* ignore */ }
  }

  async function ensure() {
    if (!host.isFoundryWorkbenchW0Enabled()) return { ...snapshot(), ok: false, error: 'FOUNDRY_WORKBENCH_W0 is off' }
    const started = await host.startOwned({ force: false })
    if (!started.ok && !started.ready) return { ...snapshot(), ...started }
    if (!entry) {
      const created = createGuestView()
      entry = { kind: created.kind, view: created.view }
      attachView(win, entry)
      const wc = webContentsOf(entry)
      wc.setWindowOpenHandler(() => ({ action: 'deny' }))
      wc.on('will-navigate', (event, next) => {
        if (!isWorkbenchUrl(next)) event.preventDefault()
      })
      wc.on('page-title-updated', (event, title) => {
        const next = foundryTitle(title)
        if (next !== title) {
          event.preventDefault()
          try { wc.executeJavaScript(`document.title = ${JSON.stringify(next)}`) } catch { /* ignore */ }
        }
      })
      wc.on('did-finish-load', () => {
        void wc.executeJavaScript(BRANDING_SCRIPT).catch(() => undefined)
        startDirtyWatch()
      })
    }
    const token = host.readToken()
    const folder = host.fixtureRoot()
    const ses = session.fromPartition(PARTITION)
    const origin = `http://${FOUNDRY_WORKBENCH_HOST}:${FOUNDRY_WORKBENCH_PORT}`
    if (token) {
      try {
        await ses.cookies.set({
          url: `${origin}/`,
          name: 'vscode-tkn',
          value: token,
          path: '/',
          httpOnly: true,
        })
      } catch {
        /* cookie optional; query fallback below */
      }
    }
    const guestUrl = `${origin}/?folder=${encodeURIComponent(folder)}`
    try {
      await webContentsOf(entry).loadURL(guestUrl)
    } catch (error) {
      if (token) {
        try {
          await webContentsOf(entry).loadURL(host.secretsForHost().authenticatedUrl)
        } catch (fallbackError) {
          return { ...snapshot(), ok: false, error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) }
        }
      } else {
        return { ...snapshot(), ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    applyBounds(entry, lastBounds)
    startDirtyWatch()
    return { ...snapshot(), ok: true, ready: true }
  }

  function setBounds(bounds) {
    lastBounds = {
      x: Number(bounds?.x) || 0,
      y: Number(bounds?.y) || 0,
      width: Number(bounds?.width) || 0,
      height: Number(bounds?.height) || 0,
      visible: Boolean(bounds?.visible),
    }
    if (entry) applyBounds(entry, lastBounds)
    return snapshot()
  }

  function hide() {
    lastBounds.visible = false
    if (entry) applyBounds(entry, lastBounds)
    return snapshot()
  }

  function returnFocus() {
    try { win.webContents.focus() } catch { /* ignore */ }
    return snapshot()
  }

  function destroy() {
    stopDirtyWatch()
    if (!entry) return snapshot()
    detachView(win, entry)
    try { webContentsOf(entry).destroy() } catch { /* ignore */ }
    entry = null
    return snapshot()
  }

  function getWebContents() {
    return entry ? webContentsOf(entry) : null
  }

  return { IPC, ensure, setBounds, hide, destroy, getState: snapshot, getWebContents, returnFocus }
}

module.exports = { attach, isWorkbenchUrl, PARTITION, IPC }
