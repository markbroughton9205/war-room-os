/**
 * #22 Phase 10 — Sovereign local runtime constants + truth contracts.
 * WEBSITE != WAR ROOM. Cloudflare = OPTIONAL_REMOTE_CONNECTIVITY.
 */
export const SOVEREIGN_RUNTIME_VERSION = 'ascension-phase10-v1' as const
export const DESKTOP_APP_VERSION = '0.1.0-foundation' as const

/** Dedicated local-app port — must not collide with prod :3000 or DEV :3001. */
export const LOCAL_CORE_PORT = 3847 as const
export const LOCAL_CORE_HOST = '127.0.0.1' as const
export const LOCAL_CORE_ORIGIN = `http://${LOCAL_CORE_HOST}:${LOCAL_CORE_PORT}` as const

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

export const CONNECTIVITY_PRIORITY = Object.freeze([
  'LOCAL_CORE',
  'FUTURE_LAN_PRIVATE',
  'OPTIONAL_REMOTE_PUBLIC',
] as const)

export type DataOwnershipClass = 'LOCAL' | 'REMOTE' | 'HYBRID' | 'UNAVAILABLE_OFFLINE'

export type SovereignRuntimeTruth = {
  WAR_ROOM_CORE: 'IMPLEMENTED_LOCAL'
  DESKTOP_APP: 'IMPLEMENTED_FOUNDATION'
  WEBSITE_REQUIRED: false
  PUBLIC_DOMAIN_REQUIRED_FOR_LOCAL_USE: false
  CLOUDFLARE_REQUIRED_FOR_LOCAL_USE: false
  INTERNET_REQUIRED_FOR_LOCAL_CORE: false
  EXTERNAL_AI_REQUIRED_FOR_CORE: false
  PHONE_APP: 'NOT_IMPLEMENTED'
  NATIVE_WRIM: 'NOT_IMPLEMENTED'
  FUTURE_NAVIGATION_AGENT: 'TARGET_UNIMPLEMENTED' | 'UNEXPECTED'
  ASCENSION_AUTONOMY: 'OFF' | 'ON'
  ROADMAP_22: 'ACTIVE'
  ROADMAP_23: 'NOT_STARTED'
  OPERATIONAL_ASCENSION_AGENTS: number
  GATE16_PREBUILD: 'PASS_14_OF_14'
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
