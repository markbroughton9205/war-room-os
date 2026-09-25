/**
 * War Room Browser — isolated guest web contents inside the desktop shell.
 * Uses WebContentsView when available, otherwise BrowserView.
 * Guest pages get no Node, no preload, and a separate session partition.
 */
const { session, WebContentsView, BrowserView } = require('electron')
const crypto = require('node:crypto')

const PARTITION = 'persist:war-room-browser'
const IPC = {
  open: 'warRoom.browser.open',
  navigate: 'warRoom.browser.navigate',
  back: 'warRoom.browser.back',
  forward: 'warRoom.browser.forward',
  reload: 'warRoom.browser.reload',
  stop: 'warRoom.browser.stop',
  closeTab: 'warRoom.browser.closeTab',
  close: 'warRoom.browser.close',
  setBounds: 'warRoom.browser.setBounds',
  getState: 'warRoom.browser.getState',
  stateEvent: 'warRoom.browser.state',
}

function classifyUrl(raw) {
  try {
    const parsed = new URL(String(raw || '').trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: `${parsed.protocol} is not allowed in War Room Browser.` }
    }
    return { ok: true, url: parsed.toString() }
  } catch {
    return { ok: false, reason: 'Not a valid URL.' }
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
  } else if (typeof entry.view.setBackgroundColor === 'function' && (!bounds.visible || box.width < 8)) {
    try { entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }) } catch { /* ignore */ }
  }
}

function tabState(entry) {
  const wc = webContentsOf(entry)
  let url = 'about:blank'
  try { url = wc.getURL() || entry.url } catch { url = entry.url }
  let title = entry.title
  try { title = wc.getTitle() || title } catch { /* ignore */ }
  return {
    id: entry.id,
    title: title || url,
    url,
    loading: entry.loading,
    error: entry.error,
    canGoBack: (() => { try { return wc.canGoBack() } catch { return false } })(),
    canGoForward: (() => { try { return wc.canGoForward() } catch { return false } })(),
  }
}

function isLoopbackHttp(raw) {
  try {
    const parsed = new URL(String(raw || ''))
    const host = parsed.hostname.toLowerCase()
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && (host === '127.0.0.1' || host === 'localhost' || host === '[::1]')
  } catch {
    return false
  }
}

function attach(win) {
  const manager = createManager({
    getWindow: () => win,
  })
  return {
    open: payload => {
      if (payload?.bounds) manager.setBounds({ ...payload.bounds, visible: true })
      return manager.openUrl(payload?.url)
    },
    navigate: payload => {
      if (payload?.bounds) manager.setBounds({ ...payload.bounds, visible: true })
      return manager.navigate(payload?.url, payload?.tabId)
    },
    back: () => manager.back(),
    forward: () => manager.forward(),
    reload: () => manager.reload(),
    stop: () => manager.stop(),
    hide: () => manager.closeAll(),
    closeTab: payload => manager.closeTab(payload?.tabId),
    closeAll: () => manager.closeAll(),
    setBounds: bounds => manager.setBounds(bounds),
    getState: () => manager.getState(),
    openUrl: url => manager.openUrl(url),
  }
}

function createManager({ getWindow, log }) {
  const tabs = new Map()
  let activeTabId = null
  let open = false
  let lastBounds = { x: 0, y: 0, width: 0, height: 0, visible: false }

  function snapshot() {
    return {
      open,
      activeTabId,
      tabs: [...tabs.values()].map(tabState),
    }
  }

  function emit() {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    try {
      win.webContents.send(IPC.stateEvent, snapshot())
    } catch {
      /* ignore */
    }
  }

  function wire(entry) {
    const wc = webContentsOf(entry)
    wc.setWindowOpenHandler(({ url }) => {
      const allowed = classifyUrl(url)
      if (allowed.ok) {
        void openUrl(allowed.url)
      }
      return { action: 'deny' }
    })
    wc.on('did-start-loading', () => {
      entry.loading = true
      entry.error = null
      emit()
    })
    wc.on('did-stop-loading', () => {
      entry.loading = false
      try { entry.url = wc.getURL() || entry.url } catch { /* ignore */ }
      try { entry.title = wc.getTitle() || entry.title } catch { /* ignore */ }
      emit()
    })
    wc.on('did-navigate', (_event, url) => {
      entry.url = url
      emit()
    })
    wc.on('did-navigate-in-page', (_event, url) => {
      entry.url = url
      emit()
    })
    wc.on('page-title-updated', (_event, title) => {
      entry.title = title
      emit()
    })
    wc.on('did-fail-load', (_event, code, desc, url, isMain) => {
      if (!isMain) return
      entry.loading = false
      entry.error = desc || `Load failed (${code})`
      entry.url = url || entry.url
      emit()
    })
    wc.on('render-process-gone', () => {
      entry.error = 'The page renderer stopped.'
      entry.loading = false
      emit()
    })
  }

  async function openUrl(raw) {
    const allowed = classifyUrl(raw)
    if (!allowed.ok) return { ...snapshot(), error: allowed.reason }
    const win = getWindow()
    if (!win) return snapshot()
    open = true
    let entry = activeTabId ? tabs.get(activeTabId) : null
    if (!entry) {
      const created = createGuestView()
      entry = {
        id: crypto.randomUUID(),
        title: allowed.url,
        url: allowed.url,
        loading: true,
        error: null,
        kind: created.kind,
        view: created.view,
      }
      tabs.set(entry.id, entry)
      activeTabId = entry.id
      attachView(win, entry)
      wire(entry)
    }
    applyBounds(entry, { ...lastBounds, visible: lastBounds.visible })
    try {
      await webContentsOf(entry).loadURL(allowed.url)
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err)
      entry.loading = false
    }
    emit()
    return snapshot()
  }

  async function navigate(raw, tabId) {
    const allowed = classifyUrl(raw)
    if (!allowed.ok) return { ...snapshot(), error: allowed.reason }
    const entry = tabs.get(tabId || activeTabId)
    if (!entry) return openUrl(allowed.url)
    entry.loading = true
    entry.error = null
    try {
      await webContentsOf(entry).loadURL(allowed.url)
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err)
      entry.loading = false
    }
    emit()
    return snapshot()
  }

  function active() {
    return tabs.get(activeTabId)
  }

  function command(fn) {
    const entry = active()
    if (!entry) return snapshot()
    try { fn(webContentsOf(entry)) } catch (err) {
      log?.(`browser command failed: ${err}`)
    }
    emit()
    return snapshot()
  }

  function closeTab(tabId) {
    const id = tabId || activeTabId
    const entry = tabs.get(id)
    if (!entry) return snapshot()
    const win = getWindow()
    detachView(win, entry)
    try { webContentsOf(entry).destroy() } catch { /* ignore */ }
    tabs.delete(id)
    if (activeTabId === id) activeTabId = [...tabs.keys()][0] || null
    if (!activeTabId) open = false
    emit()
    return snapshot()
  }

  function closeAll() {
    for (const id of [...tabs.keys()]) closeTab(id)
    open = false
    activeTabId = null
    emit()
    return snapshot()
  }

  function setBounds(bounds) {
    lastBounds = {
      x: Number(bounds?.x) || 0,
      y: Number(bounds?.y) || 0,
      width: Number(bounds?.width) || 0,
      height: Number(bounds?.height) || 0,
      visible: Boolean(bounds?.visible) && open,
    }
    const entry = active()
    if (entry) applyBounds(entry, lastBounds)
    return snapshot()
  }

  return {
    IPC,
    snapshot,
    openUrl,
    navigate,
    back: () => command(wc => wc.goBack()),
    forward: () => command(wc => wc.goForward()),
    reload: () => command(wc => wc.reload()),
    stop: () => command(wc => wc.stop()),
    closeTab,
    closeAll,
    setBounds,
    getState: snapshot,
  }
}

module.exports = { createManager, attach, isLoopbackHttp, IPC }
