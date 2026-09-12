/**
 * #22 Phase 10/11A — Runtime truth + offline capability reporting.
 */
import {
  DESKTOP_APP_VERSION,
  LOCAL_CORE_HOST,
  LOCAL_CORE_PORT,
  LOCAL_UI_PORT,
  SOVEREIGN_RUNTIME_VERSION,
  type BuildIdentity,
  type OfflineCapabilityReport,
  type SovereignRuntimeTruth,
} from './constants'
import {
  operationalAscensionAgentCount,
  TARGET_ASCENSION_AGENTS_UNIMPLEMENTED,
  ascensionAutonomyIsOff,
} from '@/lib/ascension/operationalRegistry'

export function getSovereignRuntimeTruth(): SovereignRuntimeTruth {
  return {
    WAR_ROOM_CORE: 'IMPLEMENTED_LOCAL',
    DESKTOP_APP: 'IMPLEMENTED_LOCAL_UI',
    FULL_WAR_ROOM_UI_LOCAL: 'IMPLEMENTED',
    WINDOWS_INSTALLABLE_APPLICATION: 'IMPLEMENTED',
    DESKTOP_SHORTCUT: 'PROVEN',
    START_MENU_ENTRY: 'PROVEN',
    APP_ICON: 'COMMANDER_APPROVED',
    CODE_SIGNING: 'NOT_CONFIGURED',
    SMART_APP_CONTROL: 'ENABLED_INTERMITTENTLY_BLOCKING_UNSIGNED',
    INSTALLED_EXE_LIVE_PROOF: 'PROVEN',
    // Code signing remains unconfigured and the Commander has not closed the phase.
    PHASE_11D: 'NOT_COMPLETE',
    LOCAL_MODEL_ROUTER: 'IMPLEMENTED',
    LOCAL_MODEL_PATH: 'IMPLEMENTED',
    OLLAMA_PATH: 'IMPLEMENTED',
    LM_STUDIO_PATH: 'NOT_IMPLEMENTED',
    LOCAL_COUNCIL_FALLBACK: 'IMPLEMENTED',
    WEBSITE_REQUIRED: false,
    WEBSITE_REQUIRED_FOR_UI: false,
    PUBLIC_DOMAIN_REQUIRED_FOR_LOCAL_USE: false,
    PUBLIC_DNS_REQUIRED_FOR_UI: false,
    CLOUDFLARE_REQUIRED_FOR_LOCAL_USE: false,
    CLOUDFLARE_REQUIRED_FOR_UI: false,
    INTERNET_REQUIRED_FOR_LOCAL_CORE: false,
    INTERNET_REQUIRED_FOR_LOCAL_UI: false,
    EXTERNAL_AI_REQUIRED_FOR_CORE: false,
    LOCAL_MODEL_REQUIRED_FOR_CORE_START: false,
    PRIVILEGED_OFFLINE_OWNERSHIP: 'IMPLEMENTED',
    LOCAL_COMMANDER_IDENTITY: 'IMPLEMENTED',
    LOCAL_COMMANDER_AUTH: 'IMPLEMENTED',
    LOCAL_SESSION: 'IMPLEMENTED',
    LOCAL_OWNERSHIP: 'IMPLEMENTED',
    LOCAL_CONVERSATIONS: 'IMPLEMENTED',
    LOCAL_MESSAGE_PERSISTENCE: 'IMPLEMENTED',
    OFFLINE_LOCAL_CHAT: 'IMPLEMENTED',
    LOCAL_CONVERSATIONS_OFFLINE: 'IMPLEMENTED',
    SUPABASE_REQUIRED_FOR_LOCAL_COMMANDER_ACCESS: false,
    SUPABASE_REQUIRED_FOR_REMOTE_DATA: true,
    LOCAL_REMOTE_IDENTITY_LINK: 'IMPLEMENTED_FOUNDATION',
    AUTOMATIC_SYNC: 'NOT_IMPLEMENTED',
    LOCAL_COMMANDER_RECOVERY: 'NOT_IMPLEMENTED',
    PHONE_APP: 'NOT_IMPLEMENTED',
    NATIVE_WRIM: 'NOT_IMPLEMENTED',
    FUTURE_NAVIGATION_AGENT: TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_NAVIGATION_AGENT')
      ? 'TARGET_UNIMPLEMENTED'
      : 'UNEXPECTED',
    ASCENSION_AUTONOMY: ascensionAutonomyIsOff() ? 'OFF' : 'ON',
    ROADMAP_22: 'ACTIVE',
    ROADMAP_23: 'NOT_STARTED',
    OPERATIONAL_ASCENSION_AGENTS: operationalAscensionAgentCount(),
    GATE16_PREBUILD: 'PASS_14_OF_14',
    RUNTIME_SURFACE: 'DESKTOP_LOCAL',
  }
}

export type CapabilityInput = {
  internet?: 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
  ollamaReachable?: boolean | null
  publicWebsiteReachable?: boolean | null
  cloudflareReachable?: boolean | null
  externalAiConfigured?: boolean | null
  localSearchIndexPresent?: boolean | null
  coreOnline?: boolean
  coreDegraded?: boolean
}

export function buildOfflineCapabilityReport(input: CapabilityInput = {}): OfflineCapabilityReport {
  const coreOnline = input.coreOnline !== false
  const internet = input.internet ?? 'UNKNOWN'
  const ollama =
    input.ollamaReachable === true
      ? 'AVAILABLE'
      : input.ollamaReachable === false
        ? 'UNAVAILABLE'
        : 'UNKNOWN'
  const external =
    internet === 'OFFLINE'
      ? 'UNAVAILABLE'
      : input.externalAiConfigured === false
        ? 'UNAVAILABLE'
        : input.externalAiConfigured === true
          ? 'PARTIAL'
          : internet === 'ONLINE'
            ? 'PARTIAL'
            : 'UNAVAILABLE'

  const council =
    internet === 'OFFLINE' && ollama === 'AVAILABLE'
      ? 'DEGRADED_LOCAL'
      : ollama === 'AVAILABLE' || external === 'PARTIAL'
        ? 'PARTIAL'
        : 'UNAVAILABLE'

  return {
    WAR_ROOM_CORE: !coreOnline ? 'FAILED' : input.coreDegraded ? 'DEGRADED' : 'ONLINE',
    INTERNET: internet,
    LOCAL_MODELS: ollama,
    LOCAL_CORPUS: 'AVAILABLE',
    LOCAL_SEARCH_INDEX:
      input.localSearchIndexPresent === true
        ? 'AVAILABLE'
        : input.localSearchIndexPresent === false
          ? 'UNAVAILABLE'
          : 'AVAILABLE',
    COUNCIL: council,
    TERRA_LIVE_PROVIDERS: internet === 'OFFLINE' ? 'UNAVAILABLE' : 'PARTIAL',
    TERRA_LOCAL_OR_CACHED: 'PARTIAL',
    EXTERNAL_AI: external,
    CLOUDFLARE_TUNNEL:
      input.cloudflareReachable === false
        ? 'UNAVAILABLE'
        : 'OPTIONAL_REMOTE',
    PUBLIC_WEBSITE:
      input.publicWebsiteReachable === false
        ? 'UNAVAILABLE'
        : 'OPTIONAL_REMOTE',
  }
}

export function buildIdentity(partial?: Partial<BuildIdentity>): BuildIdentity {
  return {
    desktop_version: partial?.desktop_version ?? DESKTOP_APP_VERSION,
    core_version: partial?.core_version ?? SOVEREIGN_RUNTIME_VERSION,
    web_release_version: partial?.web_release_version ?? null,
    git_sha: partial?.git_sha ?? null,
    dirty: partial?.dirty ?? null,
    built_at: partial?.built_at ?? new Date().toISOString(),
    runtime_version: SOVEREIGN_RUNTIME_VERSION,
  }
}

export function localCoreEndpoint(): { host: typeof LOCAL_CORE_HOST; port: typeof LOCAL_CORE_PORT; origin: string } {
  return {
    host: LOCAL_CORE_HOST,
    port: LOCAL_CORE_PORT,
    origin: `http://${LOCAL_CORE_HOST}:${LOCAL_CORE_PORT}`,
  }
}

export function localUiEndpoint(): { host: typeof LOCAL_CORE_HOST; port: typeof LOCAL_UI_PORT; origin: string } {
  return {
    host: LOCAL_CORE_HOST,
    port: LOCAL_UI_PORT,
    origin: `http://${LOCAL_CORE_HOST}:${LOCAL_UI_PORT}`,
  }
}
