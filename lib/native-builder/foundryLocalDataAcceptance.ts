/**
 * HTTP + restart acceptance for Commander-local database-backed apps.
 * Synthetic data only. Does not touch Harbor Desk or Transportation Website.
 */
import http from 'node:http'
import { startProjectProcess } from './foundryProjectIsolation'
import { findLiveProjectPreview, stopOwnedProjectPreview } from './foundryProjectProcessRegistry'
import { loadPlaywrightChromium } from './foundryPlaywright'

export const LOCAL_DATA_SYNTHETIC = {
  name: 'Foundry Probe Widget',
  quantity: 7,
  category: 'Hardware',
  notes: 'Synthetic acceptance record',
  editedQuantity: 3,
}

async function loopbackJson(input: {
  origin: string
  method?: string
  path: string
  body?: unknown
}): Promise<{ ok: boolean; status: number; text: string; json: any }> {
  const url = new URL(input.path, input.origin)
  const payload = input.body == null ? null : Buffer.from(JSON.stringify(input.body))
  return new Promise(resolve => {
    const req = http.request({
      host: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: input.method || 'GET',
      agent: false,
      timeout: 10_000,
      headers: payload
        ? { 'content-type': 'application/json', 'content-length': payload.length }
        : { accept: 'application/json' },
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(Buffer.from(chunk)))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8').slice(0, 50_000)
        let json: any = null
        try { json = JSON.parse(text) } catch { json = null }
        resolve({
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400,
          status: res.statusCode ?? 0,
          text,
          json,
        })
      })
    })
    req.on('error', error => resolve({ ok: false, status: 0, text: error.message, json: null }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 0, text: 'timeout', json: null })
    })
    if (payload) req.write(payload)
    req.end()
  })
}

export async function runLocalDataBrowserAcceptance(input: {
  origin: string
  includeLowStock?: boolean
}): Promise<{ ok: boolean; evidence: Record<string, string | boolean>; detail: string }> {
  const evidence: Record<string, string | boolean> = {}
  const loaded = await loadPlaywrightChromium()
  if (!loaded) {
    return { ok: false, evidence, detail: 'PLAYWRIGHT_NOT_INSTALLED' }
  }
  const browser = await loaded.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    executablePath: loaded.executablePath,
  }).catch(() => null)
  if (!browser) return { ok: false, evidence, detail: 'PLAYWRIGHT_LAUNCH_FAILED' }
  const name = `Playwright Crate ${['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'][Math.floor(Math.random() * 6)]}`
  const consoleErrors: string[] = []
  const ignoreConsole = (message: { type: () => string; text: () => string; location: () => { url?: string } }) => {
    if (message.type() !== 'error') return
    const text = message.text()
    const url = message.location()?.url ?? ''
    if (/favicon\.ico/i.test(text) || /favicon\.ico/i.test(url)) return
    if (/Failed to load resource/.test(text) && /404/.test(text) && !/\/api\//.test(url)) return
    consoleErrors.push(`${text} ${url}`.trim())
  }
  try {
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    desktop.on('console', ignoreConsole)
    await desktop.goto(input.origin, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await desktop.locator('[data-testid="inventory-app"]').waitFor({ timeout: 10_000 })
    evidence.render = /Local Inventory Manager/i.test(await desktop.locator('body').innerText())
    evidence.list = await desktop.locator('[data-testid="item-rows"]').count() > 0

    await desktop.locator('[data-testid="item-name"]').fill(name)
    await desktop.locator('[data-testid="item-quantity"]').fill('1')
    await desktop.locator('[data-testid="item-category"]').fill('Hardware')
    await desktop.locator('[data-testid="item-notes"]').fill('playwright acceptance')
    await desktop.locator('[data-testid="item-save"]').click()
    await desktop.waitForTimeout(400)
    evidence.add = (await desktop.locator('[data-testid="item-rows"]').innerText()).includes(name)

    await desktop.evaluate(itemName => {
      const rows = [...document.querySelectorAll('[data-testid="item-rows"] tr')]
      const tr = rows.find(row => row.textContent?.includes(itemName))
      const button = tr?.querySelector('button[data-edit]') as HTMLButtonElement | null
      button?.click()
    }, name)
    await desktop.waitForFunction(expected => {
      const field = document.querySelector('[data-testid="item-name"]') as HTMLInputElement | null
      return Boolean(field && field.value === expected)
    }, name, { timeout: 8_000 })
    await desktop.locator('[data-testid="item-quantity"]').fill('4')
    await desktop.locator('[data-testid="item-save"]').click()
    await desktop.waitForTimeout(500)
    evidence.edit = /\b4\b/.test(await desktop.locator('[data-testid="item-rows"] tr', { hasText: name }).first().innerText())

    await desktop.locator('[data-testid="item-search"]').fill(name)
    await desktop.waitForTimeout(300)
    evidence.search = (await desktop.locator('[data-testid="item-rows"]').innerText()).includes(name)

    if (input.includeLowStock !== false) {
      await desktop.locator('[data-testid="item-search"]').fill('')
      await desktop.locator('[data-testid="low-stock-filter"]').check()
      await desktop.waitForTimeout(400)
      const filtered = await desktop.locator('[data-testid="item-rows"]').innerText()
      evidence.lowStock = filtered.includes(name)
    }

    await desktop.reload({ waitUntil: 'domcontentloaded' })
    await desktop.locator('[data-testid="inventory-app"]').waitFor({ timeout: 10_000 })
    evidence.reload = (await desktop.locator('[data-testid="item-rows"]').innerText()).includes(name)
    await desktop.close()

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
    mobile.on('console', ignoreConsole)
    await mobile.goto(input.origin, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await mobile.locator('[data-testid="inventory-app"]').waitFor({ timeout: 10_000 })
    evidence.mobile = /Local Inventory Manager/i.test(await mobile.locator('body').innerText())
    await mobile.close()

    evidence.consoleClean = consoleErrors.length === 0
    evidence.playwright = true
  } finally {
    await browser.close().catch(() => undefined)
  }
  const missing = Object.entries(evidence).filter(([, ok]) => !ok).map(([key]) => key)
  return {
    ok: missing.length === 0,
    evidence,
    detail: missing.length ? `failed ${missing.join(',')}${consoleErrors[0] ? ` ${consoleErrors[0]}` : ''}` : 'playwright local data acceptance pass',
  }
}

export async function proveLocalDataRestartPersistence(input: {
  origin: string
  originPort: number
  projectId: string
  projectRoot: string
  missionId: string
}): Promise<{ ok: boolean; detail: string; recordId?: string; pid?: number }> {
  const listed = await loopbackJson({ origin: input.origin, path: '/api/items?q=Foundry%20Probe' })
  const before = listed.json?.items?.length ?? 0
  if (before < 1) return { ok: false, detail: 'no synthetic record before restart' }
  await stopOwnedProjectPreview({ projectId: input.projectId })
  await new Promise(resolve => setTimeout(resolve, 400))
  const started = await startProjectProcess({
    projectRoot: input.projectRoot,
    cmd: 'node',
    args: ['server.mjs'],
    label: 'foundry-app-preview',
    missionId: input.missionId,
    env: { PORT: String(input.originPort) },
    projectId: input.projectId,
    port: input.originPort,
    processType: 'preview',
    retainAfterWrapper: true,
  })
  if (!started.ok) return { ok: false, detail: started.error || 'preview restart failed' }
  await new Promise(resolve => setTimeout(resolve, 500))
  const origin = `http://127.0.0.1:${input.originPort}`
  const after = await loopbackJson({ origin, path: '/api/items?q=Foundry%20Probe' })
  const live = await findLiveProjectPreview({ projectId: input.projectId, projectRoot: input.projectRoot })
  const ok = (after.json?.items?.length ?? 0) >= before
  return {
    ok,
    detail: ok ? `persisted ${after.json.items.length} after restart` : `lost records after restart: ${after.text.slice(0, 200)}`,
    recordId: started.recordId ?? live?.recordId,
    pid: started.pid ?? live?.pid,
  }
}
