/**
 * Browser and persistence acceptance for the Harbor Desk CRM project.
 * Uses Playwright against the owned loopback preview. Synthetic data only.
 */
import http from 'node:http'
import { startProjectProcess } from './foundryProjectIsolation'
import { findLiveProjectPreview, stopOwnedProjectPreview } from './foundryProjectProcessRegistry'
import { CRM_BRAND } from './foundryCrmFactory'

export const CRM_SYNTHETIC = {
  firstName: 'Alex',
  lastName: 'Johnson',
  company: 'Northstar Logistics',
  companyEdited: 'Northstar Logistics Group',
  email: 'alex@example.test',
  phone: '555-0101',
  service: 'Commercial Delivery',
  note: 'Called about weekday dock appointments.',
  followUpDate: '2026-09-25',
}

export type CrmAcceptanceEvidence = Record<string, string | boolean>

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

async function loadPlaywright() {
  return (await import('./foundryPlaywright')).loadPlaywrightChromium()
}

export async function runCrmBrowserAcceptance(input: {
  origin: string
  includeFollowUp?: boolean
}): Promise<{ ok: boolean; evidence: CrmAcceptanceEvidence; detail: string }> {
  const evidence: CrmAcceptanceEvidence = {}
  const loaded = await loadPlaywright()
  if (!loaded) {
    return { ok: false, evidence, detail: 'Playwright Chromium was not resolvable' }
  }
  const browser = await loaded.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    executablePath: loaded.executablePath,
  }).catch(() => null)
  if (!browser) return { ok: false, evidence, detail: 'Chromium launch failed' }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  try {
    await page.goto(input.origin, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.locator('[data-testid="crm-shell"]').waitFor({ timeout: 10_000 })
    evidence.shell = (await page.locator('body').innerText()).includes(CRM_BRAND)

    if (!input.includeFollowUp) {
      await page.locator('[data-testid="nav-new"]').click()
      const createForm = page.locator('[data-testid="lead-form"]')
      await createForm.waitFor({ state: 'visible' })
      await createForm.locator('[name="firstName"]').fill(CRM_SYNTHETIC.firstName)
      await createForm.locator('[name="lastName"]').fill(CRM_SYNTHETIC.lastName)
      await createForm.locator('[name="company"]').fill(CRM_SYNTHETIC.company)
      await createForm.locator('[name="email"]').fill(CRM_SYNTHETIC.email)
      await createForm.locator('[name="phone"]').fill(CRM_SYNTHETIC.phone)
      await createForm.locator('[name="serviceInterest"]').fill(CRM_SYNTHETIC.service)
      await createForm.locator('[name="notes"]').fill(CRM_SYNTHETIC.note)
      await createForm.locator('button[type="submit"]').click()
      await page.locator('[data-testid="lead-detail"]').waitFor({ state: 'visible', timeout: 10_000 })
      evidence.createLead = (await page.locator('[data-testid="detail-name"]').innerText()).includes('Alex Johnson')
      await page.waitForTimeout(400)
      evidence.note = /weekday dock/i.test(await page.locator('[data-testid="note-list"]').innerText())

      await page.locator('[data-testid="nav-leads"]').click()
      await page.locator('[data-testid="lead-search"]').fill('Alex')
      await page.waitForTimeout(500)
      const searchText = await page.locator('[data-testid="lead-list"]').innerText()
      evidence.search = /Alex Johnson/.test(searchText) && /Northstar Logistics/.test(searchText)

      await page.locator('[data-testid="lead-filter"]').selectOption('new')
      await page.waitForTimeout(500)
      evidence.filter = /Alex Johnson/.test(await page.locator('[data-testid="lead-list"]').innerText())

      await page.locator('[data-testid="lead-list"] tr[data-id]').first().click()
      await page.locator('[data-testid="edit-company"]').fill(CRM_SYNTHETIC.companyEdited)
      await page.locator('[data-testid="edit-form"] button[type="submit"]').click()
      await page.waitForTimeout(500)
      evidence.edit = (await page.locator('[data-testid="edit-company"]').inputValue()) === CRM_SYNTHETIC.companyEdited

      await page.locator('[data-testid="note-body"]').fill('Follow-up: confirm dock hours.')
      await page.locator('[data-testid="note-form"] button[type="submit"]').click()
      await page.waitForTimeout(500)
      evidence.note = evidence.note === true || /weekday dock|dock hours/i.test(await page.locator('[data-testid="note-list"]').innerText())

      await page.locator('[data-testid="status-select"]').selectOption('qualified')
      await page.locator('[data-testid="save-status"]').click()
      await page.waitForTimeout(500)
      evidence.status = /Qualified/i.test(await page.locator('[data-testid="detail-status"]').innerText())

      await page.locator('[data-testid="convert-customer"]').click()
      await page.waitForTimeout(400)
      evidence.convert = /Customer/i.test(await page.locator('[data-testid="detail-status"]').innerText())

      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('[data-testid="lead-detail"]').waitFor({ state: 'visible', timeout: 10_000 })
      const company = await page.locator('[data-testid="edit-company"]').inputValue()
      const status = await page.locator('[data-testid="detail-status"]').innerText()
      const notes = await page.locator('[data-testid="note-list"]').innerText()
      evidence.reloadPersist = company === CRM_SYNTHETIC.companyEdited && /Customer/i.test(status) && /weekday dock|dock hours/i.test(notes)
    } else {
      await page.locator('[data-testid="nav-leads"]').click()
      await page.locator('[data-testid="lead-search"]').fill('Alex')
      await page.locator('[data-testid="lead-list"] tr[data-id]').first().waitFor({ timeout: 10_000 })
      const list = await page.locator('[data-testid="lead-list"]').innerText()
      evidence.dataPreserved = /Alex Johnson/.test(list) && /Northstar Logistics Group/.test(list)
      await page.locator('[data-testid="lead-list"] tr[data-id]').first().click()
      await page.locator('[data-testid="follow-up-date"]').fill(CRM_SYNTHETIC.followUpDate)
      await page.locator('[data-testid="edit-form"] button[type="submit"]').click()
      await page.waitForTimeout(500)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('[data-testid="follow-up-date"]').waitFor({ timeout: 10_000 })
      evidence.followUp = (await page.locator('[data-testid="follow-up-date"]').inputValue()) === CRM_SYNTHETIC.followUpDate
      const name = await page.locator('[data-testid="detail-name"]').innerText()
      const company = await page.locator('[data-testid="edit-company"]').inputValue()
      evidence.reloadPersist = /Alex Johnson/.test(name) && company.includes('Northstar Logistics')
    }

    const dash = await loopbackJson({ origin: input.origin, path: '/api/dashboard' })
    evidence.dashboard = Boolean(dash.json && typeof dash.json.customers === 'number' && dash.json.customers >= 1 && dash.json.totalLeads >= 1)

    const ok = input.includeFollowUp
      ? evidence.dataPreserved === true && evidence.followUp === true && evidence.dashboard === true
      : evidence.createLead === true && evidence.search === true && evidence.filter === true
        && evidence.edit === true && evidence.note === true && evidence.status === true
        && evidence.convert === true && evidence.reloadPersist === true && evidence.dashboard === true
    return { ok, evidence, detail: JSON.stringify(evidence) }
  } catch (error) {
    return { ok: false, evidence, detail: error instanceof Error ? error.message : String(error) }
  } finally {
    await page.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
}

export async function proveCrmRestartPersistence(input: {
  origin: string
  originPort: number
  projectId: string
  projectRoot: string
  missionId: string
}): Promise<{ ok: boolean; detail: string; pid?: number; recordId?: string }> {
  const before = await loopbackJson({ origin: input.origin, path: '/api/leads?q=Alex' })
  const hasAlex = Boolean(before.json?.leads?.some((lead: { firstName?: string; email?: string }) => lead.email === CRM_SYNTHETIC.email || lead.firstName === 'Alex'))
  if (!hasAlex) return { ok: false, detail: `missing Alex before restart: ${before.text.slice(0, 300)}` }
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
  if (!started.ok) return { ok: false, detail: started.error || 'restart spawn failed' }
  await new Promise(resolve => setTimeout(resolve, 700))
  const after = await loopbackJson({ origin: input.origin, path: '/api/leads?q=Alex' })
  const still = Boolean(after.json?.leads?.some((lead: { email?: string; company?: string }) => lead.email === CRM_SYNTHETIC.email && /Northstar/.test(lead.company || '')))
  const live = await findLiveProjectPreview({ projectId: input.projectId, projectRoot: input.projectRoot })
  return {
    ok: still,
    detail: still ? `pid=${started.pid} records preserved` : after.text.slice(0, 400),
    pid: live?.pid ?? started.pid,
    recordId: started.recordId,
  }
}

export async function verifyCrmViewports(origin: string): Promise<Array<{
  name: 'desktop' | 'tablet' | 'mobile'
  width: number
  height: number
  ok: boolean
  detail: string
  overflow: boolean
  blankScreen: boolean
  missingContent: boolean
}>> {
  const checks = [
    { name: 'desktop' as const, width: 1280, height: 800 },
    { name: 'tablet' as const, width: 768, height: 1024 },
    { name: 'mobile' as const, width: 390, height: 844 },
  ]
  const chromium = await loadPlaywright()
  if (!chromium) {
    return checks.map(check => ({
      ...check,
      ok: false,
      detail: 'Playwright unavailable',
      overflow: false,
      blankScreen: true,
      missingContent: true,
    }))
  }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }).catch(() => null)
  if (!browser) {
    return checks.map(check => ({ ...check, ok: false, detail: 'Chromium launch failed', overflow: false, blankScreen: true, missingContent: true }))
  }
  const results = []
  try {
    for (const check of checks) {
      const page = await browser.newPage({ viewport: { width: check.width, height: check.height } })
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      const body = await page.locator('body').innerText()
      const shell = await page.locator('[data-testid="crm-shell"]').count()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 24)
      const blank = !body.trim()
      results.push({
        name: check.name,
        width: check.width,
        height: check.height,
        ok: shell > 0 && body.includes(CRM_BRAND) && !blank,
        detail: overflow ? 'horizontal overflow noted' : 'rendered',
        overflow,
        blankScreen: blank,
        missingContent: shell === 0,
      })
      await page.close()
    }
  } finally {
    await browser.close().catch(() => undefined)
  }
  return results
}
