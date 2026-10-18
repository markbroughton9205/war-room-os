/**
 * Persistent Foundry-owned Chromium. One Playwright persistent context, one on-disk profile
 * under the canonical War Room data hierarchy. Tool calls reuse the same process / tabs / page
 * IDs; they do not launch a disposable browser per action.
 *
 * Secrets (cookies, passwords, bearer tokens, auth headers) are stripped before anything is
 * returned to the model or written to the audit log.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { classifyBrowserTarget } from './commandPolicy'
import { assertCanonicalRepoPath, RepoAccessDeniedError } from './repositoryInspector'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { redactSecretsFromOutput } from './outputRedaction'
import { foundryDataHierarchy } from './foundryPaths'
import { getLocalOwnershipStore, LOCAL_SESSION_COOKIE } from '@/lib/sovereign-runtime/local-ownership'
import { isLoopbackRequestHost } from '@/lib/sovereign-runtime/loopback'
import { getBrowserBroker } from '@/lib/browser-broker'

/**
 * Cursor IDE browser is a separate unauthenticated session. Binding it to
 * browser.local_session would require copying the commander session cookie into
 * an IDE-owned context. That is refused: no secret copy, no auth bypass.
 */
export const BROWSER_IDE_LOCAL_SESSION = 'DEFERRED_SECURITY_BOUNDARY' as const

export function authorizeFoundryBrowserLocalSession(
  input: Record<string, unknown>,
  ctx: { repairId?: string },
): { ok: true; origin: string; host: string } | { ok: false; error: string } {
  if (!ctx.repairId) {
    return { ok: false, error: 'browser.local_session requires Tool Broker mission authorization.' }
  }
  const origin = String(input.origin ?? 'http://127.0.0.1:3848').replace(/\/$/, '')
  try {
    const url = new URL(origin)
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { ok: false, error: 'browser.local_session requires an http(s) loopback origin.' }
    }
    if (!isLoopbackRequestHost(url.host)) {
      return { ok: false, error: 'browser.local_session is loopback-only. LAN and public hosts are denied.' }
    }
    return { ok: true, origin, host: url.host }
  } catch {
    return { ok: false, error: 'browser.local_session requires a loopback origin.' }
  }
}

/** Playwright rejects domain cookies for IP hosts and rejects url+path together. Loopback sessions use url only. */
export function buildLocalSessionCookie(origin: string, token: string): {
  name: string
  value: string
  url: string
  httpOnly: boolean
  sameSite: 'Lax'
} {
  return {
    name: LOCAL_SESSION_COOKIE,
    value: token,
    url: origin,
    httpOnly: true,
    sameSite: 'Lax',
  }
}

const NAV_TIMEOUT_MS = 20_000
const WAIT_TIMEOUT_MS = 10_000
const MAX_DOM_CHARS = 40_000

type PlaywrightPage = import('@playwright/test').Page
type PlaywrightContext = import('@playwright/test').BrowserContext

export const FOUNDRY_BROWSER_TOOL_NAMES = [
  'browser.start',
  'browser.status',
  'browser.restart',
  'browser.stop',
  'browser.tabs',
  'browser.new_tab',
  'browser.switch_tab',
  'browser.close_tab',
  'browser.navigate',
  'browser.back',
  'browser.forward',
  'browser.reload',
  'browser.wait',
  'browser.wait_for_url',
  'browser.wait_for_text',
  'browser.find',
  'browser.click',
  'browser.type',
  'browser.press',
  'browser.scroll',
  'browser.hover',
  'browser.select',
  'browser.get_text',
  'browser.inspect',
  'browser.get_dom',
  'browser.screenshot',
  'browser.console',
  'browser.network',
  'browser.request_details',
  'browser.download',
  'browser.upload',
  'browser.session_status',
  'browser.local_session',
  // PASS 001 aliases kept so existing proofs keep working against the persistent service.
  'browser.open',
  'browser.close',
  'browser.inspect_local',
] as const

export type FoundryBrowserToolName = (typeof FOUNDRY_BROWSER_TOOL_NAMES)[number]

export function isFoundryBrowserToolName(value: string): value is FoundryBrowserToolName {
  return (FOUNDRY_BROWSER_TOOL_NAMES as readonly string[]).includes(value)
}

type ConsoleEntry = { at: string; kind: string; text: string }
type NetworkEntry = { at: string; method: string; url: string; status: number | null; ok: boolean | null }
type RequestRecord = {
  id: string
  at: string
  method: string
  url: string
  resourceType: string
  status: number | null
  headers: Record<string, string>
}

type TabState = {
  pageId: string
  page: PlaywrightPage
  consoleLog: ConsoleEntry[]
  networkLog: NetworkEntry[]
  requests: RequestRecord[]
  downloads: { suggestedFilename: string; savedAs: string; url: string }[]
}

type ServiceState = {
  sessionId: string
  context: PlaywrightContext
  tabs: Map<string, TabState>
  activePageId: string | null
  startedAt: string
  pid: number | null
  profileDir: string
}

export type BrowserToolError = { ok: false; error: string }
export type BrowserToolOk<T> = { ok: true; result: T }
export type BrowserToolResult<T> = BrowserToolOk<T> | BrowserToolError
export type BrokerResult = { ok: boolean; tool: FoundryBrowserToolName; result?: unknown; error?: string }

let service: ServiceState | null = null
let playwrightAvailability: 'unknown' | 'available' | 'unavailable' = 'unknown'

function err(error: string): BrowserToolError {
  return { ok: false, error }
}

function redactUrl(url: string): string {
  return redactSecretsFromOutput(url)
}

export async function assertSafeBrowserTarget(rawUrl: string): Promise<void> {
  const policy = classifyBrowserTarget(rawUrl)
  if (policy.policyClass === 'DENIED') {
    throw new RepoAccessDeniedError(`Browser target denied by allowlist: ${policy.reason}`)
  }
  const parsed = new URL(rawUrl)
  if (parsed.protocol === 'file:') {
    const abs = decodeURIComponent(parsed.pathname)
    const root = path.resolve(resolveRepoRoot())
    const rel = path.relative(root, abs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new RepoAccessDeniedError(`file:// path escapes repository root: ${abs}`)
    }
    await assertCanonicalRepoPath(abs)
  }
}

function syncFoundryTabsFromBroker(): void {
  if (!service) return
  const broker = getBrowserBroker()
  const session = broker.getSession(service.sessionId)
  if (!session) return
  service.context = session.context
  service.pid = broker.chromiumPid()
  service.activePageId = session.activeTabId
  for (const [tabId, brokerTab] of session.tabs) {
    const existing = service.tabs.get(tabId)
    if (existing) {
      existing.page = brokerTab.page
      existing.consoleLog = brokerTab.consoleLog
      existing.networkLog = brokerTab.networkLog
      existing.requests = brokerTab.requests
      existing.downloads = brokerTab.downloads.map(item => ({
        suggestedFilename: item.suggestedFilename,
        savedAs: item.savedAs,
        url: item.url,
      }))
      continue
    }
    service.tabs.set(tabId, {
      pageId: tabId,
      page: brokerTab.page,
      consoleLog: brokerTab.consoleLog,
      networkLog: brokerTab.networkLog,
      requests: brokerTab.requests,
      downloads: brokerTab.downloads.map(item => ({
        suggestedFilename: item.suggestedFilename,
        savedAs: item.savedAs,
        url: item.url,
      })),
    })
  }
  for (const pageId of [...service.tabs.keys()]) {
    if (!session.tabs.has(pageId)) service.tabs.delete(pageId)
  }
}

async function launchService(input: { profileId?: string } = {}): Promise<BrowserToolResult<{ pageId: string; profileDir: string; pid: number | null }>> {
  const dirs = foundryDataHierarchy()
  const broker = getBrowserBroker()
  const started = await broker.start()
  if (!started.ok) {
    playwrightAvailability = 'unavailable'
    return err(started.error)
  }
  playwrightAvailability = broker.diagnostics().playwrightAvailability
  const session = await broker.createSession({
    owner: 'foundry',
    allowLocalhost: true,
    reuseFoundryDefault: !input.profileId,
    sessionMode: input.profileId ? 'TRUSTED_PROFILE' : 'EPHEMERAL',
    profileId: input.profileId,
  })
  if (!session.ok) {
    playwrightAvailability = 'unavailable'
    return err(session.error)
  }
  const live = broker.getSession(session.result.sessionId)
  if (!live) return err('Browser service failed to initialize.')
  service = {
    sessionId: live.sessionId,
    context: live.context,
    tabs: new Map(),
    activePageId: session.result.tabId,
    startedAt: live.createdAt,
    pid: broker.chromiumPid(),
    profileDir: dirs.browserProfile,
  }
  syncFoundryTabsFromBroker()
  await logWarRoomRepoAudit('engineer: browser.start', { pid: service.pid, profileDir: dirs.browserProfile, pageId: service.activePageId })
  return { ok: true, result: { pageId: service.activePageId ?? '', profileDir: dirs.browserProfile, pid: service.pid } }
}

async function ensureService(): Promise<BrowserToolResult<ServiceState>> {
  const broker = getBrowserBroker()
  if (service && broker.getSession(service.sessionId)) {
    syncFoundryTabsFromBroker()
    return { ok: true, result: service }
  }
  const started = await launchService()
  if (!started.ok) return started
  if (!service) return err('Browser service failed to initialize.')
  return { ok: true, result: service }
}

function getTab(pageId?: string): BrowserToolResult<TabState> {
  if (!service) return err('Browser service is not running. Call browser.start first.')
  syncFoundryTabsFromBroker()
  const id = pageId || service.activePageId
  if (!id) return err('No active browser tab.')
  const tab = service.tabs.get(id)
  if (!tab) return err(`Unknown pageId: ${id}`)
  return { ok: true, result: tab }
}

async function addTab(): Promise<BrowserToolResult<{ pageId: string }>> {
  const ensured = await ensureService()
  if (!ensured.ok) return ensured
  const opened = await getBrowserBroker().openTab(ensured.result.sessionId)
  if (!opened.ok) return err(opened.error)
  syncFoundryTabsFromBroker()
  if (service) service.activePageId = opened.result.tabId
  await logWarRoomRepoAudit('engineer: browser.new_tab', { pageId: opened.result.tabId })
  return { ok: true, result: { pageId: opened.result.tabId } }
}

async function listTabs() {
  if (service) syncFoundryTabsFromBroker()
  if (!service) return { running: false, tabs: [] as { pageId: string; url: string; title: string; active: boolean }[] }
  const tabs = []
  for (const [pageId, tab] of service.tabs) {
    tabs.push({
      pageId,
      url: redactUrl(tab.page.url()),
      title: await tab.page.title().catch(() => ''),
      active: pageId === service.activePageId,
    })
  }
  return { running: true, tabs }
}

export async function executeFoundryBrowserTool(
  tool: FoundryBrowserToolName,
  input: Record<string, unknown>,
  ctx: { repairId: string },
): Promise<BrokerResult> {
  const pageId = typeof input.sessionId === 'string' && input.sessionId ? input.sessionId : typeof input.pageId === 'string' ? input.pageId : undefined
  try {
    switch (tool) {
      case 'browser.start':
      case 'browser.open': {
        if (tool === 'browser.start' && service && getBrowserBroker().getSession(service.sessionId)) {
          syncFoundryTabsFromBroker()
          return { ok: true, tool, result: { alreadyRunning: true, pageId: service.activePageId, profileDir: service.profileDir, pid: service.pid, startedAt: service.startedAt } }
        }
        if (tool === 'browser.open') {
          const tab = await addTab()
          return { ok: tab.ok, tool, result: tab.ok ? { sessionId: tab.result.pageId, pageId: tab.result.pageId } : undefined, error: tab.ok ? undefined : tab.error }
        }
        const started = await launchService({ profileId: typeof input.profileId === 'string' ? input.profileId : undefined })
        return { ok: started.ok, tool, result: started.ok ? started.result : undefined, error: started.ok ? undefined : started.error }
      }
      case 'browser.status':
      case 'browser.session_status': {
        const tabs = await listTabs()
        const snapshot = getBrowserBroker().statusSnapshot()
        return {
          ok: true,
          tool,
          result: {
            ...snapshot,
            running: snapshot.chromium_state === 'RUNNING',
            pid: snapshot.chromium_pid,
            startedAt: service?.startedAt ?? null,
            profileDir: service?.profileDir ?? foundryDataHierarchy().browserProfile,
            profileExists: existsSync(foundryDataHierarchy().browserProfile),
            activePageId: service?.activePageId ?? null,
            tabCount: service?.tabs.size ?? 0,
            playwrightAvailability: snapshot.playwright_available ? 'available' : 'unavailable',
            tabs: tabs.tabs,
          },
        }
      }
      case 'browser.restart': {
        const broker = getBrowserBroker()
        if (service) {
          await broker.closeSession(service.sessionId).catch(() => undefined)
          service = null
        }
        await broker.restart()
        const started = await launchService()
        return { ok: started.ok, tool, result: started.ok ? { restarted: true, ...started.result } : undefined, error: started.ok ? undefined : started.error }
      }
      case 'browser.stop': {
        if (!service) return { ok: true, tool, result: { stopped: false } }
        const broker = getBrowserBroker()
        await broker.closeSession(service.sessionId).catch(() => undefined)
        service = null
        if (broker.diagnostics().activeSessions === 0) {
          await broker.stop().catch(() => undefined)
        }
        await logWarRoomRepoAudit('engineer: browser.stop', { repairId: ctx.repairId })
        return { ok: true, tool, result: { stopped: true } }
      }
      case 'browser.tabs':
        return { ok: true, tool, result: await listTabs() }
      case 'browser.new_tab': {
        const tab = await addTab()
        return { ok: tab.ok, tool, result: tab.ok ? tab.result : undefined, error: tab.ok ? undefined : tab.error }
      }
      case 'browser.switch_tab': {
        if (!service) return { ok: false, tool, error: 'Browser service is not running.' }
        if (!pageId) return { ok: false, tool, error: 'Unknown pageId: missing' }
        const switched = await getBrowserBroker().switchTab(service.sessionId, pageId)
        if (!switched.ok) return { ok: false, tool, error: switched.error }
        syncFoundryTabsFromBroker()
        return { ok: true, tool, result: { activePageId: pageId } }
      }
      case 'browser.close_tab':
      case 'browser.close': {
        const tab = getTab(pageId)
        if (!tab.ok || !service) {
          return { ok: true, tool, result: { closed: false } }
        }
        await getBrowserBroker().closeTab(service.sessionId, tab.result.pageId)
        syncFoundryTabsFromBroker()
        await logWarRoomRepoAudit('engineer: browser.close_tab', { pageId: tab.result.pageId })
        return { ok: true, tool, result: { closed: true } }
      }
      case 'browser.navigate': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        await assertSafeBrowserTarget(String(input.url ?? ''))
        const response = await tab.result.page.goto(String(input.url), { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' })
        if (typeof input.waitForSelector === 'string' && input.waitForSelector) {
          await tab.result.page.waitForSelector(input.waitForSelector, { timeout: WAIT_TIMEOUT_MS }).catch(() => undefined)
        }
        const title = await tab.result.page.title()
        await logWarRoomRepoAudit('engineer: browser.navigate', { pageId: tab.result.pageId, url: String(input.url), status: response?.status() ?? null })
        return { ok: true, tool, result: { title, status: response?.status() ?? null, url: redactUrl(tab.result.page.url()), pageId: tab.result.pageId } }
      }
      case 'browser.back': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        await tab.result.page.goBack({ timeout: NAV_TIMEOUT_MS }).catch(() => undefined)
        return { ok: true, tool, result: { url: redactUrl(tab.result.page.url()) } }
      }
      case 'browser.forward': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        await tab.result.page.goForward({ timeout: NAV_TIMEOUT_MS }).catch(() => undefined)
        return { ok: true, tool, result: { url: redactUrl(tab.result.page.url()) } }
      }
      case 'browser.reload': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        await tab.result.page.reload({ timeout: NAV_TIMEOUT_MS })
        return { ok: true, tool, result: { url: redactUrl(tab.result.page.url()) } }
      }
      case 'browser.wait': {
        const ms = Math.min(Number(input.ms ?? input.timeoutMs ?? 500), 15_000)
        await new Promise(resolve => setTimeout(resolve, Number.isFinite(ms) ? ms : 500))
        return { ok: true, tool, result: { waitedMs: ms } }
      }
      case 'browser.wait_for_url': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        const pattern = String(input.url ?? input.pattern ?? '')
        await tab.result.page.waitForURL(pattern, { timeout: WAIT_TIMEOUT_MS })
        return { ok: true, tool, result: { url: redactUrl(tab.result.page.url()) } }
      }
      case 'browser.wait_for_text': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        const text = String(input.text ?? '')
        await tab.result.page.getByText(text).first().waitFor({ timeout: WAIT_TIMEOUT_MS })
        return { ok: true, tool, result: { found: true, text } }
      }
      case 'browser.find': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        const selector = String(input.selector ?? '')
        const locator = tab.result.page.locator(selector)
        const count = Math.min(await locator.count(), typeof input.limit === 'number' ? input.limit : 20)
        const matches: { text: string; visible: boolean }[] = []
        for (let i = 0; i < count; i += 1) {
          const el = locator.nth(i)
          matches.push({
            text: redactSecretsFromOutput((await el.innerText().catch(() => '')).slice(0, 300)),
            visible: await el.isVisible().catch(() => false),
          })
        }
        return { ok: true, tool, result: { matches } }
      }
      case 'browser.click': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        const selector = typeof input.selector === 'string' ? input.selector.trim() : ''
        const testId = typeof input.testId === 'string' ? input.testId.trim() : ''
        const text = typeof input.text === 'string' ? input.text.trim() : ''
        const locator = selector
          ? tab.result.page.locator(selector)
          : testId
            ? tab.result.page.getByTestId(testId)
            : text
              ? tab.result.page.getByText(text, { exact: false })
              : null
        if (!locator) return { ok: false, tool, error: 'browser.click requires selector, testId, or text.' }
        await locator.first().click({ timeout: WAIT_TIMEOUT_MS })
        await logWarRoomRepoAudit('engineer: browser.click', { pageId: tab.result.pageId, selector: selector || testId || text })
        return { ok: true, tool, result: { clicked: true } }
      }
      case 'browser.local_session': {
        const gate = authorizeFoundryBrowserLocalSession(input, ctx)
        if (!gate.ok) return { ok: false, tool, error: gate.error }
        const { loadMission } = await import('./foundryMissionStore')
        const mission = await loadMission(ctx.repairId)
        if (!mission) return { ok: false, tool, error: 'browser.local_session requires an authorized Foundry mission.' }
        if (mission.archived === true) return { ok: false, tool, error: 'browser.local_session refused for archived missions.' }
        const ensured = await ensureService()
        if (!ensured.ok) return { ok: false, tool, error: ensured.error }
        const origin = gate.origin
        const tab = getTab(pageId)
        if (tab.ok) {
          await tab.result.page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => undefined)
        }
        const store = getLocalOwnershipStore()
        const identity = store.getCommanderPublic()
        if (!identity) return { ok: false, tool, error: 'LOCAL_COMMANDER_IDENTITY_MISSING' }
        const auth = store.issueSession(identity.id, identity.installation_id)
        await ensured.result.context.addCookies([buildLocalSessionCookie(origin, auth.token)])
        if (tab.ok) {
          await tab.result.page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => undefined)
        }
        await logWarRoomRepoAudit('engineer: browser.local_session', { origin, authenticated: true, loopback: true })
        return { ok: true, tool, result: { authenticated: true, origin, loopback: true } }
      }
      case 'browser.type': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        const text = String(input.text ?? '')
        await tab.result.page.locator(String(input.selector ?? '')).first().fill(text, { timeout: WAIT_TIMEOUT_MS })
        await logWarRoomRepoAudit('engineer: browser.type', { pageId: tab.result.pageId, selector: String(input.selector ?? ''), chars: text.length })
        return { ok: true, tool, result: { typed: true } }
      }
      case 'browser.press': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        await tab.result.page.keyboard.press(String(input.key ?? ''))
        return { ok: true, tool, result: { pressed: String(input.key ?? '') } }
      }
      case 'browser.scroll': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        const dy = typeof input.dy === 'number' ? input.dy : 400
        await tab.result.page.mouse.wheel(typeof input.dx === 'number' ? input.dx : 0, dy)
        return { ok: true, tool, result: { scrolled: true, dy } }
      }
      case 'browser.hover': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        await tab.result.page.locator(String(input.selector ?? '')).first().hover({ timeout: WAIT_TIMEOUT_MS })
        return { ok: true, tool, result: { hovered: true } }
      }
      case 'browser.select': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        const value = String(input.value ?? input.option ?? '')
        await tab.result.page.locator(String(input.selector ?? '')).first().selectOption(value)
        return { ok: true, tool, result: { selected: value } }
      }
      case 'browser.get_text': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        const selector = input.selector ? String(input.selector) : 'body'
        const text = redactSecretsFromOutput((await tab.result.page.locator(selector).innerText()).slice(0, 8_000))
        return { ok: true, tool, result: { text } }
      }
      case 'browser.inspect': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        const snapshot = await tab.result.page.locator('body').ariaSnapshot().catch(() => '')
        return {
          ok: true,
          tool,
          result: {
            url: redactUrl(tab.result.page.url()),
            title: await tab.result.page.title(),
            aria: redactSecretsFromOutput(snapshot).slice(0, 8_000),
          },
        }
      }
      case 'browser.get_dom': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        const html = redactSecretsFromOutput((await tab.result.page.content()).slice(0, MAX_DOM_CHARS))
        return { ok: true, tool, result: { html, truncated: true } }
      }
      case 'browser.screenshot': {
        const tab = getTab(pageId)
        if (!tab.ok || !service) return { ok: false, tool, error: tab.ok ? 'Browser service is not running.' : tab.error }
        const shot = await getBrowserBroker().screenshot(service.sessionId, tab.result.pageId, {
          fullPage: input.fullPage === true,
          repairId: ctx.repairId,
        })
        await logWarRoomRepoAudit('engineer: browser.screenshot', { pageId: tab.result.pageId, path: shot.ok ? shot.result.path : null, strategy: shot.ok ? shot.result.strategy : null })
        return { ok: shot.ok, tool, result: shot.ok ? shot.result : undefined, error: shot.ok ? undefined : shot.error }
      }
      case 'browser.console': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        return { ok: true, tool, result: { entries: tab.result.consoleLog } }
      }
      case 'browser.network': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        return { ok: true, tool, result: { entries: tab.result.networkLog } }
      }
      case 'browser.request_details': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        const id = input.requestId ? String(input.requestId) : null
        const found = id ? tab.result.requests.find(r => r.id === id) : tab.result.requests.at(-1)
        if (!found) return { ok: false, tool, error: 'No matching request captured.' }
        return { ok: true, tool, result: found }
      }
      case 'browser.download': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        const url = String(input.url ?? '')
        if (url) {
          await assertSafeBrowserTarget(url)
          const [download] = await Promise.all([
            tab.result.page.waitForEvent('download', { timeout: WAIT_TIMEOUT_MS }),
            tab.result.page.goto(url, { timeout: NAV_TIMEOUT_MS }).catch(() => undefined),
          ])
          const dirs = foundryDataHierarchy()
          const dest = path.join(dirs.browserDownloads, `${Date.now()}-${download.suggestedFilename()}`)
          await download.saveAs(dest)
          const record = { suggestedFilename: download.suggestedFilename(), savedAs: dest, url: redactUrl(download.url()) }
          tab.result.downloads.push(record)
          await logWarRoomRepoAudit('engineer: browser.download', { savedAs: dest, suggestedFilename: record.suggestedFilename })
          return { ok: true, tool, result: record }
        }
        return { ok: true, tool, result: { downloads: tab.result.downloads } }
      }
      case 'browser.upload': {
        const tab = getTab(pageId)
        if (!tab.ok) return { ok: false, tool, error: tab.error }
        const filePath = String(input.filePath ?? input.path ?? '')
        if (!filePath) return { ok: false, tool, error: 'browser.upload requires filePath inside the workspace or Foundry uploads dir.' }
        const abs = path.resolve(filePath)
        const dirs = foundryDataHierarchy()
        const inUploads = !path.relative(dirs.browserUploads, abs).startsWith('..')
        if (!inUploads) await assertCanonicalRepoPath(abs)
        await tab.result.page.locator(String(input.selector ?? 'input[type=file]')).first().setInputFiles(abs)
        await logWarRoomRepoAudit('engineer: browser.upload', { selector: String(input.selector ?? 'input[type=file]'), bytesHint: 'omitted' })
        return { ok: true, tool, result: { uploaded: true } }
      }
      case 'browser.inspect_local':
        return { ok: false, tool, error: 'Use browser.inspect_local via inspectLocalPage in browserInspector.ts.' }
      default: {
        const exhaustive: never = tool
        return { ok: false, tool: exhaustive, error: 'Unknown browser tool.' }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, tool, error: message }
  }
}

export async function browserOpen(input: { repairId: string }): Promise<BrowserToolResult<{ sessionId: string }>> {
  const result = await executeFoundryBrowserTool('browser.open', {}, input)
  if (!result.ok) return err(result.error ?? 'browser.open failed')
  const sessionId = (result.result as { sessionId?: string }).sessionId
  if (!sessionId) return err('browser.open did not return a sessionId')
  return { ok: true, result: { sessionId } }
}

export async function browserNavigate(input: { sessionId: string; url: string; waitForSelector?: string }): Promise<BrowserToolResult<{ title: string; status: number | null; url: string }>> {
  const result = await executeFoundryBrowserTool('browser.navigate', input, { repairId: 'compat' })
  if (!result.ok) return err(result.error ?? 'navigate failed')
  return { ok: true, result: result.result as { title: string; status: number | null; url: string } }
}

export async function browserFind(input: { sessionId: string; selector: string; limit?: number }): Promise<BrowserToolResult<{ matches: { text: string; visible: boolean }[] }>> {
  const result = await executeFoundryBrowserTool('browser.find', input, { repairId: 'compat' })
  if (!result.ok) return err(result.error ?? 'find failed')
  return { ok: true, result: result.result as { matches: { text: string; visible: boolean }[] } }
}

export async function browserClick(input: { sessionId: string; selector: string }): Promise<BrowserToolResult<{ clicked: boolean }>> {
  const result = await executeFoundryBrowserTool('browser.click', input, { repairId: 'compat' })
  if (!result.ok) return err(result.error ?? 'click failed')
  return { ok: true, result: { clicked: true } }
}

export async function browserType(input: { sessionId: string; selector: string; text: string }): Promise<BrowserToolResult<{ typed: boolean }>> {
  const result = await executeFoundryBrowserTool('browser.type', input, { repairId: 'compat' })
  if (!result.ok) return err(result.error ?? 'type failed')
  return { ok: true, result: { typed: true } }
}

export async function browserScreenshot(input: { sessionId: string; repairId: string; fullPage?: boolean }): Promise<BrowserToolResult<{ path: string }>> {
  const result = await executeFoundryBrowserTool('browser.screenshot', input, { repairId: input.repairId })
  if (!result.ok) return err(result.error ?? 'screenshot failed')
  return { ok: true, result: result.result as { path: string } }
}

export async function browserConsole(input: { sessionId: string }): Promise<BrowserToolResult<{ entries: ConsoleEntry[] }>> {
  const result = await executeFoundryBrowserTool('browser.console', input, { repairId: 'compat' })
  if (!result.ok) return err(result.error ?? 'console failed')
  return { ok: true, result: result.result as { entries: ConsoleEntry[] } }
}

export async function browserNetwork(input: { sessionId: string }): Promise<BrowserToolResult<{ entries: NetworkEntry[] }>> {
  const result = await executeFoundryBrowserTool('browser.network', input, { repairId: 'compat' })
  if (!result.ok) return err(result.error ?? 'network failed')
  return { ok: true, result: result.result as { entries: NetworkEntry[] } }
}

export async function browserClose(input: { sessionId: string }): Promise<BrowserToolResult<{ closed: boolean }>> {
  const result = await executeFoundryBrowserTool('browser.close', { sessionId: input.sessionId }, { repairId: 'compat' })
  return { ok: true, result: { closed: Boolean((result.result as { closed?: boolean } | undefined)?.closed) } }
}

/** Closes the persistent browser process itself (not just a tab). The browser is deliberately
 * long-lived across tool calls — callers (proof scripts, validation suites) that are done for
 * good must call this explicitly, or the process holding it open will never exit on its own. */
export async function browserStopService(): Promise<void> {
  await executeFoundryBrowserTool('browser.stop', {}, { repairId: 'compat' })
}

export function isFoundryBrowserServiceRunning(): boolean {
  if (!service) return false
  return getBrowserBroker().getSession(service.sessionId) != null
}

export function resetPlaywrightAvailabilityForTests(): void {
  playwrightAvailability = 'unknown'
}

export function getPlaywrightAvailability(): typeof playwrightAvailability {
  const fromBroker = getBrowserBroker().diagnostics().playwrightAvailability
  return fromBroker === 'unknown' ? playwrightAvailability : fromBroker
}

export function foundryBrowserProfilePath(): string {
  return foundryDataHierarchy().browserProfile
}
