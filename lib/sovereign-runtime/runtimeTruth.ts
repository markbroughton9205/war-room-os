/**
 * #22 Phase 10 — Runtime truth + offline capability reporting.
 */
import {
  DESKTOP_APP_VERSION,
  LOCAL_CORE_HOST,
  LOCAL_CORE_PORT,
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
    DESKTOP_APP: 'IMPLEMENTED_FOUNDATION',
    WEBSITE_REQUIRED: false,
    PUBLIC_DOMAIN_REQUIRED_FOR_LOCAL_USE: false,
    CLOUDFLARE_REQUIRED_FOR_LOCAL_USE: false,
    INTERNET_REQUIRED_FOR_LOCAL_CORE: false,
    EXTERNAL_AI_REQUIRED_FOR_CORE: false,
    PHONE_APP: 'NOT_IMPLEMENTED',
    NATIVE_WRIM: 'NOT_IMPLEMENTED',
    FUTURE_NAVIGATION_AGENT: TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_NAVIGATION_AGENT')
      ? 'TARGET_UNIMPLEMENTED'
      : 'UNEXPECTED',
    ASCENSION_AUTONOMY: ascensionAutonomyIsOff() ? 'OFF' : 'ON',
    ROADMAP_22: 'ACTIVE',
    ROADMAP_23: 'NOT_STARTED',
    OPERATIONAL_ASCENSION_AGENTS: operationalAscensionAgentCount(),
    GATE16_PREBUILD: 'REQUIRES_PRE_22_CLOSEOUT_REPAIR',
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

  return {
    WAR_ROOM_CORE: !coreOnline ? 'FAILED' : input.coreDegraded ? 'DEGRADED' : 'ONLINE',
    INTERNET: internet,
    LOCAL_MODELS: ollama,
    LOCAL_CORPUS: 'PARTIAL',
    LOCAL_SEARCH_INDEX:
      input.localSearchIndexPresent === true
        ? 'AVAILABLE'
        : input.localSearchIndexPresent === false
          ? 'UNAVAILABLE'
          : 'PARTIAL',
    COUNCIL: ollama === 'AVAILABLE' || external === 'PARTIAL' ? 'PARTIAL' : 'UNAVAILABLE',
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
