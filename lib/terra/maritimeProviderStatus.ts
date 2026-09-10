/**
 * Unified Terra maritime provider status — camera coverage, missing credentials, historical
 * archives, and real fetch failures stay distinct. NOT_CONFIGURED is never used as a catch-all.
 *
 * Client-safe: env *names* only, never values. Does not import the Research Engine.
 */
import type { TerraLiveFreshness, TerraLiveLayerStatus, TerraLiveProviderStatus } from './liveGeoIntelligence'
import { MARITIME_SOURCE_REGISTRY, type MaritimeSourceRecord } from './maritimeSourceRegistry'
import type { TerraMaritimeCoverageState } from './maritimeCoverage'

export const TERRA_PROVIDER_STATUS_LABELS: Record<TerraLiveFreshness, string> = {
  LIVE: 'LIVE',
  DELAYED: 'DELAYED',
  CACHED: 'CACHED',
  STALE: 'STALE',
  EMPTY: 'EMPTY',
  NO_COVERAGE: 'NO COVERAGE',
  READY: 'READY',
  NEEDS_CREDENTIALS: 'NEEDS CREDENTIALS',
  NEEDS_LOCAL_SENSOR: 'NO LOCAL SENSOR',
  NEEDS_COMMERCIAL_ACCOUNT: 'NEEDS COMMERCIAL ACCOUNT',
  HISTORICAL: 'HISTORICAL',
  NOT_IMPLEMENTED: 'NOT IMPLEMENTED',
  DISABLED: 'DISABLED',
  UNAVAILABLE: 'UNAVAILABLE',
  NOT_CONFIGURED: 'NOT CONFIGURED',
}

const CREDENTIAL_ENV_NAMES: Record<string, string[]> = {
  barentswatch_ais: ['BARENTSWATCH_CLIENT_ID', 'BARENTSWATCH_CLIENT_SECRET'],
  aisstream: ['AISSTREAM_API_KEY'],
  aishub_marine: ['AISHUB_USERNAME'],
}

const USABLE_LAYER_STATES = new Set<TerraLiveFreshness>(['LIVE', 'CACHED', 'DELAYED'])

export type MaritimeRuntimeHint = {
  objectCount?: number
  fetchFreshness?: TerraLiveFreshness
  credentialsPresent?: boolean
  sensorPresent?: boolean
}

export function resolveDigitrafficCameraFreshness(input: {
  layerEnabled: boolean
  coverageState: TerraMaritimeCoverageState
  feedState: 'loading' | 'live' | 'empty' | 'error' | 'stale'
  fromCache: boolean
  boundingBoxQuery: string | null
}): TerraLiveFreshness {
  if (!input.layerEnabled) return 'READY'
  if (input.coverageState === 'NO_COVERAGE' || input.boundingBoxQuery === null) return 'NO_COVERAGE'
  if (input.coverageState === 'PENDING' || input.feedState === 'loading') return 'READY'
  if (input.coverageState === 'DELAYED_DATA' || input.feedState === 'stale') return 'DELAYED'
  if (input.coverageState === 'SOURCE_OFFLINE' || input.coverageState === 'RATE_LIMITED' || input.feedState === 'error') {
    return 'UNAVAILABLE'
  }
  if (input.coverageState === 'NO_VESSELS_OBSERVED' || input.feedState === 'empty') return 'EMPTY'
  if (input.coverageState === 'LIVE_DATA_PRESENT' || input.feedState === 'live') return input.fromCache ? 'CACHED' : 'LIVE'
  return 'NO_COVERAGE'
}

export function resolveMaritimeProviderFreshness(
  record: MaritimeSourceRecord,
  runtime?: MaritimeRuntimeHint,
): TerraLiveFreshness {
  if (runtime?.fetchFreshness) return runtime.fetchFreshness
  if (record.configurationState === 'COMMERCIAL_REVIEW' || (record.commercialState === 'required_paid' && !record.researchProviderId)) {
    return 'NEEDS_COMMERCIAL_ACCOUNT'
  }
  if (record.configurationState === 'HARDWARE_REQUIRED') {
    return runtime?.sensorPresent ? 'LIVE' : 'NEEDS_LOCAL_SENSOR'
  }
  if (record.configurationState === 'HISTORICAL_ONLY') return 'HISTORICAL'
  if (
    record.configurationState === 'CREDENTIAL_REQUIRED'
    || record.configurationState === 'ACCOUNT_REQUIRED'
    || record.configurationState === 'EARNED_BY_FEEDING'
  ) {
    if (runtime?.credentialsPresent) return 'READY'
    return 'NEEDS_CREDENTIALS'
  }
  if (record.configurationState === 'TERMS_DEPENDENT') return 'DISABLED'
  if (record.configurationState === 'ENABLED') return 'READY'
  if (!record.researchProviderId) return 'NOT_IMPLEMENTED'
  return 'NOT_IMPLEMENTED'
}

export function maritimeProviderReason(record: MaritimeSourceRecord, freshness: TerraLiveFreshness): string {
  const envNames = CREDENTIAL_ENV_NAMES[record.id]
  switch (freshness) {
    case 'LIVE':
      return 'Live provider response with usable current vessel observations.'
    case 'CACHED':
      return 'Serving a still-valid cached provider response.'
    case 'DELAYED':
      return 'Prior data retained after a failed or throttled refresh.'
    case 'STALE':
      return 'Source timestamps are older than the live threshold.'
    case 'EMPTY':
      return 'Provider request succeeded; zero vessels in the requested area.'
    case 'NO_COVERAGE':
      return 'Adapter is healthy; the current view is outside this provider\'s coverage envelope.'
    case 'READY':
      return 'Adapter is implemented and can run with current configuration.'
    case 'NEEDS_CREDENTIALS':
      return envNames?.length
        ? `Adapter installed; required credential not configured (${envNames.join(', ')}).`
        : 'Adapter installed; API credential not configured.'
    case 'NEEDS_LOCAL_SENSOR':
      return 'Own-sensor adapter installed; no local AIS-catcher/SDR receiver is feeding War Room.'
    case 'NEEDS_COMMERCIAL_ACCOUNT':
      return 'Placeholder for a paid satellite-AIS contract. No account or license is configured; no purchase is implied.'
    case 'HISTORICAL':
      return 'Historical/batch AIS archive only — not a realtime vessel feed.'
    case 'NOT_IMPLEMENTED':
      return 'Provider is registered but no live adapter exists yet.'
    case 'DISABLED':
      return 'Intentionally disabled by operator or access terms.'
    case 'UNAVAILABLE':
      return 'Implemented provider failed at runtime.'
    case 'NOT_CONFIGURED':
      return 'Provider is registered but is not configured for live use.'
  }
}

export function maritimeProviderLiveStatus(
  record: MaritimeSourceRecord,
  runtime?: MaritimeRuntimeHint,
): TerraLiveProviderStatus {
  const freshness = resolveMaritimeProviderFreshness(record, runtime)
  const implemented = Boolean(record.researchProviderId) && record.configurationState !== 'COMMERCIAL_REVIEW'
  return {
    id: record.id,
    displayName: record.displayName,
    layer: 'vessels',
    implemented,
    configurationState: record.configurationState,
    freshness,
    reason: maritimeProviderReason(record, freshness),
    objectCount: runtime?.objectCount ?? 0,
  }
}

export function listMaritimeLiveProviderStatuses(
  runtimeById?: Record<string, MaritimeRuntimeHint>,
): TerraLiveProviderStatus[] {
  return MARITIME_SOURCE_REGISTRY.map(record => maritimeProviderLiveStatus(record, runtimeById?.[record.id]))
}

export function aggregateVesselLayerFreshness(
  providers: TerraLiveProviderStatus[],
  layerEnabled = true,
): TerraLiveFreshness {
  if (!layerEnabled) return 'DISABLED'
  const maritime = providers.filter(provider => provider.layer === 'vessels')
  if (maritime.some(provider => provider.freshness === 'LIVE' && provider.objectCount > 0)) return 'LIVE'
  if (maritime.some(provider => provider.freshness === 'CACHED' && provider.objectCount > 0)) return 'CACHED'
  if (maritime.some(provider => provider.freshness === 'DELAYED' && provider.objectCount > 0)) return 'DELAYED'
  if (maritime.some(provider => provider.freshness === 'LIVE' || provider.freshness === 'CACHED')) return 'LIVE'
  if (maritime.some(provider => provider.freshness === 'EMPTY')) return 'EMPTY'
  if (maritime.some(provider => provider.freshness === 'UNAVAILABLE') && !maritime.some(provider => USABLE_LAYER_STATES.has(provider.freshness) || provider.freshness === 'EMPTY' || provider.freshness === 'NO_COVERAGE' || provider.freshness === 'READY')) {
    return 'UNAVAILABLE'
  }
  if (maritime.some(provider => provider.freshness === 'NO_COVERAGE' || provider.freshness === 'READY')) return 'NO_COVERAGE'
  if (maritime.every(provider => provider.freshness === 'HISTORICAL')) return 'HISTORICAL'
  if (maritime.some(provider => provider.freshness === 'NEEDS_LOCAL_SENSOR') && maritime.every(provider => (
    provider.freshness === 'NEEDS_LOCAL_SENSOR'
    || provider.freshness === 'NEEDS_CREDENTIALS'
    || provider.freshness === 'NEEDS_COMMERCIAL_ACCOUNT'
    || provider.freshness === 'HISTORICAL'
    || provider.freshness === 'NOT_IMPLEMENTED'
    || provider.freshness === 'DISABLED'
  ))) {
    return 'NEEDS_LOCAL_SENSOR'
  }
  if (maritime.some(provider => provider.freshness === 'NEEDS_CREDENTIALS')) return 'NEEDS_CREDENTIALS'
  if (maritime.some(provider => provider.freshness === 'UNAVAILABLE')) return 'UNAVAILABLE'
  return 'NO_COVERAGE'
}

export function layerStatusFromProviders(
  providers: TerraLiveProviderStatus[],
  objectCount: number,
  layerEnabled = true,
): Pick<TerraLiveLayerStatus, 'freshness' | 'reason'> {
  const freshness = aggregateVesselLayerFreshness(providers, layerEnabled)
  return { freshness, reason: layerReason(freshness, objectCount) }
}

export function layerReason(freshness: TerraLiveFreshness, count: number): string {
  if (freshness === 'DISABLED') return 'Vessels layer is toggled off by the operator.'
  if (freshness === 'NEEDS_CREDENTIALS') return 'Covering adapters need credentials before they can serve this view.'
  if (freshness === 'NEEDS_LOCAL_SENSOR') return 'No local AIS receiver is feeding War Room.'
  if (freshness === 'NEEDS_COMMERCIAL_ACCOUNT') return 'No commercial satellite-AIS account is configured.'
  if (freshness === 'NOT_IMPLEMENTED') return 'No implemented adapter can serve the vessels layer.'
  if (freshness === 'NOT_CONFIGURED') return 'Provider registered but not implemented or not configured for live use.'
  if (freshness === 'UNAVAILABLE') return 'Every attempted live vessel provider failed at runtime.'
  if (freshness === 'NO_COVERAGE') return 'No live AIS coverage for the current camera view.'
  if (freshness === 'EMPTY') return 'Live fetch succeeded with no vessels in view.'
  if (freshness === 'STALE') return 'Source timestamps are older than the live threshold.'
  if (freshness === 'HISTORICAL') return 'Only historical/batch AIS archives are registered for this layer.'
  if (freshness === 'DELAYED') return 'Prior data retained after a failed refresh.'
  if (freshness === 'CACHED') return 'Serving a still-valid cached provider response.'
  if (freshness === 'READY') return 'Vessel adapters are ready; no in-view fetch has run yet.'
  return count === 0 ? 'Live fetch succeeded with no projectable objects' : 'Live provider data'
}
