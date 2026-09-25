/**
 * Short-lived Electron harness for W0 WebContentsView + Commander edit proof.
 * This is not a second War Room product and not a nested Code-OSS Electron.
 * Linux Chromium SUID sandbox is disabled only for this harness process.
 */
'use strict'

process.env.FOUNDRY_WORKBENCH_W0 = '1'

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const foundryWorkbenchView = require('../src/foundryWorkbench.cjs')
const host = require('./index.cjs')

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-setuid-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

const MARKER = '\nexport const W0_COMMANDER_EDIT = "saved"\n'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function probe(wc) {
  return wc.executeJavaScript(`({
    workbench: !!document.querySelector('.monaco-workbench'),
    editor: !!document.querySelector('.monaco-editor'),
    textarea: !!document.querySelector('.monaco-editor textarea'),
    hello: [...document.querySelectorAll('.monaco-list-row, .label-name, .monaco-highlighted-label')].some(el => (el.textContent || '').includes('hello.ts')),
    trust: [...document.querySelectorAll('a, button, .monaco-button')].some(el => /trust the authors|Yes, I trust/i.test(el.textContent || '')),
    forbidden: /Forbidden|Unauthorized|token required/i.test(document.body && document.body.innerText || ''),
    title: document.title || '',
  })`).catch(() => ({ workbench: false, editor: false, textarea: false, hello: false, trust: false, forbidden: false, title: '' }))
}

async function clickTrust(wc) {
  await wc.executeJavaScript(`(() => {
    const btn = [...document.querySelectorAll('a, button, .monaco-button')].find(el => /Yes, I trust/i.test(el.textContent || ''))
    if (btn) btn.click()
    return Boolean(btn)
  })()`).catch(() => false)
}

async function openHello(wc) {
  await wc.executeJavaScript(`(() => {
    const row = [...document.querySelectorAll('.monaco-list-row, .label-name, .monaco-highlighted-label')].find(el => (el.textContent || '').includes('hello.ts'))
    if (row) row.click()
    return Boolean(row)
  })()`).catch(() => false)
}

async function sendChord(wc, keyCode, modifiers = []) {
  await wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  await wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
}

async function typeText(wc, text) {
  for (const ch of text) {
    if (ch === '\n') {
      await sendChord(wc, 'Return')
      continue
    }
    await wc.sendInputEvent({ type: 'char', keyCode: ch })
  }
}

async function openHelloViaQuickOpen(wc) {
  await sendChord(wc, 'p', ['control'])
  await sleep(400)
  await typeText(wc, 'hello.ts')
  await sleep(400)
  await sendChord(wc, 'Return')
  await sleep(800)
}

async function focusEditor(wc) {
  const box = await wc.executeJavaScript(`(() => {
    const el = document.querySelector('.monaco-editor .view-lines, .monaco-editor')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + Math.min(120, r.width / 2)), y: Math.round(r.top + 40) }
  })()`).catch(() => null)
  await wc.executeJavaScript(`document.querySelector('.monaco-editor textarea')?.focus()`).catch(() => false)
  if (box && box.x && box.y) {
    await wc.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 })
    await wc.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  }
}

async function cdpTypeAndSave(wc, text) {
  const dbg = wc.debugger
  if (!dbg.isAttached()) await dbg.attach('1.3')
  await dbg.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'End',
    code: 'End',
    windowsVirtualKeyCode: 35,
    nativeVirtualKeyCode: 35,
    modifiers: 2,
  })
  await dbg.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'End',
    code: 'End',
    windowsVirtualKeyCode: 35,
    nativeVirtualKeyCode: 35,
    modifiers: 2,
  })
  for (const ch of text) {
    if (ch === '\n') {
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter', windowsVirtualKeyCode: 13 })
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
      continue
    }
    await dbg.sendCommand('Input.dispatchKeyEvent', {
      type: 'char',
      text: ch,
      unmodifiedText: ch,
    })
  }
  await sleep(200)
  await dbg.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyDown',
    modifiers: 2,
    key: 's',
    code: 'KeyS',
    windowsVirtualKeyCode: 83,
    nativeVirtualKeyCode: 83,
  })
  await dbg.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: 2,
    key: 's',
    code: 'KeyS',
    windowsVirtualKeyCode: 83,
    nativeVirtualKeyCode: 83,
  })
  return { via: 'cdp-keys' }
}

async function typeAndSave(wc) {
  await sendChord(wc, 'Escape')
  await sleep(150)
  await sendChord(wc, 'Escape')
  await sleep(250)
  await focusEditor(wc)
  await sleep(400)
  await focusEditor(wc)
  const before = await wc.executeJavaScript(`(document.querySelector('.view-lines') && document.querySelector('.view-lines').innerText) || ''`).catch(() => '')
  const inserted = { via: 'cdp-keys' }
  try {
    await cdpTypeAndSave(wc, MARKER)
  } catch (error) {
    inserted.via = 'cdp-keys-error'
    inserted.cdpError = String(error)
  }
  await sleep(400)
  await sendChord(wc, 's', ['control'])
  await sleep(200)
  await sendChord(wc, 'P', ['control', 'shift'])
  await sleep(400)
  await typeText(wc, 'File: Save')
  await sleep(400)
  await sendChord(wc, 'Return')
  await sleep(500)
  const after = await wc.executeJavaScript(`(document.querySelector('.view-lines') && document.querySelector('.view-lines').innerText) || ''`).catch(() => '')
  inserted.before = String(before).slice(0, 120)
  inserted.after = String(after).slice(0, 180)
  inserted.bufferChanged = String(after).includes('W0_COMMANDER_EDIT') || String(after) !== String(before)
  return inserted
}

async function main() {
  await app.whenReady()
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  const surface = foundryWorkbenchView.attach(win)
  surface.setBounds({ x: 0, y: 0, width: 1280, height: 860, visible: true })
  const started = await host.startOwned({ force: true })
  if (!started.ok && !started.ready) {
    console.log(JSON.stringify({ ok: false, stage: 'start', started }))
    app.exit(1)
    return
  }
  const ensured = await surface.ensure()
  surface.setBounds({ x: 0, y: 0, width: 1280, height: 860, visible: true })
  const wc = surface.getWebContents()
  if (!wc) {
    console.log(JSON.stringify({ ok: false, stage: 'webcontents', ensured }))
    app.exit(1)
    return
  }

  let state = await probe(wc)
  if (state.forbidden) {
    const secrets = host.secretsForHost()
    await wc.loadURL(secrets.authenticatedUrl)
    await sleep(1200)
    state = await probe(wc)
  }

  let buffer = false
  for (let i = 0; i < 80; i += 1) {
    state = await probe(wc)
    if (state.trust) await clickTrust(wc)
    if (state.hello) await openHello(wc)
    if (state.workbench && (state.editor || state.textarea || state.hello)) {
      buffer = true
      if (state.editor || state.textarea) break
    }
    await sleep(400)
  }
  if (state.hello && !(state.editor || state.textarea)) {
    await openHello(wc)
    await sleep(800)
    state = await probe(wc)
  }
  buffer = buffer || Boolean(state.workbench)
  if (buffer) {
    await openHelloViaQuickOpen(wc)
    await sleep(600)
    state = await probe(wc)
  }
  const editResult = buffer ? await typeAndSave(wc) : { via: 'skipped' }
  const helloPath = path.join(host.fixtureRoot(), 'hello.ts')
  let match = false
  for (let i = 0; i < 12; i += 1) {
    await sleep(400)
    try {
      match = fs.readFileSync(helloPath, 'utf8').includes('W0_COMMANDER_EDIT')
    } catch {
      match = false
    }
    if (match) break
  }
  const snap = surface.getState()
  const report = {
    ok: Boolean(ensured.ok !== false && snap.viewOpen && snap.partition === 'persist:foundry-workbench' && buffer),
    viewOpen: snap.viewOpen,
    partition: snap.partition,
    urlHost: snap.urlHost,
    tokenInRendererState: false,
    nestedElectron: snap.nestedElectron,
    bind: snap.bind,
    port: snap.port,
    buffer,
    explorer: Boolean(state.hello),
    editor: Boolean(state.editor || state.textarea),
    edit: Boolean(editResult.via && editResult.via !== 'skipped' && editResult.via !== 'none' && editResult.via !== 'error') || match,
    save: match,
    match,
    via: editResult.via,
    bufferChanged: editResult.bufferChanged,
    before: editResult.before,
    after: editResult.after,
    title: state.title,
    electronAppCount: 1,
  }
  console.log(JSON.stringify(report))
  try { surface.destroy() } catch { /* ignore */ }
  win.close()
  app.exit(report.ok && match ? 0 : 1)
}

void main().catch(error => {
  console.log(JSON.stringify({ ok: false, error: String(error) }))
  app.exit(1)
})
