/**
 * War Room Browser Broker — shared types for Council and Foundry.
 * Provider/model logic stays out of this module.
 */

export const BROWSER_BROKER_HEALTH_STATES = [
  'READY',
  'DEGRADED',
  'OFFLINE',
  'STARTING',
  'RECOVERING',
  'MISCONFIGURED',
  'UNKNOWN',
] as const

export type BrowserBrokerHealth = (typeof BROWSER_BROKER_HEALTH_STATES)[number]

export const BROWSER_SESSION_KINDS = ['ephemeral', 'persistent_authorized'] as const
export type BrowserSessionKind = (typeof BROWSER_SESSION_KINDS)[number]

export const BROWSER_OWNERS = ['council', 'foundry', 'broker', 'commander'] as const
export type BrowserOwner = (typeof BROWSER_OWNERS)[number]

export const BROWSER_SOURCE_TYPES = [
  'web_page',
  'search_result',
  'pdf',
  'download',
  'localhost',
  'documentation',
] as const
export type BrowserSourceType = (typeof BROWSER_SOURCE_TYPES)[number]

export type BrowserCitation = {
  citationId: string
  url: string
  finalUrl: string
  pageTitle: string
  timestamp: string
  sessionId: string
  tabId: string
  evidence: string
  sourceType: BrowserSourceType
  browser_session_type?: 'EPHEMERAL' | 'TRUSTED_PROFILE'
  profile_id_hash?: string | null
  origin?: string | null
  retrieved_at?: string
}

export type BrowserConsoleEntry = {
  at: string
  kind: string
  text: string
}

export type BrowserNetworkEntry = {
  at: string
  method: string
  url: string
  status: number | null
  ok: boolean | null
  resourceType?: string
}

export type BrowserDownloadRecord = {
  downloadId: string
  suggestedFilename: string
  savedAs: string
  url: string
  executed: false
  at: string
}

export type BrowserExtractedPage = {
  requestedUrl: string
  url: string
  finalUrl: string
  title: string
  readableText: string
  domText: string
  headings: string[]
  links: { text: string; href: string }[]
  metadata: {
    description: string | null
    ogTitle: string | null
    contentType: string | null
    publishedTime: string | null
    updatedTime: string | null
  }
  releases?: Array<{ title: string; date: string; url: string | null; summary: string | null }>
}

export type BrowserTabInfo = {
  tabId: string
  url: string
  title: string
  active: boolean
}

export type BrowserSessionInfo = {
  sessionId: string
  owner: BrowserOwner
  kind: BrowserSessionKind
  allowLocalhost: boolean
  createdAt: string
  tabCount: number
  tabs: BrowserTabInfo[]
  profileId?: string | null
  controlState?: string
  lastAction?: string | null
  lastActionAt?: string | null
  hostname?: string | null
}

export type BrowserBrokerFailure = {
  at: string
  code: string
  message: string
}

export type ChromiumRuntimeState = 'RUNNING' | 'IDLE' | 'STOPPED' | 'MISSING' | 'CRASHED' | 'UNKNOWN'

export type BrowserBrokerDiagnostics = {
  brokerState: BrowserBrokerHealth
  chromiumState: ChromiumRuntimeState
  chromiumPid: number | null
  chromiumExecutable: string | null
  engine: 'playwright-chromium'
  engineVersion: string | null
  activeSessions: number
  activeTabs: number
  sessions: BrowserSessionInfo[]
  lastFailure: BrowserBrokerFailure | null
  lastRecovery: { at: string; detail: string } | null
  playwrightAvailability: 'unknown' | 'available' | 'unavailable'
  screenshotCapability: boolean
  researchCapability: boolean
  startedAt: string | null
  profileStore?: {
    profileCount: number
    encryption: 'aes-256-gcm' | 'blocked'
    keyring: 'SECRET_SERVICE' | 'SECRET_SERVICE_UNAVAILABLE' | 'NONE'
    storage_security?: string
    key_state?: 'AVAILABLE' | 'UNAVAILABLE'
    key_id?: string | null
  }
}

export type BrowserStatusSnapshot = {
  broker_state: BrowserBrokerHealth
  chromium_state: ChromiumRuntimeState
  chromium_pid: number | null
  engine: 'playwright-chromium'
  engine_version: string | null
  executable: string | null
  active_sessions: number
  active_tabs: number
  last_failure: BrowserBrokerFailure | null
  last_recovery: { at: string; detail: string } | null
  playwright_available: boolean
  screenshot_capability: boolean
  research_capability: boolean
}

export const BROWSER_ACTION_VERDICTS = [
  'ALLOW_RESEARCH',
  'ACTION_REQUIRES_APPROVAL',
  'DENIED',
] as const
export type BrowserActionVerdict = (typeof BROWSER_ACTION_VERDICTS)[number]

export type BrowserActionKind =
  | 'status'
  | 'start'
  | 'stop'
  | 'restart'
  | 'session.create'
  | 'session.close'
  | 'tab.open'
  | 'tab.close'
  | 'tab.switch'
  | 'navigate'
  | 'search'
  | 'follow'
  | 'back'
  | 'forward'
  | 'reload'
  | 'scroll'
  | 'read'
  | 'extract'
  | 'screenshot'
  | 'pdf'
  | 'download'
  | 'console'
  | 'network'
  | 'cite'
  | 'storage.set'
  | 'storage.peek'
  | 'click'
  | 'type'
  | 'press'
  | 'hover'
  | 'select'
  | 'wait'
  | 'profile.list'
  | 'profile.create'
  | 'profile.lock'
  | 'profile.unlock'
  | 'profile.disable'
  | 'profile.delete'
  | 'profile.status'
  | 'secureStorage.rotate'
  | 'session.status'
  | 'tab.list'
  | 'control.takeover'
  | 'control.return'
  | 'preview'
  | 'submit'
  | 'purchase'
  | 'payment'
  | 'message_send'
  | 'email_send'
  | 'account_change'
  | 'password_change'
  | 'upload'
  | 'delete_remote'
  | 'execute_download'
  | 'install'
  | 'production_change'
  | 'commit'
  | 'push'
  | 'deploy'
  | 'settlement'
  | 'trade'
  | 'wager'

export type BrowserActionRequest = {
  kind: BrowserActionKind
  owner: BrowserOwner
  sessionId?: string
  tabId?: string
  url?: string
  query?: string
  selector?: string
  text?: string
  commanderApproved?: boolean
  allowLocalhost?: boolean
  fullPage?: boolean
  profileId?: string
  sessionMode?: 'EPHEMERAL' | 'TRUSTED_PROFILE'
  displayName?: string
  allowedOrigins?: string[]
  allowCouncil?: boolean
  allowFoundry?: boolean
  actionPolicy?: 'READ_ONLY' | 'RESEARCH' | 'INTERACTIVE_WITH_APPROVAL'
  missionId?: string
}

export type BrowserActionClassification = {
  verdict: BrowserActionVerdict
  actionKind: BrowserActionKind
  reason: string
  reasonCode: string
  canonicalKind: string | null
  research: boolean
}
