import { TERRA_HANDOFF_ACTION, type TerraCouncilHandoffPayload } from '@/lib/terra/councilHandoff'
import { NWS_ATTRIBUTION, type WeatherAlert } from './types'
import { resolveWeatherFlyPlan } from './geometry'

export function weatherObservedFacts(alert: WeatherAlert): string {
  const fly = resolveWeatherFlyPlan(alert)
  return [
    'LAYER: Observed Data',
    'CONTEXT: Terra WEATHER ALERT (NWS CAP — not Live Intel story verification)',
    `ALERT ID: ${alert.id}`,
    `EVENT: ${alert.event ?? 'UNKNOWN'}`,
    `SEVERITY: ${alert.severity ?? 'UNKNOWN'}`,
    `URGENCY: ${alert.urgency ?? 'UNKNOWN'}`,
    `CERTAINTY: ${alert.certainty ?? 'UNKNOWN'}`,
    `STATUS: ${alert.status ?? 'UNKNOWN'}`,
    `MESSAGE TYPE: ${alert.messageType ?? 'UNKNOWN'}`,
    `SENT: ${alert.sent ?? 'UNKNOWN'}`,
    `EFFECTIVE: ${alert.effective ?? 'UNKNOWN'}`,
    `ONSET: ${alert.onset ?? 'UNKNOWN'}`,
    `ENDS: ${alert.ends ?? 'UNKNOWN'}`,
    `EXPIRES: ${alert.expires ?? 'UNKNOWN'}`,
    `UPDATED: ${alert.updated ?? 'UNKNOWN'}`,
    `LIFECYCLE: ${alert.lifecycle}`,
    `AREA: ${alert.areaDesc ?? 'UNKNOWN'}`,
    `AFFECTED ZONES: ${alert.affectedZones.length ? alert.affectedZones.join(' | ') : 'UNKNOWN'}`,
    `GEOMETRY BASIS: ${alert.geometryBasis}`,
    `FLY ACTION: ${fly.action}`,
    `SOURCE URL: ${alert.sourceUrl ?? 'UNKNOWN'}`,
    `PROVIDER: ${alert.provider}`,
    `ATTRIBUTION: ${NWS_ATTRIBUTION}`,
    `RETRIEVED AT: ${alert.retrievedAt ?? 'UNKNOWN'}`,
    'COUNCIL ANALYSIS: not included — Observed Data only',
  ].join('\n')
}

export function buildWeatherCouncilHandoff(alert: WeatherAlert, commanderPrompt?: string): TerraCouncilHandoffPayload {
  const handedOffAt = new Date().toISOString()
  const freshness = alert.lifecycle === 'EXPIRED' || alert.lifecycle === 'CANCELLED'
    ? 'HISTORICAL'
    : alert.lifecycle === 'ACTIVE'
      ? 'LIVE'
      : alert.lifecycle === 'UPCOMING'
        ? 'READY'
        : 'UNAVAILABLE'
  return {
    action: TERRA_HANDOFF_ACTION,
    commanderPrompt: commanderPrompt?.trim()
      || 'Preserve this Terra NWS weather alert as Observed Data only. Do not invent storm footprints, radar, or analysis.',
    lineage: {
      objectId: alert.id,
      layer: 'intelligence_events',
      type: 'severe_weather_alert',
      title: alert.headline ?? alert.event ?? 'NWS weather alert',
      provider: alert.provider,
      evidenceId: alert.id,
      sourceUrl: alert.sourceUrl,
      latitude: alert.bbox ? (alert.bbox.south + alert.bbox.north) / 2 : null,
      longitude: alert.bbox ? (alert.bbox.west + alert.bbox.east) / 2 : null,
      coordinateOrigin: alert.geometryBasis === 'POLYGON' || alert.geometryBasis === 'BBOX' ? 'observed' : null,
      freshness,
      observedAt: alert.effective ?? alert.onset ?? alert.sent,
      receivedAt: alert.retrievedAt ?? handedOffAt,
      handedOffAt,
      sourceFamily: 'nws_cap',
      country: 'US',
      region: alert.areaDesc,
      jurisdiction: alert.areaDesc,
      commanderAction: TERRA_HANDOFF_ACTION,
    },
    observedFacts: weatherObservedFacts(alert),
  }
}
