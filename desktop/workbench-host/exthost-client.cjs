/**
 * Keep-alive Workbench guest so the real extension host activates.
 * Not a second product. Not nested Code-OSS. Not production sandbox policy.
 */
'use strict'

process.env.FOUNDRY_WORKBENCH_W0 = '1'

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const foundryWorkbenchView = require('../src/foundryWorkbench.cjs')
const host = require('./index.cjs')

if (process.platform === 'linux' && process.env.FOUNDRY_WORKBENCH_ALLOW_SANDBOX_BYPASS === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-setuid-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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
  const health = await host.health()
  const started = health.ready === true ? health : await host.startOwned({ force: true })
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
  const secrets = host.secretsForHost()
  if (secrets && secrets.authenticatedUrl) {
    await wc.loadURL(secrets.authenticatedUrl).catch(() => undefined)
  }
  let workbench = false
  for (let i = 0; i < 90; i += 1) {
    const state = await wc.executeJavaScript(`({
      workbench: !!document.querySelector('.monaco-workbench'),
      title: document.title || '',
    })`).catch(() => ({ workbench: false, title: '' }))
    if (state.workbench) {
      workbench = true
      break
    }
    await sleep(400)
  }
  const readyFile = path.join(host.stateDir(), 'exthost-client-ready.json')
  fs.writeFileSync(readyFile, `${JSON.stringify({
    ok: workbench,
    at: new Date().toISOString(),
    title: 'Foundry Workbench',
  }, null, 2)}\n`)
  const stopFile = path.join(host.stateDir(), 'exthost-client-stop.json')
  const deadline = Date.now() + 12 * 60 * 1000
  while (Date.now() < deadline) {
    if (fs.existsSync(stopFile)) break
    await sleep(500)
  }
  try { fs.unlinkSync(stopFile) } catch { /* none */ }
  try { surface.destroy() } catch { /* ignore */ }
  win.close()
  app.exit(workbench ? 0 : 1)
}

void main().catch(error => {
  console.log(JSON.stringify({ ok: false, error: String(error) }))
  app.exit(1)
})
