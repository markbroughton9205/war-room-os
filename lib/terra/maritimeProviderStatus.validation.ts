import { pathToFileURL } from 'node:url'
import { getMaritimeSourceRecord, type MaritimeSourceRecord } from './maritimeSourceRegistry'
import {
  aggregateVesselLayerFreshness,
  maritimeProviderLiveStatus,
  resolveDigitrafficCameraFreshness,
  resolveMaritimeProviderFreshness,
} from './maritimeProviderStatus'
import type { TerraLiveProviderStatus } from './liveGeoIntelligence'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check(
    'digitraffic_no_coverage_is_not_outage',
    resolveDigitrafficCameraFreshness({
      layerEnabled: true,
      coverageState: 'NO_COVERAGE',
      feedState: 'empty',
      fromCache: false,
      boundingBoxQuery: null,
    }) === 'NO_COVERAGE',
    'NO_COVERAGE',
  ))
  results.push(check(
    'digitraffic_empty_is_not_unavailable',
    resolveDigitrafficCameraFreshness({
      layerEnabled: true,
      coverageState: 'NO_VESSELS_OBSERVED',
      feedState: 'empty',
      fromCache: false,
      boundingBoxQuery: '59.0,24.0,60.5,26.0',
    }) === 'EMPTY',
    'EMPTY',
  ))
  results.push(check(
    'digitraffic_error_is_unavailable',
    resolveDigitrafficCameraFreshness({
      layerEnabled: true,
      coverageState: 'SOURCE_OFFLINE',
      feedState: 'error',
      fromCache: false,
      boundingBoxQuery: '59.0,24.0,60.5,26.0',
    }) === 'UNAVAILABLE',
    'UNAVAILABLE',
  ))
  results.push(check(
    'digitraffic_live_when_feed_live',
    resolveDigitrafficCameraFreshness({
      layerEnabled: true,
      coverageState: 'LIVE_DATA_PRESENT',
      feedState: 'live',
      fromCache: false,
      boundingBoxQuery: '59.0,24.0,60.5,26.0',
    }) === 'LIVE',
    'LIVE',
  ))
  const digitraffic = maritimeProviderLiveStatus(getMaritimeSourceRecord('digitraffic_marine')!, { fetchFreshness: 'LIVE', objectCount: 12 })
  const barents = maritimeProviderLiveStatus(getMaritimeSourceRecord('barentswatch_ais')!)
  const aisstream = maritimeProviderLiveStatus(getMaritimeSourceRecord('aisstream')!)
  const catcher = maritimeProviderLiveStatus(getMaritimeSourceRecord('ais_catcher_own_sensor')!)
  const noaa = maritimeProviderLiveStatus(getMaritimeSourceRecord('noaa_access_ais')!)
  const commercial = maritimeProviderLiveStatus(getMaritimeSourceRecord('commercial_satellite_ais')!)
  const providers: TerraLiveProviderStatus[] = [digitraffic, barents, aisstream]
  results.push(check(
    'layer_live_when_one_provider_live',
    aggregateVesselLayerFreshness(providers) === 'LIVE',
    aggregateVesselLayerFreshness(providers),
  ))
  results.push(check(
    'missing_credential_is_needs_credentials',
    barents.freshness === 'NEEDS_CREDENTIALS' && aisstream.freshness === 'NEEDS_CREDENTIALS',
    `${barents.freshness}/${aisstream.freshness}`,
  ))
  results.push(check(
    'local_ais_without_receiver_is_needs_local_sensor',
    catcher.freshness === 'NEEDS_LOCAL_SENSOR',
    catcher.freshness,
  ))
  results.push(check(
    'noaa_historical_never_live',
    noaa.freshness === 'HISTORICAL',
    noaa.freshness,
  ))
  results.push(check(
    'commercial_placeholder_is_not_live',
    commercial.freshness === 'NEEDS_COMMERCIAL_ACCOUNT',
    commercial.freshness,
  ))
  const missingAdapter: MaritimeSourceRecord = {
    id: 'synthetic_missing_adapter',
    displayName: 'Synthetic missing adapter',
    sourceClass: 'C4',
    researchProviderId: null,
    protocol: 'REST',
    coverageDescription: 'test',
    coverageBoundingBox: null,
    expectedLatency: 'n/a',
    authenticationRequired: false,
    rightsState: 'test',
    commercialState: 'none',
    configurationState: 'NOT_CONFIGURED',
    evidenceStatus: 'research_corpus_unverified',
    evidenceNote: 'synthetic',
  }
  results.push(check(
    'registered_missing_adapter_is_not_implemented',
    resolveMaritimeProviderFreshness(missingAdapter) === 'NOT_IMPLEMENTED',
    resolveMaritimeProviderFreshness(missingAdapter),
  ))
  results.push(check(
    'reason_contains_env_names_not_values',
    /AISSTREAM_API_KEY/.test(aisstream.reason) && !/sk-|xai-|Bearer /.test(aisstream.reason),
    aisstream.reason,
  ))
  const authFailed = maritimeProviderLiveStatus(getMaritimeSourceRecord('barentswatch_ais')!, {
    credentialsPresent: true,
    fetchFreshness: 'AUTH_FAILED',
    objectCount: 0,
  })
  results.push(check(
    'auth_failed_is_not_live_and_hides_values',
    authFailed.freshness === 'AUTH_FAILED'
      && /AUTH FAILED/.test(authFailed.reason)
      && !/sk-|xai-|Bearer |client_secret/i.test(authFailed.reason),
    authFailed.freshness,
  ))
  return results
}

export function runMaritimeProviderStatusValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runMaritimeProviderStatusValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`Terra maritime provider status: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
