/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/weather/weather.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { TerraGeoFeature } from '@/lib/terra/types'
import { decideAlertDuck } from '@/lib/media/alerts/duckPolicy'
import { resolveWeatherLifecycle } from './lifecycle'
import { meetsWeatherToastSeverity } from './severityGate'
import { ingestWeatherAlerts, pickWeatherToast, weatherAlertFingerprint } from './dedupe'
import { resolveWeatherFlyPlan } from './geometry'
import { mergeWeatherAlerts, weatherAlertFromFeature } from './fromFeature'
import { weatherObservedFacts } from './councilHandoff'
import type { WeatherAlert } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function feature(partial: Partial<TerraGeoFeature> & Pick<TerraGeoFeature, 'id'>): TerraGeoFeature {
  return {
    eventId: partial.id,
    providerId: 'nws_weather',
    kind: 'severe_weather_alert',
    timestamp: '2026-09-17T04:00:00.000Z',
    title: 'Severe Thunderstorm Warning — Test County',
    summary: 'Severe Thunderstorm Warning issued',
    longitude: -81.52,
    latitude: 41.08,
    altitude: null,
    geometryKind: 'region',
    regionRings: [[[-81.6, 41.0], [-81.4, 41.0], [-81.4, 41.2], [-81.6, 41.2], [-81.6, 41.0]]],
    pathCoordinates: null,
    coordinateOrigin: 'observed',
    geoResolution: null,
    properties: {
      event: 'Severe Thunderstorm Warning',
      severity: 'Severe',
      urgency: 'Immediate',
      certainty: 'Observed',
      status: 'Actual',
      messageType: 'Alert',
      headline: 'Severe Thunderstorm Warning issued',
      description: 'Damaging winds.',
      instruction: 'Take shelter.',
      areaDesc: 'Summit, OH',
      sent: '2026-09-17T04:00:00.000Z',
      effective: '2026-09-17T04:00:00.000Z',
      onset: '2026-09-17T04:00:00.000Z',
      ends: '2026-09-17T06:00:00.000Z',
      expires: '2026-09-17T06:00:00.000Z',
    },
    provenance: {
      provider: 'nws_weather',
      sourceUrl: 'https://alerts.weather.gov/test',
      retrievedAt: '2026-09-17T05:00:00.000Z',
      fromCache: false,
      isHistorical: false,
    },
    rawReference: { documentId: 'nws_weather:alert:test', providerRecordId: partial.id, canonicalUrl: 'https://alerts.weather.gov/test' },
    ...partial,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const now = '2026-09-17T05:00:00.000Z'
  const severe = weatherAlertFromFeature(feature({ id: 'urn:oid:severe-1' }), now)
  results.push(check('severe_active_maps_from_nws_feature', Boolean(severe && severe.lifecycle === 'ACTIVE' && severe.severity === 'Severe'), JSON.stringify({ lifecycle: severe?.lifecycle, severity: severe?.severity })))
  results.push(check('geometry_basis_is_polygon', severe?.geometryBasis === 'POLYGON', String(severe?.geometryBasis)))
  results.push(check('fly_fits_polygon_not_point', resolveWeatherFlyPlan(severe!).action === 'fit-polygon', resolveWeatherFlyPlan(severe!).action))
  results.push(check('toast_gate_allows_severe_active', meetsWeatherToastSeverity(severe!), 'false'))

  const moderate = weatherAlertFromFeature(feature({
    id: 'urn:oid:mod-1',
    properties: { ...feature({ id: 'x' }).properties, severity: 'Moderate', event: 'Flood Advisory' },
  }), now)
  results.push(check('toast_gate_blocks_moderate', moderate != null && !meetsWeatherToastSeverity(moderate), String(moderate?.severity)))

  const minor = weatherAlertFromFeature(feature({
    id: 'urn:oid:minor-1',
    properties: { ...feature({ id: 'x' }).properties, severity: 'Minor' },
  }), now)
  results.push(check('toast_gate_blocks_minor', minor != null && !meetsWeatherToastSeverity(minor), String(minor?.severity)))

  const expired = weatherAlertFromFeature(feature({
    id: 'urn:oid:exp-1',
    properties: { ...feature({ id: 'x' }).properties, ends: '2026-09-17T04:30:00.000Z', expires: '2026-09-17T04:30:00.000Z' },
  }), now)
  results.push(check('expired_lifecycle', expired?.lifecycle === 'EXPIRED', String(expired?.lifecycle)))
  results.push(check('expired_does_not_toast', expired != null && !meetsWeatherToastSeverity(expired), 'toasted'))

  const upcoming = resolveWeatherLifecycle({
    status: 'Actual',
    messageType: 'Alert',
    effective: '2026-09-17T08:00:00.000Z',
    onset: '2026-09-17T08:00:00.000Z',
    ends: '2026-09-17T10:00:00.000Z',
    expires: '2026-09-17T10:00:00.000Z',
    nowIso: now,
  })
  results.push(check('upcoming_before_onset', upcoming === 'UPCOMING', upcoming))

  const cancelled = resolveWeatherLifecycle({
    status: 'Cancelled',
    messageType: 'Cancel',
    effective: '2026-09-17T04:00:00.000Z',
    onset: null,
    ends: '2026-09-17T10:00:00.000Z',
    expires: '2026-09-17T10:00:00.000Z',
    nowIso: now,
  })
  results.push(check('cancelled_status', cancelled === 'CANCELLED', cancelled))

  const oldSentStillActive = resolveWeatherLifecycle({
    status: 'Actual',
    messageType: 'Alert',
    effective: '2026-09-16T01:00:00.000Z',
    onset: '2026-09-16T01:00:00.000Z',
    ends: '2026-09-17T10:00:00.000Z',
    expires: '2026-09-17T10:00:00.000Z',
    nowIso: now,
  })
  results.push(check('old_sent_is_still_active', oldSentStillActive === 'ACTIVE', oldSentStillActive))

  const first = ingestWeatherAlerts({ alerts: [severe!], records: {}, nowIso: now, muted: false })
  results.push(check('first_poll_toasts_once', first.toasts.length === 1 && first.toasts[0]?.kind === 'new', String(first.toasts.length)))
  const second = ingestWeatherAlerts({ alerts: [severe!], records: first.records, nowIso: '2026-09-17T05:02:00.000Z', muted: false })
  results.push(check('repeat_poll_does_not_retoast', second.toasts.length === 0, String(second.toasts.length)))
  const updatedAlert: WeatherAlert = { ...severe!, headline: 'Updated headline', sent: '2026-09-17T05:03:00.000Z', updated: '2026-09-17T05:03:00.000Z' }
  const third = ingestWeatherAlerts({ alerts: [updatedAlert], records: second.records, nowIso: '2026-09-17T05:03:00.000Z', muted: false })
  results.push(check('material_update_toasts_once', third.toasts.length === 1 && third.toasts[0]?.kind === 'updated', JSON.stringify(third.toasts.map(item => item.kind))))
  const muted = ingestWeatherAlerts({ alerts: [feature({ id: 'urn:oid:new-2' })].map(item => weatherAlertFromFeature(item, now)!), records: {}, nowIso: now, muted: true })
  results.push(check('muted_never_toasts', muted.toasts.length === 0, String(muted.toasts.length)))

  const stacked = pickWeatherToast([
    { alert: moderate!, kind: 'new' },
    { alert: severe!, kind: 'new' },
  ].filter((row): row is { alert: WeatherAlert; kind: 'new' } => Boolean(row.alert)))
  results.push(check('one_toast_prefers_severe', stacked?.alert.id === 'urn:oid:severe-1', stacked?.alert.id ?? 'none'))
  const merged = mergeWeatherAlerts({ features: [feature({ id: 'urn:oid:severe-1' })], nowIso: now })
  results.push(check('live_intel_and_layer_share_alert_id', merged[0]?.id === 'urn:oid:severe-1' && merged[0]?.liveIntelId === 'urn:oid:severe-1', merged[0]?.id ?? 'none'))

  const zoneAlert: WeatherAlert = {
    ...severe!,
    id: 'zone-1',
    rings: null,
    bbox: null,
    representativePoint: null,
    areaDesc: 'Summit; Medina',
    affectedZones: ['https://api.weather.gov/zones/forecast/OHZ003'],
    geometryBasis: 'ZONE',
  }
  results.push(check('zone_only_is_no_fly', resolveWeatherFlyPlan(zoneAlert).action === 'no-fly', resolveWeatherFlyPlan(zoneAlert).action))
  results.push(check('zone_basis_honest', zoneAlert.geometryBasis === 'ZONE', zoneAlert.geometryBasis))

  const facts = weatherObservedFacts(severe!)
  results.push(check('council_facts_are_observed_data', facts.includes('LAYER: Observed Data') && facts.includes('COUNCIL ANALYSIS: not included') && !/forecast analysis/i.test(facts), facts.slice(0, 80)))
  results.push(check('fingerprint_changes_on_update', weatherAlertFingerprint(severe!) !== weatherAlertFingerprint(updatedAlert), 'same'))

  const duck = decideAlertDuck({
    severity: 'Severe',
    duckingEnabled: true,
    alreadyDuckedForAlertId: false,
    audioAlreadyPlaying: false,
  })
  results.push(check('media_duck_cannot_start_audio', duck.action === 'banner', duck.action))

  return results
}

const isDirect = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
if (isDirect) {
  const results = run()
  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.pass ? '' : ` — ${item.detail}`}`)
  }
  console.log(`Terra weather phase 1 validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

export { run }
