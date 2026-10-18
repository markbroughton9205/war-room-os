/**
 * #22 Phase 10 — Sovereign local runtime constants + truth contracts.
 * WEBSITE != WAR ROOM. Cloudflare = OPTIONAL_REMOTE_CONNECTIVITY.
 */
export const SOVEREIGN_RUNTIME_VERSION = 'ascension-phase11d-v1' as const
export const DESKTOP_APP_VERSION = '0.2.0-installable' as const

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
  WINDOWS_INSTALLABLE_APPLICATION:
    | 'IMPLEMENTED'
    | 'NOT_YET_FULLY_PROVEN'
    | 'PACKAGING_CONFIGURED'
    // Installer builds and installs; the installed payload boots Core + UI from installed
    // files only. The installed .exe itself cannot start while unsigned on a machine with
    // Windows Smart App Control enabled.
    | 'INSTALLED_PAYLOAD_PROVEN_EXE_LAUNCH_BLOCKED'
  DESKTOP_SHORTCUT: 'CONFIGURED' | 'NOT_YET_PROVEN' | 'PROVEN' | 'CREATED_BY_INSTALLER'
  START_MENU_ENTRY: 'CONFIGURED' | 'NOT_YET_PROVEN' | 'PROVEN' | 'CREATED_BY_INSTALLER'
  APP_ICON: 'COMMANDER_APPROVED' | 'INTERIM_PENDING_COMMANDER_PNG' | 'MISSING'
  CODE_SIGNING: 'NOT_CONFIGURED' | 'CONFIGURED'
  /**
   * Windows Smart App Control is enabled on the Commander machine and has blocked an unsigned
   * build of this application before. Launch of an unsigned binary is therefore not guaranteed
   * until code signing is configured, even when a given build currently launches.
   */
  SMART_APP_CONTROL:
    | 'BLOCKING_UNSIGNED_INSTALLED_EXE'
    | 'ENABLED_INTERMITTENTLY_BLOCKING_UNSIGNED'
    | 'NOT_BLOCKING'
    | 'UNKNOWN'
  INSTALLED_EXE_LIVE_PROOF: 'BLOCKED' | 'PROVEN' | 'NOT_ATTEMPTED'
  PHASE_11D: 'NOT_COMPLETE' | 'COMPLETE'
  LOCAL_MODEL_ROUTER: 'IMPLEMENTED'
  LOCAL_MODEL_PATH: 'IMPLEMENTED' | 'PARTIAL'
  OLLAMA_PATH: 'IMPLEMENTED'
  LM_STUDIO_PATH: 'NOT_IMPLEMENTED'
  LOCAL_COUNCIL_FALLBACK: 'IMPLEMENTED'
  WEBSITE_REQUIRED: false
  WEBSITE_REQUIRED_FOR_UI: false
  PUBLIC_DOMAIN_REQUIRED_FOR_LOCAL_USE: false
  PUBLIC_DNS_REQUIRED_FOR_UI: false
  CLOUDFLARE_REQUIRED_FOR_LOCAL_USE: false
  CLOUDFLARE_REQUIRED_FOR_UI: false
  INTERNET_REQUIRED_FOR_LOCAL_CORE: false
  INTERNET_REQUIRED_FOR_LOCAL_UI: false
  EXTERNAL_AI_REQUIRED_FOR_CORE: false
  LOCAL_MODEL_REQUIRED_FOR_CORE_START: false
  PRIVILEGED_OFFLINE_OWNERSHIP: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  LOCAL_COMMANDER_IDENTITY: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  LOCAL_COMMANDER_AUTH: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  LOCAL_SESSION: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  LOCAL_OWNERSHIP: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  LOCAL_CONVERSATIONS: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  LOCAL_MESSAGE_PERSISTENCE: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  OFFLINE_LOCAL_CHAT: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  LOCAL_CONVERSATIONS_OFFLINE: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  SUPABASE_REQUIRED_FOR_LOCAL_COMMANDER_ACCESS: false | true
  SUPABASE_REQUIRED_FOR_REMOTE_DATA: true
  LOCAL_REMOTE_IDENTITY_LINK: 'IMPLEMENTED_FOUNDATION' | 'NOT_IMPLEMENTED'
  AUTOMATIC_SYNC: 'NOT_IMPLEMENTED'
  LOCAL_COMMANDER_RECOVERY: 'NOT_IMPLEMENTED'
  PHONE_APP: 'NOT_IMPLEMENTED'
  NATIVE_WRIM: 'NOT_IMPLEMENTED'
  FUTURE_NAVIGATION_AGENT: 'TARGET_UNIMPLEMENTED' | 'IMPLEMENTED_BOUNDED' | 'UNEXPECTED'
  NAVIGATION_AGENT: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  NAVIGATION_AGENT_OPERATIONAL: boolean
  FUTURE_WORLD_LEARNING_AGENT: 'TARGET_UNIMPLEMENTED' | 'IMPLEMENTED_BOUNDED' | 'UNEXPECTED'
  WORLD_LEARNING_AGENT: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  WORLD_LEARNING_AGENT_OPERATIONAL: boolean
  WORLD_LEARNING_CORPUS_HANDOFF: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  AUTONOMOUS_CORPUS_PERSISTENCE: false
  CROSS_AGENT_INTEGRATION: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  RESEARCH_TO_WORLD_LEARNING: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  WORLD_LEARNING_TO_DATA_CORPUS: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  DURABLE_CORPUS_CANDIDATE_HANDOFF: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  TERRA_TO_NAVIGATION: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  NAVIGATION_TO_COUNCIL: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  OPERATIONS_TO_SECURITY: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  SECURITY_TO_ENGINEERING_RECOMMENDATION: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  COUNCIL_TO_VALIDATOR: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  ASTRA_BOUNDED_MULTI_AGENT_ORCHESTRATION: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'
  ASTRA_PHASE58A: 'NOT_APPLIED'
  PRODUCTION_CORPUS_PERSISTENCE: false
  MODEL_TRAINING: 'NOT_IMPLEMENTED'
  ASCENSION_AUTONOMY: 'OFF' | 'ON'
  PHASE_15: 'COMPLETE'
  ROADMAP_19_LIVE_MIGRATION: 'CONFIRMED'
  LOCAL_SOVEREIGN_CLOSEOUT_SUFFICIENT: true
  ROADMAP_22: 'CLOSED'
  ROADMAP_23: 'NOT_STARTED' | 'ACTIVE'
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
  COUNCIL: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'DEGRADED_LOCAL'
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
  { dataset: 'conversations', class: 'HYBRID', notes: 'Remote: Supabase #19. Local: Phase 11C COMMANDER_LOCAL SQLite under AppData. No auto-merge.' },
  { dataset: 'local_commander_identity', class: 'LOCAL', notes: 'scrypt-hashed credentials in AppData; not Supabase UUID.' },
  { dataset: 'local_conversations', class: 'LOCAL', notes: 'Phase 11C offline owned conversations/messages.' },
  { dataset: 'ascension_agent_code', class: 'LOCAL', notes: 'Repo modules under lib/ascension/*.' },
  { dataset: 'search_corpus_index', class: 'LOCAL', notes: 'Sovereign Search local index files when present.' },
  { dataset: 'terra_cache', class: 'HYBRID', notes: 'Live providers remote; fixtures/cache local.' },
  { dataset: 'astra_fallback', class: 'HYBRID', notes: 'Filesystem fallback + Supabase when configured; phase58a NOT APPLIED.' },
  { dataset: 'corpus_candidate_handoffs', class: 'LOCAL', notes: 'Phase 14 durable candidate-handoff SQLite under AppData. Not production corpus. Promotion into WR-CORPUS is explicit/governed.' },
  { dataset: 'wr_corpus', class: 'LOCAL', notes: 'Canonical WR-CORPUS v1 under AppData data/wr-corpus. Immutable recovered artifacts + SQLite index. Not git. Not install-dir.' },
  { dataset: 'audit_records', class: 'HYBRID', notes: 'Governed audit may persist remotely when Supabase present.' },
  { dataset: 'local_model_state', class: 'LOCAL', notes: 'Ollama process + models on host.' },
  { dataset: 'desktop_local_session', class: 'LOCAL', notes: 'Phase 11C local Commander session (cookie/bearer); distinct from remote Supabase session.' },
] as const)

export const COMMANDER_CONTROL_SURFACE_SLOTS = Object.freeze([
  'Core status',
  'Internet state',
  'Local/remote mode',
  'Provider availability',
  'Ascension status',
  'Agent enable/disable',
  'Workflow / handoff status',
  'Corpus-candidate review',
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
