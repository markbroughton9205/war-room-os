/**
 * #22 Phase 10 — Sovereign local runtime constants + truth contracts.
 * WEBSITE != WAR ROOM. Cloudflare = OPTIONAL_REMOTE_CONNECTIVITY.
 */
export const SOVEREIGN_RUNTIME_VERSION = 'ascension-phase11a-v1' as const
export const DESKTOP_APP_VERSION = '0.2.0-local-ui' as const

/** Dedicated local-app ports — must not collide with prod :3000 or DEV :3001. */
export const LOCAL_CORE_PORT = 3847 as const
export const LOCAL_UI_PORT = 3848 as const
export const LOCAL_CORE_HOST = '127.0.0.1' as const
export const LOCAL_CORE_ORIGIN = `http://${LOCAL_CORE_HOST}:${LOCAL_CORE_PORT}` as const
export const LOCAL_UI_ORIGIN = `http://${LOCAL_CORE_HOST}:${LOCAL_UI_PORT}` as const

export const PUBLIC_DOMAIN = 'warroomos.com' as const
export const FORBIDDEN_DESKTOP_NAV_HOSTS = Object.freeze([
  PUBLIC_DOMAIN,
  `www.${PUBLIC_DOMAIN}`,
  'vercel.app',
] as const)

export const CORE_BOOT_STATES = [
  'CORE_UNKNOWN',
  'CORE_STARTING',
  'CORE_RUNNING',
  'CORE_READY',
  'CORE_DEGRADED',
  'CORE_FAILED',
  'CORE_PORT_CONFLICT',
] as const
export type CoreBootState = (typeof CORE_BOOT_STATES)[number]

export const UI_BOOT_STATES = [
  'UI_UNKNOWN',
  'UI_STARTING',
  'UI_READY',
  'UI_DEGRADED',
  'UI_FAILED',
  'UI_PORT_CONFLICT',
] as const
export type UiBootState = (typeof UI_BOOT_STATES)[number]

export const DESKTOP_LIFECYCLE_STATES = [
  'CORE_STARTING',
  'UI_STARTING',
  'READY',
  'DEGRADED',
  'PORT_CONFLICT',
  'CORE_FAILED',
  'UI_FAILED',
] as const
export type DesktopLifecycleState = (typeof DESKTOP_LIFECYCLE_STATES)[number]

export const CONNECTIVITY_PRIORITY = Object.freeze([
  'LOCAL_CORE',
  'FUTURE_LAN_PRIVATE',
  'OPTIONAL_REMOTE_PUBLIC',
] as const)

export const RUNTIME_SURFACE_MODES = Object.freeze([
  'WEB_REMOTE',
  'DESKTOP_LOCAL',
  'PHONE_REMOTE_PRIVATE',
] as const)
export type RuntimeSurfaceMode = (typeof RUNTIME_SURFACE_MODES)[number]

export type DataOwnershipClass = 'LOCAL' | 'REMOTE' | 'HYBRID' | 'UNAVAILABLE_OFFLINE'

export type SovereignRuntimeTruth = {
  WAR_ROOM_CORE: 'IMPLEMENTED_LOCAL'
  DESKTOP_APP: 'IMPLEMENTED_LOCAL_UI' | 'IMPLEMENTED_FOUNDATION'
  FULL_WAR_ROOM_UI_LOCAL: 'IMPLEMENTED' | 'NOT_YET_PACKAGED'
  WEBSITE_REQUIRED: false
  WEBSITE_REQUIRED_FOR_UI: false
  PUBLIC_DOMAIN_REQUIRED_FOR_LOCAL_USE: false
  PUBLIC_DNS_REQUIRED_FOR_UI: false
  CLOUDFLARE_REQUIRED_FOR_LOCAL_USE: false
  CLOUDFLARE_REQUIRED_FOR_UI: false
  INTERNET_REQUIRED_FOR_LOCAL_CORE: false
  INTERNET_REQUIRED_FOR_LOCAL_UI: false
  EXTERNAL_AI_REQUIRED_FOR_CORE: false
  LOCAL_MODEL_PATH: 'PARTIAL'
  PRIVILEGED_OFFLINE_OWNERSHIP: 'NOT_IMPLEMENTED'
  PHONE_APP: 'NOT_IMPLEMENTED'
  NATIVE_WRIM: 'NOT_IMPLEMENTED'
  FUTURE_NAVIGATION_AGENT: 'TARGET_UNIMPLEMENTED' | 'UNEXPECTED'
  ASCENSION_AUTONOMY: 'OFF' | 'ON'
  ROADMAP_22: 'ACTIVE'
  ROADMAP_23: 'NOT_STARTED'
  OPERATIONAL_ASCENSION_AGENTS: number
  GATE16_PREBUILD: 'PASS_14_OF_14'
  RUNTIME_SURFACE: 'DESKTOP_LOCAL'
}

export type OfflineCapabilityReport = {
  WAR_ROOM_CORE: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'FAILED'
  INTERNET: 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
  LOCAL_MODELS: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN'
  LOCAL_CORPUS: 'AVAILABLE' | 'UNAVAILABLE' | 'PARTIAL'
  LOCAL_SEARCH_INDEX: 'AVAILABLE' | 'UNAVAILABLE' | 'PARTIAL'
  COUNCIL: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'
  TERRA_LIVE_PROVIDERS: 'AVAILABLE' | 'UNAVAILABLE' | 'PARTIAL'
  TERRA_LOCAL_OR_CACHED: 'AVAILABLE' | 'UNAVAILABLE' | 'PARTIAL'
  EXTERNAL_AI: 'AVAILABLE' | 'UNAVAILABLE' | 'PARTIAL'
  CLOUDFLARE_TUNNEL: 'OPTIONAL_REMOTE' | 'UNAVAILABLE' | 'UNKNOWN'
  PUBLIC_WEBSITE: 'OPTIONAL_REMOTE' | 'UNAVAILABLE' | 'UNKNOWN'
}

export type BuildIdentity = {
  desktop_version: string
  core_version: string
  web_release_version: string | null
  git_sha: string | null
  dirty: boolean | null
  built_at: string
  runtime_version: string
}

export type LocalHealthContract = {
  surface: 'LOCAL_CORE'
  status: 'ok' | 'degraded' | 'failed'
  boot_state: CoreBootState
  host: typeof LOCAL_CORE_HOST
  port: typeof LOCAL_CORE_PORT
  bind: 'loopback_only'
  identity: BuildIdentity
  offline: OfflineCapabilityReport
  connectivity_priority: typeof CONNECTIVITY_PRIORITY
  website_fallback: 'DENIED'
  notes: string[]
}

export const LOCAL_DATA_OWNERSHIP_INVENTORY: readonly {
  dataset: string
  class: DataOwnershipClass
  notes: string
}[] = Object.freeze([
  { dataset: 'conversations', class: 'HYBRID', notes: 'Supabase-backed; #19 ownership. Offline without session = UNAVAILABLE_OFFLINE for privileged reads.' },
  { dataset: 'ascension_agent_code', class: 'LOCAL', notes: 'Repo modules under lib/ascension/*.' },
  { dataset: 'search_corpus_index', class: 'LOCAL', notes: 'Sovereign Search local index files when present.' },
  { dataset: 'terra_cache', class: 'HYBRID', notes: 'Live providers remote; fixtures/cache local.' },
  { dataset: 'astra_fallback', class: 'HYBRID', notes: 'Filesystem fallback + Supabase when configured; phase58a NOT APPLIED.' },
  { dataset: 'audit_records', class: 'HYBRID', notes: 'Governed audit may persist remotely when Supabase present.' },
  { dataset: 'local_model_state', class: 'LOCAL', notes: 'Ollama process + models on host.' },
  { dataset: 'desktop_local_session', class: 'LOCAL', notes: 'Phase 10 loopback session token — not a substitute for Supabase Commander auth.' },
] as const)

export const COMMANDER_CONTROL_SURFACE_SLOTS = Object.freeze([
  'Core status',
  'Internet state',
  'Local/remote mode',
  'Provider availability',
  'Ascension status',
  'Agent enable/disable',
  'Audit',
  'Approvals',
] as const)

export const DESKTOP_SECURITY_POLICY = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  allowArbitraryShell: false,
  allowArbitraryPowerShell: false,
  allowUnrestrictedFilesystem: false,
  allowNavigatePublicDomainWithBridge: false,
  bindAddress: LOCAL_CORE_HOST,
  denyBindAllInterfaces: true,
  updaterRequired: false,
  remoteKillSwitch: false,
} as const)
