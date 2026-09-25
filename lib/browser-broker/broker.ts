/**
 * War Room-owned Browser Broker.
 * One Playwright Chromium process shared by Council and Foundry.
 * Ephemeral sessions are isolated BrowserContexts (no shared cookies/storage).
 * Persistent authenticated profiles are Phase 2.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { redactSecretsFromOutput } from '@/lib/native-builder/outputRedaction'
import { chromiumChildEnv, loadPlaywrightChromium, resolvePlaywrightChromiumExecutable } from '@/lib/native-builder/foundryPlaywright'
import { classifyBrowserAction } from './actionClassifier'
import { parseStructuredReleases } from './researchPolicy'
import { browserBrokerDataDirs, playwrightTmpDir, withPlaywrightTmpDir } from './paths'
import { planScreenshot, SCREENSHOT_LIMITS, type ScreenshotPlan } from './screenshotPolicy'
import { capabilityFor } from './capabilityTable'
import { detectHumanInteractionRequired, inferAuthState } from './humanSignals'
import { evaluateOriginAccess } from './originPolicy'
import {
  createTrustedProfile,
  deleteTrustedProfile,
  hashProfileId,
  listProfiles,
  loadProfile,
  markProfileUsed,
  migrateAllLegacyProfiles,
  profileStoreDiagnostics,
  readStorageStateForReuse,
  rotateAllProfileKeys,
  setProfileState,
  storageStateExists,
  writeEncryptedStorageState,
} from './profileStore'
import { recordBrowserAudit } from './sessionAudit'
import type { ControlState, TrustedBrowserProfileV1 } from './profileTypes'
import type {
  BrowserActionKind,
  BrowserActionRequest,
  BrowserBrokerDiagnostics,
  BrowserBrokerFailure,
  BrowserBrokerHealth,
  BrowserStatusSnapshot,
  ChromiumRuntimeState,
  BrowserCitation,
  BrowserConsoleEntry,
  BrowserDownloadRecord,
  BrowserExtractedPage,
  BrowserNetworkEntry,
  BrowserOwner,
  BrowserSessionInfo,
  BrowserSessionKind,
  BrowserSourceType,
} from './types'

type PlaywrightBrowser = import('@playwright/test').Browser
type PlaywrightBrowserServer = import('@playwright/test').BrowserServer
type PlaywrightContext = import('@playwright/test').BrowserContext
type PlaywrightPage = import('@playwright/test').Page

const NAV_TIMEOUT_MS = 25_000
const WAIT_TIMEOUT_MS = 12_000
const MAX_CONSOLE = 300
const MAX_NETWORK = 300
const MAX_TEXT = 16_000
const MAX_LINKS = 40
const MAX_HEADINGS = 30
const FILE_SCHEME = /^file:/i
const SENSITIVE_HEADER = /^(cookie|set-cookie|authorization|proxy-authorization|www-authenticate|x-api-key|x-auth-token)$/i

export type BrokerOk<T> = { ok: true; result: T }
export type BrokerErr = { ok: false; error: string; verdict?: string; classification?: ReturnType<typeof classifyBrowserAction> }
export type BrokerResult<T> = BrokerOk<T> | BrokerErr

export type BrokerRequestRecord = {
  id: string
  at: string
  method: string
  url: string
  resourceType: string
  status: number | null
  headers: Record<string, string>
}

export type BrokerTab = {
  tabId: string
  page: PlaywrightPage
  consoleLog: BrowserConsoleEntry[]
  networkLog: BrowserNetworkEntry[]
  requests: BrokerRequestRecord[]
  downloads: BrowserDownloadRecord[]
}

export type BrokerSession = {
  sessionId: string
  owner: BrowserOwner
  kind: BrowserSessionKind
  allowLocalhost: boolean
  createdAt: string
  context: PlaywrightContext
  tabs: Map<string, BrokerTab>
  activeTabId: string | null
  citations: BrowserCitation[]
  profileId: string | null
  controlState: ControlState
  lastAction: string | null
  lastActionAt: string | null
  missionId: string | null
}

function err(error: string, extra?: Partial<BrokerErr>): BrokerErr {
  return { ok: false, error, ...extra }
}

function redactUrl(url: string): string {
  return redactSecretsFromOutput(url)
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

export class BrowserBroker {
  private browser: PlaywrightBrowser | null = null
  private browserServer: PlaywrightBrowserServer | null = null
  private ownedPid: number | null = null
  private sessions = new Map<string, BrokerSession>()
  private health: BrowserBrokerHealth = 'UNKNOWN'
  private playwrightAvailability: 'unknown' | 'available' | 'unavailable' = 'unknown'
  private startedAt: string | null = null
  private lastFailure: BrowserBrokerFailure | null = null
  private lastRecovery: { at: string; detail: string } | null = null
  private engineVersion: string | null = null
  private startLock: Promise<BrokerResult<{ pid: number | null; executable: string | null }>> | null = null
  private foundrySessionId: string | null = null
  private stoppedCleanly = false
  private lastScreenshotOk: boolean | null = null

  constructor() {
    this.probeConfiguration()
  }

  private probeConfiguration(): void {
    const executable = resolvePlaywrightChromiumExecutable()
    if (!executable || !existsSync(executable)) {
      this.playwrightAvailability = 'unavailable'
      if (!this.browser) this.health = 'MISCONFIGURED'
      return
    }
    this.playwrightAvailability = 'available'
    if (!this.browser && this.health !== 'OFFLINE' && this.health !== 'STARTING' && this.health !== 'RECOVERING') {
      this.health = 'READY'
    }
  }

  getHealth(): BrowserBrokerHealth {
    return this.health
  }

  chromiumPid(): number | null {
    if (this.ownedPid && this.pidAlive(this.ownedPid)) return this.ownedPid
    try {
      const fromServer = this.browserServer && typeof this.browserServer.process === 'function'
        ? this.browserServer.process()?.pid ?? null
        : null
      if (fromServer) return fromServer
    } catch {
      // Playwright BrowserServer.process() is best-effort.
    }
    try {
      const browserProc = this.browser && typeof (this.browser as unknown as { process?: () => { pid?: number } | null }).process === 'function'
        ? (this.browser as unknown as { process: () => { pid?: number } | null }).process()
        : null
      return browserProc?.pid ?? this.ownedPid
    } catch {
      return this.ownedPid
    }
  }

  private pidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  isRunning(): boolean {
    return this.browser != null && this.browser.isConnected()
  }

  foundryDefaultSessionId(): string | null {
    return this.foundrySessionId
  }

  getSession(sessionId: string): BrokerSession | null {
    return this.sessions.get(sessionId) ?? null
  }

  listCitations(sessionId?: string): BrowserCitation[] {
    if (sessionId) return [...(this.sessions.get(sessionId)?.citations ?? [])]
    return [...this.sessions.values()].flatMap(session => session.citations)
  }

  diagnostics(): BrowserBrokerDiagnostics {
    const sessions: BrowserSessionInfo[] = []
    let tabs = 0
    for (const session of this.sessions.values()) {
      const tabInfos = []
      for (const [tabId, tab] of session.tabs) {
        tabs += 1
        tabInfos.push({
          tabId,
          url: redactUrl(tab.page.url()),
          title: '',
          active: tabId === session.activeTabId,
        })
      }
      const active = session.activeTabId ? session.tabs.get(session.activeTabId) : null
      sessions.push({
        sessionId: session.sessionId,
        owner: session.owner,
        kind: session.kind,
        allowLocalhost: session.allowLocalhost,
        createdAt: session.createdAt,
        tabCount: session.tabs.size,
        tabs: tabInfos,
        profileId: session.profileId,
        controlState: session.controlState,
        lastAction: session.lastAction,
        lastActionAt: session.lastActionAt,
        hostname: active ? safeHostname(active.page.url()) : null,
      })
    }
    this.probeConfiguration()
    const executable = resolvePlaywrightChromiumExecutable() ?? null
    const capable = this.playwrightAvailability === 'available' && Boolean(executable)
    let chromiumState: ChromiumRuntimeState = 'UNKNOWN'
    if (this.health === 'MISCONFIGURED' || this.playwrightAvailability === 'unavailable') chromiumState = 'MISSING'
    else if (this.browser?.isConnected()) chromiumState = 'RUNNING'
    else if (this.lastFailure?.code === 'CHROMIUM_DISCONNECTED' && !this.stoppedCleanly) chromiumState = 'CRASHED'
    else if (!this.browser && capable) chromiumState = 'IDLE'
    else if (this.health === 'OFFLINE') chromiumState = 'STOPPED'
    const brokerState: BrowserBrokerHealth =
      chromiumState === 'CRASHED' ? (this.health === 'RECOVERING' ? 'RECOVERING' : 'OFFLINE')
      : this.health === 'UNKNOWN' && capable ? 'READY'
      : this.health
    return {
      brokerState,
      chromiumState,
      chromiumPid: this.chromiumPid(),
      chromiumExecutable: executable,
      engine: 'playwright-chromium',
      engineVersion: this.engineVersion,
      activeSessions: this.sessions.size,
      activeTabs: tabs,
      sessions,
      lastFailure: this.lastFailure,
      lastRecovery: this.lastRecovery,
      playwrightAvailability: this.playwrightAvailability,
      screenshotCapability: this.lastScreenshotOk === true,
      researchCapability: capable,
      startedAt: this.startedAt,
      profileStore: profileStoreDiagnostics(),
    }
  }

  statusSnapshot(): BrowserStatusSnapshot {
    const diag = this.diagnostics()
    return {
      broker_state: diag.brokerState,
      chromium_state: diag.chromiumState,
      chromium_pid: diag.chromiumPid,
      engine: 'playwright-chromium',
      engine_version: diag.engineVersion,
      executable: diag.chromiumExecutable,
      active_sessions: diag.activeSessions,
      active_tabs: diag.activeTabs,
      last_failure: diag.lastFailure,
      last_recovery: diag.lastRecovery,
      playwright_available: diag.playwrightAvailability === 'available',
      screenshot_capability: diag.screenshotCapability,
      research_capability: diag.researchCapability,
    }
  }

  async start(): Promise<BrokerResult<{ pid: number | null; executable: string | null }>> {
    if (this.browser?.isConnected()) {
      this.health = this.sessions.size ? 'READY' : 'READY'
      return { ok: true, result: { pid: this.chromiumPid(), executable: resolvePlaywrightChromiumExecutable() ?? null } }
    }
    if (this.startLock) return this.startLock
    this.startLock = this.launchChromium()
    try {
      return await this.startLock
    } finally {
      this.startLock = null
    }
  }

  private async launchChromium(): Promise<BrokerResult<{ pid: number | null; executable: string | null }>> {
    this.health = this.health === 'OFFLINE' || this.health === 'READY' ? 'RECOVERING' : 'STARTING'
    const loaded = await loadPlaywrightChromium()
    if (!loaded) {
      this.health = 'MISCONFIGURED'
      this.playwrightAvailability = 'unavailable'
      this.recordFailure('PLAYWRIGHT_NOT_INSTALLED', '@playwright/test is not resolvable.')
      return err('PLAYWRIGHT_NOT_INSTALLED: @playwright/test is not resolvable.')
    }
    const executable = loaded.executablePath
    if (!executable || !existsSync(executable)) {
      this.health = 'MISCONFIGURED'
      this.playwrightAvailability = 'unavailable'
      this.recordFailure('CHROMIUM_MISSING', 'War Room Chromium executable was not found under ms-playwright.')
      return err('CHROMIUM_MISSING: Playwright Chromium is not installed.')
    }
    try {
      const dirs = browserBrokerDataDirs()
      migrateAllLegacyProfiles()
      const crashDir = path.join(dirs.root, 'crashpad')
      mkdirSync(crashDir, { recursive: true })
      const env = chromiumChildEnv()
      const playwrightTmp = playwrightTmpDir()
      env.TMPDIR = playwrightTmp
      env.TEMP = playwrightTmp
      env.TMP = playwrightTmp
      const server = await withPlaywrightTmpDir(async () => loaded.chromium.launchServer({
        headless: true,
        executablePath: executable,
        env,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--disable-gpu',
          '--disable-crash-reporter',
          '--disable-breakpad',
          `--crash-dumps-dir=${crashDir}`,
        ],
      }))
      const browser = await loaded.chromium.connect(server.wsEndpoint())
      const pid = safeServerPid(server) ?? findOwnedChromiumPid(executable)
      this.browserServer = server
      this.browser = browser
      this.ownedPid = pid
      this.playwrightAvailability = 'available'
      this.startedAt = new Date().toISOString()
      this.health = 'READY'
      this.stoppedCleanly = false
      try {
        const version = typeof (browser as unknown as { version?: () => string }).version === 'function'
          ? (browser as unknown as { version: () => string }).version()
          : (browser as unknown as { version?: string }).version
        this.engineVersion = version ? String(version) : null
      } catch {
        this.engineVersion = null
      }
      browser.on('disconnected', () => {
        if (this.browser === browser) {
          this.stoppedCleanly = false
          this.recordFailure('CHROMIUM_DISCONNECTED', 'Owned Chromium disconnected.')
          this.browser = null
          this.browserServer = null
          this.ownedPid = null
          this.sessions.clear()
          this.foundrySessionId = null
          if (this.health !== 'OFFLINE' && this.health !== 'STARTING') this.health = 'OFFLINE'
        }
      })
      if (!browser.isConnected() || (pid != null && !this.pidAlive(pid))) {
        this.recordFailure('CHROMIUM_DISCONNECTED', 'Owned Chromium exited immediately after launch.')
        await this.stop()
        this.health = 'OFFLINE'
        return err('CHROMIUM_DISCONNECTED: Owned Chromium exited immediately after launch.')
      }
      return { ok: true, result: { pid, executable } }
    } catch (error) {
      this.health = 'MISCONFIGURED'
      this.playwrightAvailability = 'unavailable'
      const message = error instanceof Error ? error.message : String(error)
      this.recordFailure('CHROMIUM_LAUNCH_FAILED', message)
      return err(`CHROMIUM_LAUNCH_FAILED: ${message}`)
    }
  }

  async ensureStarted(): Promise<BrokerResult<{ pid: number | null }>> {
    if (this.browser?.isConnected()) return { ok: true, result: { pid: this.chromiumPid() } }
    if (this.health === 'OFFLINE' || this.lastFailure?.code === 'CHROMIUM_DISCONNECTED') {
      this.health = 'RECOVERING'
    }
    const started = await this.start()
    if (started.ok && (this.lastFailure?.code === 'CHROMIUM_DISCONNECTED' || this.lastFailure?.code === 'SCREENSHOT_DISCONNECT' || this.health === 'RECOVERING')) {
      this.lastRecovery = { at: new Date().toISOString(), detail: 'Owned Chromium relaunched after disconnect.' }
      this.health = this.lastScreenshotOk === false ? 'DEGRADED' : 'READY'
    }
    return started.ok ? { ok: true, result: { pid: started.result.pid } } : started
  }

  async stop(): Promise<BrokerResult<{ stopped: boolean }>> {
    for (const session of [...this.sessions.values()]) {
      await this.persistTrustedSession(session).catch(() => undefined)
      await session.context.close().catch(() => undefined)
    }
    this.sessions.clear()
    this.foundrySessionId = null
    const pidToKill = this.ownedPid
    const closeBrowser = this.browser?.close().catch(() => undefined)
    const closeServer = this.browserServer?.close().catch(() => undefined)
    await Promise.race([
      Promise.all([closeBrowser, closeServer]),
      new Promise(resolve => setTimeout(resolve, 2_000)),
    ])
    this.browser = null
    this.browserServer = null
    if (pidToKill && this.pidAlive(pidToKill)) {
      try { process.kill(pidToKill, 'SIGTERM') } catch { /* already gone */ }
      await new Promise(resolve => setTimeout(resolve, 300))
      if (this.pidAlive(pidToKill)) {
        try { process.kill(pidToKill, 'SIGKILL') } catch { /* already gone */ }
      }
    }
    this.ownedPid = null
    this.stoppedCleanly = true
    this.startedAt = null
    this.health = this.playwrightAvailability === 'available' ? 'READY' : 'OFFLINE'
    return { ok: true, result: { stopped: true } }
  }

  async restart(): Promise<BrokerResult<{ pid: number | null }>> {
    await this.stop()
    this.health = 'RECOVERING'
    const started = await this.start()
    if (started.ok) {
      this.lastRecovery = { at: new Date().toISOString(), detail: 'Broker restart completed.' }
      this.health = 'READY'
    }
    return started.ok ? { ok: true, result: { pid: started.result.pid } } : started
  }

  async createSession(input: {
    owner: BrowserOwner
    allowLocalhost?: boolean
    reuseFoundryDefault?: boolean
    sessionMode?: 'EPHEMERAL' | 'TRUSTED_PROFILE'
    profileId?: string
    missionId?: string
  }): Promise<BrokerResult<{ sessionId: string; tabId: string; profileId: string | null; controlState: ControlState }>> {
    const started = await this.ensureStarted()
    if (!started.ok) return started
    if (!this.browser) return err('BROWSER_OFFLINE')
    const mode = input.sessionMode === 'TRUSTED_PROFILE' ? 'TRUSTED_PROFILE' : 'EPHEMERAL'
    if (mode === 'TRUSTED_PROFILE') {
      const profileGate = this.assertTrustedProfileAccess(input.owner, input.profileId)
      if (!profileGate.ok) return profileGate
    } else if (input.profileId) {
      return err('PROFILE_ACCESS_DENIED')
    }
    if (input.reuseFoundryDefault && input.owner === 'foundry' && this.foundrySessionId && mode === 'EPHEMERAL') {
      const existing = this.sessions.get(this.foundrySessionId)
      if (existing) {
        const tabId = existing.activeTabId ?? [...existing.tabs.keys()][0]
        if (tabId) return { ok: true, result: { sessionId: existing.sessionId, tabId, profileId: existing.profileId, controlState: existing.controlState } }
      }
    }
    if (mode === 'TRUSTED_PROFILE' && input.profileId) {
      for (const open of this.sessions.values()) {
        if (open.profileId === input.profileId && (open.controlState === 'COMMANDER_CONTROL' || open.controlState === 'AGENT_CONTROL')) {
          return err('PROFILE_UNAVAILABLE')
        }
      }
    }
    const contextOptions: {
      acceptDownloads: boolean
      javaScriptEnabled: boolean
      storageState?: Awaited<ReturnType<PlaywrightContext['storageState']>>
    } = {
      acceptDownloads: true,
      javaScriptEnabled: true,
    }
    if (mode === 'TRUSTED_PROFILE' && input.profileId) {
      const stored = readStorageStateForReuse(input.profileId)
      if (!stored.ok) return err(stored.error)
      if (stored.state) {
        contextOptions.storageState = stored.state as Awaited<ReturnType<PlaywrightContext['storageState']>>
      }
    }
    const context = await this.browser.newContext(contextOptions)
    const sessionId = `sess-${randomUUID()}`
    const session: BrokerSession = {
      sessionId,
      owner: input.owner,
      kind: mode === 'TRUSTED_PROFILE' ? 'persistent_authorized' : 'ephemeral',
      allowLocalhost: input.allowLocalhost === true || input.owner === 'foundry' || input.owner === 'commander',
      createdAt: new Date().toISOString(),
      context,
      tabs: new Map(),
      activeTabId: null,
      citations: [],
      profileId: mode === 'TRUSTED_PROFILE' ? input.profileId ?? null : null,
      controlState: 'AGENT_CONTROL',
      lastAction: 'session.create',
      lastActionAt: new Date().toISOString(),
      missionId: input.missionId ?? null,
    }
    const tab = await this.openTabOn(session)
    this.sessions.set(sessionId, session)
    if (input.owner === 'foundry' && mode === 'EPHEMERAL' && (input.reuseFoundryDefault || !this.foundrySessionId)) {
      this.foundrySessionId = sessionId
    }
    if (session.profileId) markProfileUsed(session.profileId)
    void recordBrowserAudit({
      owner: input.owner,
      action_type: 'session.create',
      result: 'ok',
      session_id: sessionId,
      profile_id: session.profileId,
      mission_id: session.missionId,
    })
    return { ok: true, result: { sessionId, tabId: tab.tabId, profileId: session.profileId, controlState: session.controlState } }
  }

  async closeSession(sessionId: string): Promise<BrokerResult<{ closed: boolean }>> {
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: true, result: { closed: false } }
    await this.persistTrustedSession(session).catch(() => undefined)
    session.controlState = 'CLOSED'
    await Promise.race([
      session.context.close().catch(() => undefined),
      new Promise(resolve => setTimeout(resolve, 1_500)),
    ])
    this.sessions.delete(sessionId)
    if (this.foundrySessionId === sessionId) this.foundrySessionId = null
    return { ok: true, result: { closed: true } }
  }

  async openTab(sessionId: string, owner: BrowserOwner = 'broker'): Promise<BrokerResult<{ tabId: string }>> {
    const session = this.requireSession(sessionId)
    if (!session.ok) return session
    const control = this.assertControl(session.result, owner, true)
    if (!control.ok) return control
    const tab = await this.openTabOn(session.result)
    this.touchSession(session.result, 'tab.open')
    return { ok: true, result: { tabId: tab.tabId } }
  }

  async closeTab(sessionId: string, tabId?: string): Promise<BrokerResult<{ closed: boolean }>> {
    const session = this.requireSession(sessionId)
    if (!session.ok) return session
    const id = tabId || session.result.activeTabId
    if (!id) return { ok: true, result: { closed: false } }
    const tab = session.result.tabs.get(id)
    if (!tab) return { ok: true, result: { closed: false } }
    await tab.page.close().catch(() => undefined)
    session.result.tabs.delete(id)
    if (session.result.activeTabId === id) {
      session.result.activeTabId = [...session.result.tabs.keys()][0] ?? null
    }
    return { ok: true, result: { closed: true } }
  }

  async switchTab(sessionId: string, tabId: string): Promise<BrokerResult<{ activeTabId: string }>> {
    const session = this.requireSession(sessionId)
    if (!session.ok) return session
    if (!session.result.tabs.has(tabId)) return err(`Unknown tabId: ${tabId}`)
    session.result.activeTabId = tabId
    await session.result.tabs.get(tabId)!.page.bringToFront().catch(() => undefined)
    return { ok: true, result: { activeTabId: tabId } }
  }

  async classifyAndGate(request: BrowserActionRequest): Promise<BrokerResult<{ allowed: true }>> {
    const classification = classifyBrowserAction(request)
    if (classification.verdict === 'ACTION_REQUIRES_APPROVAL') {
      return err('ACTION_REQUIRES_APPROVAL', { verdict: 'ACTION_REQUIRES_APPROVAL', classification })
    }
    if (classification.verdict === 'DENIED') {
      return err(classification.reason, { verdict: 'DENIED', classification })
    }
    return { ok: true, result: { allowed: true } }
  }

  async navigate(input: {
    owner: BrowserOwner
    sessionId: string
    tabId?: string
    url: string
    waitForSelector?: string
    commanderApproved?: boolean
  }): Promise<BrokerResult<{ title: string; status: number | null; url: string; finalUrl: string; tabId: string }>> {
    const gated = await this.classifyAndGate({
      kind: 'navigate',
      owner: input.owner,
      sessionId: input.sessionId,
      tabId: input.tabId,
      url: input.url,
      commanderApproved: input.commanderApproved,
    })
    if (!gated.ok) return gated
    const tab = this.requireTab(input.sessionId, input.tabId)
    if (!tab.ok) return tab
    const session = this.sessions.get(input.sessionId)
    if (!session) return err('Unknown browser session.')
    const allowed = this.assertNavigationTarget(input.url, session, input.owner, input.commanderApproved === true)
    if (!allowed.ok) return allowed
    const control = this.assertControl(session, input.owner, true)
    if (!control.ok) return control
    const response = await tab.result.page.goto(input.url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' }).catch((error: unknown) => {
      throw error
    })
    if (input.waitForSelector) {
      await tab.result.page.waitForSelector(input.waitForSelector, { timeout: WAIT_TIMEOUT_MS }).catch(() => undefined)
    }
    const finalUrl = tab.result.page.url()
    return {
      ok: true,
      result: {
        title: await tab.result.page.title().catch(() => ''),
        status: response?.status() ?? null,
        url: redactUrl(finalUrl),
        finalUrl: redactUrl(finalUrl),
        tabId: tab.result.tabId,
      },
    }
  }

  async search(input: {
    owner: BrowserOwner
    sessionId: string
    query: string
  }): Promise<BrokerResult<{ query: string; results: { title: string; url: string; snippet: string }[]; tabId: string }>> {
    const gated = await this.classifyAndGate({ kind: 'search', owner: input.owner, sessionId: input.sessionId, query: input.query })
    if (!gated.ok) return gated
    const encoded = encodeURIComponent(input.query.slice(0, 240))
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encoded}`
    const nav = await this.navigate({ owner: input.owner, sessionId: input.sessionId, url: searchUrl })
    if (!nav.ok) return nav
    const tab = this.requireTab(input.sessionId, nav.result.tabId)
    if (!tab.ok) return tab
    const raw = await tab.result.page.evaluate(() => {
      const out: { title: string; url: string; snippet: string }[] = []
      const anchors = Array.from(document.querySelectorAll('a.result__a, .result__title a, .result a[href]'))
      for (const node of anchors) {
        const anchor = node as HTMLAnchorElement
        if (!anchor?.href || anchor.href.startsWith('javascript:')) continue
        const title = (anchor.textContent || '').trim()
        if (!title) continue
        const parent = anchor.closest('.result, .web-result, article, li, tr')
        const snippetNode = parent?.querySelector('.result__snippet, .result__body, .snippet')
        const snippet = ((snippetNode?.textContent || parent?.textContent || title).trim()).slice(0, 280)
        out.push({ title, url: anchor.href, snippet })
        if (out.length >= 12) break
      }
      return out
    }).catch(() => [] as { title: string; url: string; snippet: string }[])
    const { unwrapSearchResultUrl } = await import('./researchDiscovery')
    const seen = new Set<string>()
    const results: { title: string; url: string; snippet: string }[] = []
    for (const row of raw) {
      const url = unwrapSearchResultUrl(row.url)
      if (!url || seen.has(url)) continue
      seen.add(url)
      results.push({ title: row.title, url, snippet: row.snippet })
      if (results.length >= 8) break
    }
    return { ok: true, result: { query: input.query, results, tabId: nav.result.tabId } }
  }

  async follow(input: {
    owner: BrowserOwner
    sessionId: string
    tabId?: string
    href?: string
    text?: string
  }): Promise<BrokerResult<{ url: string; title: string; tabId: string }>> {
    const gated = await this.classifyAndGate({
      kind: 'follow',
      owner: input.owner,
      sessionId: input.sessionId,
      url: input.href,
      text: input.text,
    })
    if (!gated.ok) return gated
    if (input.href) {
      const nav = await this.navigate({ owner: input.owner, sessionId: input.sessionId, tabId: input.tabId, url: input.href })
      if (!nav.ok) return nav
      return { ok: true, result: { url: nav.result.finalUrl, title: nav.result.title, tabId: nav.result.tabId } }
    }
    const tab = this.requireTab(input.sessionId, input.tabId)
    if (!tab.ok) return tab
    const locator = tab.result.page.getByRole('link', { name: input.text ?? '', exact: false }).first()
    await locator.click({ timeout: WAIT_TIMEOUT_MS })
    await tab.result.page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT_MS }).catch(() => undefined)
    return {
      ok: true,
      result: {
        url: redactUrl(tab.result.page.url()),
        title: await tab.result.page.title().catch(() => ''),
        tabId: tab.result.tabId,
      },
    }
  }

  async history(kind: 'back' | 'forward' | 'reload', sessionId: string, tabId?: string, owner: BrowserOwner = 'broker'): Promise<BrokerResult<{ url: string }>> {
    const session = this.sessions.get(sessionId)
    if (!session) return err('SESSION_NOT_FOUND')
    const control = this.assertControl(session, owner, true)
    if (!control.ok) return control
    const tab = this.requireTab(sessionId, tabId)
    if (!tab.ok) return tab
    if (kind === 'back') await tab.result.page.goBack({ timeout: NAV_TIMEOUT_MS }).catch(() => undefined)
    else if (kind === 'forward') await tab.result.page.goForward({ timeout: NAV_TIMEOUT_MS }).catch(() => undefined)
    else await tab.result.page.reload({ timeout: NAV_TIMEOUT_MS })
    this.touchSession(session, kind)
    return { ok: true, result: { url: redactUrl(tab.result.page.url()) } }
  }

  async scroll(sessionId: string, tabId?: string, dy = 400, owner: BrowserOwner = 'broker'): Promise<BrokerResult<{ scrolled: boolean }>> {
    const session = this.sessions.get(sessionId)
    if (!session) return err('SESSION_NOT_FOUND')
    const control = this.assertControl(session, owner, true)
    if (!control.ok) return control
    const tab = this.requireTab(sessionId, tabId)
    if (!tab.ok) return tab
    await tab.result.page.mouse.wheel(0, dy)
    this.touchSession(session, 'scroll')
    return { ok: true, result: { scrolled: true } }
  }

  async extract(sessionId: string, tabId?: string): Promise<BrokerResult<BrowserExtractedPage>> {
    const tab = this.requireTab(sessionId, tabId)
    if (!tab.ok) return tab
    const requestedUrl = tab.result.page.url()
    await tab.result.page.waitForLoadState('domcontentloaded').catch(() => undefined)
    await tab.result.page.waitForFunction(
      () => Boolean(document.body && ((document.body.innerText || '').trim().length > 0 || document.title)),
      { timeout: 8_000 },
    ).catch(() => undefined)
    const extracted = await tab.result.page.evaluate((limits: { maxText: number; maxLinks: number; maxHeadings: number }) => {
      const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
        .map(node => (node.textContent || '').trim())
        .filter(Boolean)
        .slice(0, limits.maxHeadings)
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map(anchor => ({
          text: ((anchor as HTMLAnchorElement).textContent || '').trim().slice(0, 120),
          href: (anchor as HTMLAnchorElement).href,
        }))
        .filter(item => item.href && !item.href.startsWith('javascript:'))
        .slice(0, limits.maxLinks)
      const readable = (document.body?.innerText || '').replace(/\s+\n/g, '\n').trim()
      const metaContent = (selector: string) => document.querySelector(selector)?.getAttribute('content') ?? null
      let publishedTime = metaContent('meta[property="article:published_time"]')
        || metaContent('meta[name="article:published_time"]')
        || metaContent('meta[name="pubdate"]')
        || metaContent('meta[name="date"]')
        || metaContent('meta[itemprop="datePublished"]')
        || metaContent('meta[name="dc.date"]')
      let updatedTime = metaContent('meta[property="article:modified_time"]')
        || metaContent('meta[property="og:updated_time"]')
        || metaContent('meta[itemprop="dateModified"]')
      const timeValue = document.querySelector('time[datetime]')?.getAttribute('datetime') ?? null
      if (!publishedTime && timeValue) publishedTime = timeValue
      for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 4)) {
        const raw = script.textContent || ''
        if (!publishedTime) {
          const published = raw.match(/"datePublished"\s*:\s*"([^"]+)"/)
          if (published) publishedTime = published[1]
        }
        if (!updatedTime) {
          const modified = raw.match(/"dateModified"\s*:\s*"([^"]+)"/)
          if (modified) updatedTime = modified[1]
        }
      }
      return {
        title: document.title || '',
        url: location.href,
        readableText: readable.slice(0, limits.maxText),
        headings,
        links,
        description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
        ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? null,
        publishedTime,
        updatedTime,
      }
    }, { maxText: MAX_TEXT, maxLinks: MAX_LINKS, maxHeadings: MAX_HEADINGS }).catch(() => ({
      title: '',
      url: requestedUrl,
      readableText: '',
      headings: [] as string[],
      links: [] as { text: string; href: string }[],
      description: null as string | null,
      ogTitle: null as string | null,
      publishedTime: null as string | null,
      updatedTime: null as string | null,
    }))
    const releaseBlob = await tab.result.page.evaluate(() => {
      const chunks: string[] = []
      const needles = ['publishedOn', '\\"publishedOn\\"', '"date":"20', '\\"date\\":\\"20']
      for (const script of Array.from(document.scripts)) {
        const text = script.textContent || ''
        if (!text) continue
        for (const needle of needles) {
          let from = 0
          for (let hit = 0; hit < 8; hit += 1) {
            const at = text.indexOf(needle, from)
            if (at < 0) break
            chunks.push(text.slice(Math.max(0, at - 160), at + 720))
            from = at + needle.length
            if (chunks.join('\n').length > 80_000) return chunks.join('\n').slice(0, 80_000)
          }
        }
      }
      return chunks.join('\n').slice(0, 80_000)
    }).catch(() => '')
    const releases = parseStructuredReleases(releaseBlob).map(release => ({
      title: redactSecretsFromOutput(release.title),
      date: release.date,
      url: release.url ? redactUrl(release.url) : null,
      summary: release.summary ? redactSecretsFromOutput(release.summary) : null,
    }))
    const domText = redactSecretsFromOutput(extracted.readableText)
    return {
      ok: true,
      result: {
        requestedUrl: redactUrl(requestedUrl),
        url: redactUrl(extracted.url),
        finalUrl: redactUrl(tab.result.page.url()),
        title: extracted.title,
        readableText: domText,
        domText,
        headings: extracted.headings,
        links: extracted.links.map(link => ({ ...link, href: redactUrl(link.href) })),
        metadata: {
          description: extracted.description ? redactSecretsFromOutput(extracted.description) : null,
          ogTitle: extracted.ogTitle ? redactSecretsFromOutput(extracted.ogTitle) : null,
          contentType: null,
          publishedTime: extracted.publishedTime ? redactSecretsFromOutput(extracted.publishedTime) : null,
          updatedTime: extracted.updatedTime ? redactSecretsFromOutput(extracted.updatedTime) : null,
        },
        releases,
      },
    }
  }

  async cite(sessionId: string, tabId?: string, evidence?: string, sourceType?: BrowserSourceType): Promise<BrokerResult<BrowserCitation>> {
    const extracted = await this.extract(sessionId, tabId)
    if (!extracted.ok) return extracted
    const session = this.requireSession(sessionId)
    if (!session.ok) return session
    const tab = this.requireTab(sessionId, tabId)
    if (!tab.ok) return tab
    const citation: BrowserCitation = {
      citationId: `cite-${randomUUID()}`,
      url: extracted.result.requestedUrl,
      finalUrl: extracted.result.finalUrl,
      pageTitle: extracted.result.title,
      timestamp: new Date().toISOString(),
      sessionId,
      tabId: tab.result.tabId,
      evidence: redactSecretsFromOutput((evidence || extracted.result.readableText).slice(0, 1800)),
      sourceType: sourceType ?? (isLoopbackHost(safeHostname(extracted.result.finalUrl)) ? 'localhost' : extracted.result.finalUrl.toLowerCase().includes('.pdf') ? 'pdf' : 'web_page'),
      browser_session_type: session.result.kind === 'persistent_authorized' ? 'TRUSTED_PROFILE' : 'EPHEMERAL',
      profile_id_hash: session.result.profileId ? hashProfileId(session.result.profileId) : null,
      origin: safeHostname(extracted.result.finalUrl) || null,
      retrieved_at: new Date().toISOString(),
    }
    session.result.citations.push(citation)
    return { ok: true, result: citation }
  }

  async screenshot(sessionId: string, tabId?: string, opts?: { fullPage?: boolean; repairId?: string }): Promise<BrokerResult<{
    path: string
    strategy: ScreenshotPlan['strategy']
    metrics: ScreenshotPlan['metrics']
    segments?: string[]
    recovered?: boolean
  }>> {
    const tab = this.requireTab(sessionId, tabId)
    if (!tab.ok) return tab
    const page = tab.result.page
    const dirs = browserBrokerDataDirs()
    const destDir = opts?.repairId ? path.join(dirs.foundryScreenshots, opts.repairId) : dirs.screenshots
    await mkdir(destDir, { recursive: true })
    const stamp = `${Date.now()}-${tab.result.tabId}`
    const filePath = path.join(destDir, `${stamp}.png`)

    const metricsRaw = await page.evaluate(() => {
      const body = document.documentElement || document.body
      const viewport = {
        width: window.innerWidth || 1280,
        height: window.innerHeight || 720,
      }
      return {
        pageWidth: Math.max(body?.scrollWidth || 0, body?.clientWidth || 0, viewport.width),
        pageHeight: Math.max(body?.scrollHeight || 0, body?.clientHeight || 0, viewport.height),
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        deviceScaleFactor: window.devicePixelRatio || 1,
      }
    }).catch(() => ({
      pageWidth: 1280,
      pageHeight: 720,
      viewportWidth: 1280,
      viewportHeight: 720,
      deviceScaleFactor: 1,
    }))
    const plan = planScreenshot({ ...metricsRaw, wantFullPage: opts?.fullPage === true })
    if (plan.strategy === 'UNSAFE_REJECT') {
      return err(`SCREENSHOT_UNSAFE: ${plan.reason}`)
    }

    const capture = async (strategy = plan.strategy): Promise<Buffer> => {
      const timeout = SCREENSHOT_LIMITS.timeoutMs
      if (strategy === 'DIRECT_FULL_PAGE') return page.screenshot({ fullPage: true, type: 'png', timeout })
      if (strategy === 'BOUNDED_FULL_PAGE' && plan.clip) return page.screenshot({ clip: plan.clip, type: 'png', timeout })
      if (strategy === 'TILED_CAPTURE' && plan.tiles.length) {
        const first = plan.tiles[0]
        return page.screenshot({ clip: first, type: 'png', timeout })
      }
      return page.screenshot({ fullPage: false, type: 'png', timeout })
    }

    try {
      let buffer: Buffer
      try {
        buffer = await withPlaywrightTmpDir(() => capture())
      } catch (first) {
        const firstMessage = first instanceof Error ? first.message : String(first)
        if (!/Protocol error|Unable to capture screenshot|captureScreenshot/i.test(firstMessage)) throw first
        buffer = await withPlaywrightTmpDir(() => page.screenshot({
          fullPage: false,
          type: 'png',
          timeout: SCREENSHOT_LIMITS.timeoutMs,
        }))
      }
      await writeFile(filePath, buffer)
      const segments: string[] = [filePath]
      if (plan.strategy === 'TILED_CAPTURE') {
        for (let i = 1; i < plan.tiles.length; i += 1) {
          const tilePath = path.join(destDir, `${stamp}-tile-${i}.png`)
          const tile = await withPlaywrightTmpDir(() => page.screenshot({ clip: plan.tiles[i], type: 'png', timeout: SCREENSHOT_LIMITS.timeoutMs }))
          await writeFile(tilePath, tile)
          segments.push(tilePath)
        }
      }
      this.lastScreenshotOk = true
      this.health = this.browser?.isConnected() ? 'READY' : this.health
      return {
        ok: true,
        result: {
          path: filePath,
          strategy: plan.strategy,
          metrics: plan.metrics,
          segments: segments.length > 1 ? segments : undefined,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const disconnected = /target closed|browser has been closed|disconnected|crashed|Unable to capture screenshot/i.test(message) && !this.browser?.isConnected()
      const captureFailed = /Unable to capture screenshot/i.test(message)
      this.lastScreenshotOk = false
      this.recordFailure(disconnected ? 'SCREENSHOT_DISCONNECT' : 'SCREENSHOT_FAILED', message)
      if (disconnected || !this.browser?.isConnected()) {
        this.health = 'DEGRADED'
        await this.ensureStarted().catch(() => undefined)
        this.health = this.browser?.isConnected() ? 'DEGRADED' : 'OFFLINE'
        return err(`SCREENSHOT_DISCONNECT: ${message.slice(0, 400)}`)
      }
      if (plan.strategy !== 'VIEWPORT_FALLBACK' && !captureFailed) {
        try {
          const fallback = await withPlaywrightTmpDir(() => page.screenshot({ fullPage: false, type: 'png', timeout: SCREENSHOT_LIMITS.timeoutMs }))
          const fallbackPath = path.join(destDir, `${stamp}-viewport-fallback.png`)
          await writeFile(fallbackPath, fallback)
          this.lastScreenshotOk = true
          this.health = 'READY'
          return {
            ok: true,
            result: {
              path: fallbackPath,
              strategy: 'VIEWPORT_FALLBACK',
              metrics: plan.metrics,
              recovered: false,
            },
          }
        } catch {
          /* continue to fail */
        }
      }
      this.health = this.browser?.isConnected() ? 'DEGRADED' : 'OFFLINE'
      return err(`SCREENSHOT_FAILED: ${message.slice(0, 400)}`)
    }
  }

  async savePdf(sessionId: string, tabId?: string): Promise<BrokerResult<{ path: string }>> {
    const tab = this.requireTab(sessionId, tabId)
    if (!tab.ok) return tab
    const dirs = browserBrokerDataDirs()
    const filePath = path.join(dirs.pdfs, `${Date.now()}-${tab.result.tabId}.pdf`)
    await tab.result.page.pdf({ path: filePath })
    return { ok: true, result: { path: filePath } }
  }

  async setStorageMarker(sessionId: string, tabId: string | undefined, key: string, value: string): Promise<BrokerResult<{ key: string }>> {
    const gated = await this.classifyAndGate({ kind: 'storage.set', owner: 'broker', sessionId, tabId })
    if (!gated.ok) return gated
    const tab = this.requireTab(sessionId, tabId)
    if (!tab.ok) return tab
    const safeKey = key.replace(/[^\w.-]/g, '').slice(0, 48) || 'wr-iso'
    const safeValue = value.slice(0, 120)
    await tab.result.page.evaluate(({ markerKey, markerValue }) => {
      document.cookie = `${markerKey}=${markerValue}; path=/`
      window.localStorage.setItem(markerKey, markerValue)
      window.sessionStorage.setItem(markerKey, markerValue)
    }, { markerKey: safeKey, markerValue: safeValue })
    const session = this.sessions.get(sessionId)
    if (session) await this.persistTrustedSession(session).catch(() => undefined)
    return { ok: true, result: { key: safeKey } }
  }

  async peekStorageMarker(sessionId: string, tabId: string | undefined, key: string): Promise<BrokerResult<{ cookie: string; localStorage: string; sessionStorage: string }>> {
    const gated = await this.classifyAndGate({ kind: 'storage.peek', owner: 'broker', sessionId, tabId })
    if (!gated.ok) return gated
    const tab = this.requireTab(sessionId, tabId)
    if (!tab.ok) return tab
    const safeKey = key.replace(/[^\w.-]/g, '').slice(0, 48) || 'wr-iso'
    const seen = await tab.result.page.evaluate((markerKey) => {
      const cookie = document.cookie || ''
      return {
        cookie,
        localStorage: window.localStorage.getItem(markerKey) || '',
        sessionStorage: window.sessionStorage.getItem(markerKey) || '',
      }
    }, safeKey)
    return { ok: true, result: seen }
  }

  async download(input: {
    owner: BrowserOwner
    sessionId: string
    tabId?: string
    url?: string
    commanderApproved?: boolean
  }): Promise<BrokerResult<BrowserDownloadRecord | { downloads: BrowserDownloadRecord[] }>> {
    const gated = await this.classifyAndGate({
      kind: 'download',
      owner: input.owner,
      sessionId: input.sessionId,
      url: input.url,
      commanderApproved: input.commanderApproved,
    })
    if (!gated.ok) return gated
    const tab = this.requireTab(input.sessionId, input.tabId)
    if (!tab.ok) return tab
    if (!input.url) return { ok: true, result: { downloads: tab.result.downloads } }
    const session = this.sessions.get(input.sessionId)
    if (!session) return err('Unknown browser session.')
    const allowed = this.assertNavigationTarget(input.url, session)
    if (!allowed.ok) return allowed
    const dirs = browserBrokerDataDirs()
    const destDir = input.owner === 'foundry' ? dirs.foundryDownloads : dirs.downloads
    const [download] = await Promise.all([
      tab.result.page.waitForEvent('download', { timeout: WAIT_TIMEOUT_MS }),
      tab.result.page.goto(input.url, { timeout: NAV_TIMEOUT_MS }).catch(() => undefined),
    ])
    const dest = path.join(destDir, `${Date.now()}-${download.suggestedFilename()}`)
    await download.saveAs(dest)
    const record: BrowserDownloadRecord = {
      downloadId: `dl-${randomUUID()}`,
      suggestedFilename: download.suggestedFilename(),
      savedAs: dest,
      url: redactUrl(download.url()),
      executed: false,
      at: new Date().toISOString(),
    }
    tab.result.downloads.push(record)
    return { ok: true, result: record }
  }

  async consoleLog(sessionId: string, tabId?: string): Promise<BrokerResult<{ entries: BrowserConsoleEntry[] }>> {
    const tab = this.requireTab(sessionId, tabId)
    if (!tab.ok) return tab
    return { ok: true, result: { entries: tab.result.consoleLog } }
  }

  async networkLog(sessionId: string, tabId?: string): Promise<BrokerResult<{ entries: BrowserNetworkEntry[] }>> {
    const tab = this.requireTab(sessionId, tabId)
    if (!tab.ok) return tab
    return { ok: true, result: { entries: tab.result.networkLog } }
  }

  async click(input: {
    owner: BrowserOwner
    sessionId: string
    tabId?: string
    selector?: string
    testId?: string
    text?: string
    commanderApproved?: boolean
  }): Promise<BrokerResult<{ clicked: boolean }>> {
    const gated = await this.classifyAndGate({
      kind: 'click',
      owner: input.owner,
      sessionId: input.sessionId,
      selector: input.selector,
      text: input.text,
      commanderApproved: input.commanderApproved,
    })
    if (!gated.ok) return gated
    const session = this.sessions.get(input.sessionId)
    if (!session) return err('SESSION_NOT_FOUND')
    const control = this.assertControl(session, input.owner, true)
    if (!control.ok) return control
    const tab = this.requireTab(input.sessionId, input.tabId)
    if (!tab.ok) return tab
    const locator = input.selector
      ? tab.result.page.locator(input.selector)
      : input.testId
        ? tab.result.page.getByTestId(input.testId)
        : input.text
          ? tab.result.page.getByText(input.text, { exact: false })
          : null
    if (!locator) return err('click requires selector, testId, or text.')
    await locator.first().click({ timeout: WAIT_TIMEOUT_MS })
    this.touchSession(session, 'click')
    return { ok: true, result: { clicked: true } }
  }

  async type(input: {
    owner: BrowserOwner
    sessionId: string
    tabId?: string
    selector: string
    text: string
    commanderApproved?: boolean
  }): Promise<BrokerResult<{ typed: boolean }>> {
    const gated = await this.classifyAndGate({
      kind: 'type',
      owner: input.owner,
      sessionId: input.sessionId,
      selector: input.selector,
      text: input.text,
      commanderApproved: input.commanderApproved,
    })
    if (!gated.ok) return gated
    const session = this.sessions.get(input.sessionId)
    if (!session) return err('SESSION_NOT_FOUND')
    const control = this.assertControl(session, input.owner, true)
    if (!control.ok) return control
    const tab = this.requireTab(input.sessionId, input.tabId)
    if (!tab.ok) return tab
    await tab.result.page.locator(input.selector).first().fill(input.text, { timeout: WAIT_TIMEOUT_MS })
    this.touchSession(session, 'type')
    void recordBrowserAudit({
      owner: input.owner,
      action_type: 'type',
      result: 'ok',
      session_id: input.sessionId,
      profile_id: session.profileId,
    })
    return { ok: true, result: { typed: true } }
  }

  async submit(input: {
    owner: BrowserOwner
    sessionId: string
    tabId?: string
    selector?: string
    commanderApproved?: boolean
  }): Promise<BrokerResult<{ submitted: boolean }>> {
    const gated = await this.classifyAndGate({
      kind: 'submit',
      owner: input.owner,
      sessionId: input.sessionId,
      selector: input.selector,
      commanderApproved: input.commanderApproved,
    })
    if (!gated.ok) return gated
    const session = this.sessions.get(input.sessionId)
    if (!session) return err('SESSION_NOT_FOUND')
    const control = this.assertControl(session, input.owner, true)
    if (!control.ok) return control
    const tab = this.requireTab(input.sessionId, input.tabId)
    if (!tab.ok) return tab
    await tab.result.page.locator(input.selector || 'form').first().evaluate((form: HTMLFormElement) => form.requestSubmit())
    this.touchSession(session, 'submit')
    return { ok: true, result: { submitted: true } }
  }

  async wait(ms: number): Promise<BrokerResult<{ waitedMs: number }>> {
    const bounded = Math.min(Math.max(Number(ms) || 0, 0), 15_000)
    await new Promise(resolve => setTimeout(resolve, bounded))
    return { ok: true, result: { waitedMs: bounded } }
  }

  async executeAction(request: BrowserActionRequest & Record<string, unknown>): Promise<BrokerResult<unknown>> {
    const kind = request.kind
    switch (kind) {
      case 'status':
        return { ok: true, result: this.statusSnapshot() }
      case 'start':
        return this.start()
      case 'stop':
        return this.stop()
      case 'restart':
        return this.restart()
      case 'session.create':
        return this.createSession({
          owner: request.owner,
          allowLocalhost: request.allowLocalhost,
          sessionMode: request.sessionMode,
          profileId: request.profileId,
          missionId: request.missionId,
        })
      case 'session.close':
        return this.closeSession(String(request.sessionId ?? ''))
      case 'session.status':
        return this.sessionStatus(String(request.sessionId ?? ''))
      case 'tab.list':
        return this.tabList(String(request.sessionId ?? ''))
      case 'profile.list':
        return this.listTrustedProfiles(request.owner)
      case 'profile.create':
        return this.createProfile(request)
      case 'profile.lock':
        return this.changeProfileState(request.owner, String(request.profileId ?? ''), 'LOCKED')
      case 'profile.unlock':
        return this.changeProfileState(request.owner, String(request.profileId ?? ''), 'ACTIVE')
      case 'profile.disable':
        return this.changeProfileState(request.owner, String(request.profileId ?? ''), 'DISABLED')
      case 'profile.delete':
        return this.deleteProfile(request.owner, String(request.profileId ?? ''))
      case 'profile.status':
        return this.profileStatus(String(request.profileId ?? ''))
      case 'secureStorage.rotate': {
        const gated = await this.classifyAndGate(request)
        if (!gated.ok) return gated
        return this.rotateSecureStorage(request.owner)
      }
      case 'control.takeover':
        return this.startTakeover(request.owner, String(request.sessionId ?? ''))
      case 'control.return':
        return this.returnControl(request.owner, String(request.sessionId ?? ''))
      case 'preview':
        return this.previewTab(String(request.sessionId ?? ''), request.tabId)
      case 'press':
        return this.press({
          owner: request.owner,
          sessionId: String(request.sessionId ?? ''),
          tabId: request.tabId,
          text: String(request.text ?? 'Enter'),
        })
      case 'tab.open':
        return this.openTab(String(request.sessionId ?? ''), request.owner)
      case 'tab.close':
        return this.closeTab(String(request.sessionId ?? ''), request.tabId)
      case 'tab.switch':
        return this.switchTab(String(request.sessionId ?? ''), String(request.tabId ?? ''))
      case 'navigate':
        return this.navigate({
          owner: request.owner,
          sessionId: String(request.sessionId ?? ''),
          tabId: request.tabId,
          url: String(request.url ?? ''),
          commanderApproved: request.commanderApproved,
        })
      case 'search':
        return this.search({ owner: request.owner, sessionId: String(request.sessionId ?? ''), query: String(request.query ?? '') })
      case 'follow':
        return this.follow({
          owner: request.owner,
          sessionId: String(request.sessionId ?? ''),
          tabId: request.tabId,
          href: request.url,
          text: request.text,
        })
      case 'back':
      case 'forward':
      case 'reload':
        return this.history(kind, String(request.sessionId ?? ''), request.tabId, request.owner)
      case 'scroll':
        return this.scroll(String(request.sessionId ?? ''), request.tabId, 400, request.owner)
      case 'read':
      case 'extract':
        return this.extract(String(request.sessionId ?? ''), request.tabId)
      case 'screenshot':
        return this.screenshot(String(request.sessionId ?? ''), request.tabId, { fullPage: request.fullPage === true })
      case 'pdf':
        return this.savePdf(String(request.sessionId ?? ''), request.tabId)
      case 'download':
        return this.download({
          owner: request.owner,
          sessionId: String(request.sessionId ?? ''),
          tabId: request.tabId,
          url: request.url,
          commanderApproved: request.commanderApproved,
        })
      case 'console':
        return this.consoleLog(String(request.sessionId ?? ''), request.tabId)
      case 'network':
        return this.networkLog(String(request.sessionId ?? ''), request.tabId)
      case 'cite':
        return this.cite(String(request.sessionId ?? ''), request.tabId)
      case 'storage.set':
        return this.setStorageMarker(String(request.sessionId ?? ''), request.tabId, String(request.selector || 'wr-iso'), String(request.text ?? ''))
      case 'storage.peek':
        return this.peekStorageMarker(String(request.sessionId ?? ''), request.tabId, String(request.selector || 'wr-iso'))
      case 'click':
        return this.click({
          owner: request.owner,
          sessionId: String(request.sessionId ?? ''),
          tabId: request.tabId,
          selector: request.selector,
          text: request.text,
          commanderApproved: request.commanderApproved,
        })
      case 'type':
        return this.type({
          owner: request.owner,
          sessionId: String(request.sessionId ?? ''),
          tabId: request.tabId,
          selector: String(request.selector ?? ''),
          text: String(request.text ?? ''),
          commanderApproved: request.commanderApproved,
        })
      case 'submit':
        return this.submit({
          owner: request.owner,
          sessionId: String(request.sessionId ?? ''),
          tabId: request.tabId,
          selector: request.selector,
          commanderApproved: request.commanderApproved,
        })
      case 'wait':
        return this.wait(Number(request.text ?? 400))
      default:
        return this.classifyAndGate(request)
    }
  }

  private requireSession(sessionId: string): BrokerResult<BrokerSession> {
    const session = this.sessions.get(sessionId)
    if (!session) return err('SESSION_NOT_FOUND')
    return { ok: true, result: session }
  }

  private touchSession(session: BrokerSession, action: string): void {
    session.lastAction = action
    session.lastActionAt = new Date().toISOString()
  }

  private assertControl(session: BrokerSession, owner: BrowserOwner, mutating: boolean): BrokerResult<true> {
    if (!mutating) return { ok: true, result: true }
    if (session.controlState === 'CLOSED') return err('SESSION_NOT_FOUND')
    if (session.controlState === 'COMMANDER_CONTROL' && owner !== 'commander') {
      return err('COMMANDER_CONTROL_ACTIVE', { verdict: 'COMMANDER_CONTROL_ACTIVE' })
    }
    return { ok: true, result: true }
  }

  private assertTrustedProfileAccess(owner: BrowserOwner, profileId?: string): BrokerResult<TrustedBrowserProfileV1> {
    if (!profileId) return err('PROFILE_NOT_FOUND')
    const profile = loadProfile(profileId)
    if (!profile) return err('PROFILE_NOT_FOUND')
    if (profile.state === 'CORRUPT' || profile.auth_state === 'CORRUPT') return err('PROFILE_CORRUPT')
    if (profile.state === 'LOCKED') return err('PROFILE_LOCKED')
    if (profile.state === 'DISABLED') return err('PROFILE_DISABLED')
    if (profile.state === 'NEEDS_REAUTH') return err('PROFILE_NEEDS_REAUTH')
    if (owner === 'council' && !profile.allow_council) return err('PROFILE_ACCESS_DENIED')
    if (owner === 'foundry' && !profile.allow_foundry) return err('PROFILE_ACCESS_DENIED')
    if (owner !== 'commander' && capabilityFor(owner, 'trusted_profile.use') === 'NO') return err('PROFILE_ACCESS_DENIED')
    return { ok: true, result: profile }
  }

  private async persistTrustedSession(session: BrokerSession): Promise<{ ok: true } | { ok: false; error: string }> {
    if (session.kind !== 'persistent_authorized' || !session.profileId) return { ok: true }
    const state = await session.context.storageState()
    const written = writeEncryptedStorageState(session.profileId, JSON.stringify(state))
    if (!written.ok) {
      this.recordFailure(written.error, written.error)
      void recordBrowserAudit({
        owner: 'broker',
        action_type: 'PROFILE_PERSIST_BLOCKED',
        result: written.error,
        profile_id: session.profileId,
        session_id: session.sessionId,
      })
      return { ok: false, error: written.error }
    }
    return { ok: true }
  }

  listTrustedProfiles(owner: BrowserOwner): BrokerResult<{ profiles: ReturnType<typeof listProfiles> }> {
    const all = listProfiles()
    const profiles = owner === 'commander' || owner === 'broker'
      ? all
      : all.filter(profile => owner === 'council' ? profile.allow_council : owner === 'foundry' ? profile.allow_foundry : false)
    return { ok: true, result: { profiles } }
  }

  createProfile(request: BrowserActionRequest): BrokerResult<{ profile: ReturnType<typeof listProfiles>[number] }> {
    if (request.owner !== 'commander') return err('COMMANDER_ONLY', { verdict: 'DENIED' })
    const created = createTrustedProfile({
      display_name: String(request.displayName || request.text || 'Trusted profile'),
      allowed_origins: request.allowedOrigins,
      allow_council: request.allowCouncil === true,
      allow_foundry: request.allowFoundry === true,
      default_action_policy: request.actionPolicy,
    })
    const listed = listProfiles().find(item => item.profile_id === created.profile_id)
    void recordBrowserAudit({ owner: 'commander', action_type: 'profile.create', result: 'ok', profile_id: created.profile_id })
    return { ok: true, result: { profile: listed! } }
  }

  rotateSecureStorage(owner: BrowserOwner): BrokerResult<{ from: string; to: string; profiles: number }> {
    if (owner !== 'commander') return err('COMMANDER_ONLY', { verdict: 'DENIED' })
    const rotated = rotateAllProfileKeys()
    if (!rotated.ok) return err(rotated.error)
    return { ok: true, result: { from: rotated.from, to: rotated.to, profiles: rotated.profiles } }
  }

  changeProfileState(owner: BrowserOwner, profileId: string, state: 'LOCKED' | 'ACTIVE' | 'DISABLED'): BrokerResult<{ profile_id: string; state: string }> {
    if (owner !== 'commander') return err('COMMANDER_ONLY', { verdict: 'DENIED' })
    const updated = setProfileState(profileId, state)
    if (!updated) return err('PROFILE_NOT_FOUND')
    return { ok: true, result: { profile_id: profileId, state: updated.state } }
  }

  async deleteProfile(owner: BrowserOwner, profileId: string): Promise<BrokerResult<{ profile_id: string }>> {
    if (owner !== 'commander') return err('COMMANDER_ONLY', { verdict: 'DENIED' })
    for (const session of [...this.sessions.values()]) {
      if (session.profileId === profileId) {
        session.kind = 'ephemeral'
        session.profileId = null
        await this.closeSession(session.sessionId)
      }
    }
    const deleted = deleteTrustedProfile(profileId)
    if (!deleted.ok) return err(deleted.error)
    return { ok: true, result: { profile_id: profileId } }
  }

  profileStatus(profileId: string): BrokerResult<{ profile: ReturnType<typeof listProfiles>[number] | null; auth_state: string }> {
    const profile = loadProfile(profileId)
    if (!profile) return err('PROFILE_NOT_FOUND')
    const listed = listProfiles().find(item => item.profile_id === profileId) ?? null
    return { ok: true, result: { profile: listed, auth_state: profile.auth_state } }
  }

  sessionStatus(sessionId: string): BrokerResult<{
    sessionId: string
    tabId: string | null
    controlState: ControlState
    profileId: string | null
    kind: BrowserSessionKind
    url: string
    title: string
    humanRequired: boolean
    auth_state: string
  }> {
    const session = this.sessions.get(sessionId)
    if (!session) return err('SESSION_NOT_FOUND')
    const tab = session.activeTabId ? session.tabs.get(session.activeTabId) : null
    const url = tab ? tab.page.url() : ''
    const title = ''
    return { ok: true, result: {
      sessionId,
      tabId: session.activeTabId,
      controlState: session.controlState,
      profileId: session.profileId,
      kind: session.kind,
      url: redactUrl(url),
      title,
      humanRequired: false,
      auth_state: session.profileId ? (loadProfile(session.profileId)?.auth_state ?? 'UNKNOWN_AUTH') : 'UNKNOWN_AUTH',
    } }
  }

  async tabList(sessionId: string): Promise<BrokerResult<{ tabs: { tabId: string; url: string; title: string; active: boolean }[] }>> {
    const session = this.sessions.get(sessionId)
    if (!session) return err('SESSION_NOT_FOUND')
    const tabs = []
    for (const [tabId, tab] of session.tabs) {
      tabs.push({
        tabId,
        url: redactUrl(tab.page.url()),
        title: await tab.page.title().catch(() => ''),
        active: tabId === session.activeTabId,
      })
    }
    return { ok: true, result: { tabs } }
  }

  async startTakeover(owner: BrowserOwner, sessionId: string): Promise<BrokerResult<{ sessionId: string; tabId: string | null; controlState: ControlState }>> {
    if (owner !== 'commander') return err('COMMANDER_ONLY', { verdict: 'DENIED' })
    const session = this.sessions.get(sessionId)
    if (!session) return err('SESSION_NOT_FOUND')
    session.controlState = 'COMMANDER_CONTROL'
    this.touchSession(session, 'TAKEOVER_STARTED')
    void recordBrowserAudit({ owner, action_type: 'TAKEOVER_STARTED', result: 'ok', session_id: sessionId, profile_id: session.profileId })
    return { ok: true, result: { sessionId, tabId: session.activeTabId, controlState: session.controlState } }
  }

  async returnControl(owner: BrowserOwner, sessionId: string): Promise<BrokerResult<{ sessionId: string; tabId: string | null; controlState: ControlState; extract: BrowserExtractedPage | null }>> {
    if (owner !== 'commander') return err('COMMANDER_ONLY', { verdict: 'DENIED' })
    const session = this.sessions.get(sessionId)
    if (!session) return err('SESSION_NOT_FOUND')
    session.controlState = 'HANDOFF_PENDING'
    await this.persistTrustedSession(session).catch(() => undefined)
    const extracted = session.activeTabId ? await this.extract(sessionId, session.activeTabId) : null
    if (extracted && extracted.ok && session.profileId) {
      const auth = inferAuthState({
        title: extracted.result.title,
        text: extracted.result.readableText,
        url: extracted.result.finalUrl,
        hasStorageState: storageStateExists(session.profileId),
      })
      markProfileUsed(session.profileId, auth)
    }
    session.controlState = 'AGENT_CONTROL'
    this.touchSession(session, 'CONTROL_RETURNED')
    void recordBrowserAudit({ owner, action_type: 'TAKEOVER_ENDED', result: 'ok', session_id: sessionId, profile_id: session.profileId })
    void recordBrowserAudit({ owner, action_type: 'CONTROL_RETURNED', result: 'ok', session_id: sessionId, profile_id: session.profileId })
    return {
      ok: true,
      result: {
        sessionId,
        tabId: session.activeTabId,
        controlState: session.controlState,
        extract: extracted && extracted.ok ? extracted.result : null,
      },
    }
  }

  async previewTab(sessionId: string, tabId?: string): Promise<BrokerResult<{ path?: string; degraded: boolean }>> {
    const shot = await this.screenshot(sessionId, tabId, { fullPage: false })
    if (!shot.ok) {
      if (this.health === 'OFFLINE') return err('BROWSER_OFFLINE')
      return { ok: true, result: { degraded: true } }
    }
    return { ok: true, result: { path: shot.result.path, degraded: false } }
  }

  async press(input: { owner: BrowserOwner; sessionId: string; tabId?: string; text: string }): Promise<BrokerResult<{ pressed: boolean }>> {
    const session = this.sessions.get(input.sessionId)
    if (!session) return err('SESSION_NOT_FOUND')
    const control = this.assertControl(session, input.owner, true)
    if (!control.ok) return control
    const tab = this.requireTab(input.sessionId, input.tabId)
    if (!tab.ok) return tab
    await tab.result.page.keyboard.press(input.text.slice(0, 24) || 'Enter')
    this.touchSession(session, 'press')
    return { ok: true, result: { pressed: true } }
  }

  async inspectHuman(sessionId: string, tabId?: string): Promise<BrokerResult<{ humanRequired: boolean; code?: string }>> {
    const extracted = await this.extract(sessionId, tabId)
    if (!extracted.ok) return extracted
    const required = detectHumanInteractionRequired({
      title: extracted.result.title,
      text: extracted.result.readableText,
      url: extracted.result.finalUrl,
    })
    if (required) return { ok: true, result: { humanRequired: true, code: 'HUMAN_INTERACTION_REQUIRED' } }
    return { ok: true, result: { humanRequired: false } }
  }

  async persistSession(sessionId: string): Promise<BrokerResult<{ persisted: boolean }>> {
    const session = this.sessions.get(sessionId)
    if (!session) return err('SESSION_NOT_FOUND')
    const persisted = await this.persistTrustedSession(session)
    if (!persisted.ok) return err(persisted.error)
    return { ok: true, result: { persisted: session.kind === 'persistent_authorized' } }
  }

  private requireTab(sessionId: string, tabId?: string): BrokerResult<BrokerTab> {
    const session = this.sessions.get(sessionId)
    if (!session) return err('Unknown browser session.')
    const id = tabId || session.activeTabId
    if (!id) return err('No active browser tab.')
    const tab = session.tabs.get(id)
    if (!tab) return err(`Unknown tabId: ${id}`)
    return { ok: true, result: tab }
  }

  private assertNavigationTarget(rawUrl: string, session: BrokerSession, owner: BrowserOwner = 'broker', commanderApproved = false): BrokerResult<true> {
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return err(`Not a valid URL: ${rawUrl}`)
    }
    if (FILE_SCHEME.test(parsed.protocol)) {
      return err('file:// targets are denied by the Browser Broker.')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return err(`Browser scheme not permitted: ${parsed.protocol}`)
    }
    if (isLoopbackHost(parsed.hostname) && !session.allowLocalhost) {
      return err('Council browser sessions cannot reach localhost unless explicitly allowed.')
    }
    if (session.kind === 'persistent_authorized' && session.profileId && owner !== 'commander' && !commanderApproved) {
      const profile = loadProfile(session.profileId)
      if (profile) {
        const origin = evaluateOriginAccess({
          url: rawUrl,
          allowed_origins: profile.allowed_origins,
          denied_origins: profile.denied_origins,
        })
        if (!origin.ok) return err('PROFILE_ORIGIN_NOT_ALLOWED')
      }
    }
    return { ok: true, result: true }
  }

  private async openTabOn(session: BrokerSession): Promise<BrokerTab> {
    const page = await session.context.newPage()
    const tabId = `tab-${randomUUID()}`
    const tab: BrokerTab = { tabId, page, consoleLog: [], networkLog: [], requests: [], downloads: [] }
    this.attachListeners(tab)
    session.tabs.set(tabId, tab)
    session.activeTabId = tabId
    return tab
  }

  private attachListeners(tab: BrokerTab): void {
    tab.page.on('console', message => {
      tab.consoleLog.push({
        at: new Date().toISOString(),
        kind: message.type(),
        text: redactSecretsFromOutput(message.text()).slice(0, 2000),
      })
      if (tab.consoleLog.length > MAX_CONSOLE) tab.consoleLog.shift()
    })
    tab.page.on('response', response => {
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(response.headers())) {
        headers[key] = SENSITIVE_HEADER.test(key) ? '[REDACTED]' : redactSecretsFromOutput(value)
      }
      tab.networkLog.push({
        at: new Date().toISOString(),
        method: response.request().method(),
        url: redactUrl(response.url()),
        status: response.status(),
        ok: response.ok(),
        resourceType: response.request().resourceType(),
      })
      if (tab.networkLog.length > MAX_NETWORK) tab.networkLog.shift()
      tab.requests.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        method: response.request().method(),
        url: redactUrl(response.url()),
        resourceType: response.request().resourceType(),
        status: response.status(),
        headers,
      })
      if (tab.requests.length > MAX_NETWORK) tab.requests.shift()
    })
    tab.page.on('requestfailed', request => {
      tab.networkLog.push({
        at: new Date().toISOString(),
        method: request.method(),
        url: redactUrl(request.url()),
        status: null,
        ok: false,
        resourceType: request.resourceType(),
      })
      if (tab.networkLog.length > MAX_NETWORK) tab.networkLog.shift()
    })
    tab.page.on('download', download => {
      void (async () => {
        const dirs = browserBrokerDataDirs()
        const dest = path.join(dirs.downloads, `${Date.now()}-${download.suggestedFilename()}`)
        await download.saveAs(dest).catch(() => undefined)
        tab.downloads.push({
          downloadId: `dl-${randomUUID()}`,
          suggestedFilename: download.suggestedFilename(),
          savedAs: dest,
          url: redactUrl(download.url()),
          executed: false,
          at: new Date().toISOString(),
        })
      })()
    })
  }

  private recordFailure(code: string, message: string): void {
    this.lastFailure = {
      at: new Date().toISOString(),
      code,
      message: redactSecretsFromOutput(message).slice(0, 800),
    }
  }
}

function findOwnedChromiumPid(executable: string): number | null {
  try {
    const procs = readdirSync('/proc')
    const hits: { pid: number; start: number }[] = []
    for (const entry of procs) {
      if (!/^\d+$/.test(entry)) continue
      const pid = Number(entry)
      let exe = ''
      try {
        exe = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')[0] ?? ''
      } catch {
        continue
      }
      if (!exe) continue
      const owned = exe === executable || exe.startsWith(`${executable} `) || (exe.includes('ms-playwright') && exe.endsWith('/chrome'))
      if (!owned) continue
      let start = 0
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
        start = Number(stat.split(' ')[21] ?? 0)
      } catch {
        start = 0
      }
      hits.push({ pid, start })
    }
    hits.sort((a, b) => b.start - a.start)
    return hits[0]?.pid ?? null
  } catch {
    return null
  }
}

function safeServerPid(server: PlaywrightBrowserServer): number | null {
  try {
    if (typeof server.process === 'function') {
      return server.process()?.pid ?? null
    }
  } catch {
    // ignore
  }
  return null
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

let singleton: BrowserBroker | null = null

export function getBrowserBroker(): BrowserBroker {
  if (!singleton) singleton = new BrowserBroker()
  return singleton
}

export function resetBrowserBrokerForTests(): void {
  singleton = null
}

export type { BrowserActionKind }
