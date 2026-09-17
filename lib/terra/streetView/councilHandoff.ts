import { TERRA_HANDOFF_ACTION, type TerraCouncilHandoffPayload } from '@/lib/terra/councilHandoff'
import type { StreetViewItem, StreetViewLookupResult, StreetViewOrigin } from './types'

export function streetViewObservedFacts(input: {
  origin: StreetViewOrigin
  result: StreetViewLookupResult
  item: StreetViewItem | null
}): string {
  const { origin, result, item } = input
  return [
    'LAYER: Observed Data',
    'CONTEXT: Terra STREET VIEW (not Area Live camera evidence)',
    `ORIGIN CONTEXT: ${origin.context}`,
    `ORIGIN LABEL: ${origin.label}`,
    `QUERY COORDINATES: ${origin.latitude.toFixed(5)}, ${origin.longitude.toFixed(5)}`,
    `NOMINATIM USED: ${String(result.nominatimUsed)}`,
    `STATE: ${result.state}`,
    `PROVIDER: ${item?.provider ?? 'none'}`,
    `IMAGE ID: ${item?.id ?? 'none'}`,
    `SEQUENCE ID: ${item?.sequenceId ?? 'none'}`,
    `CAPTURE COORDINATES: ${item ? `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}` : 'none'}`,
    `HEADING: ${item?.headingDeg != null ? `${Math.round(item.headingDeg)} deg` : 'not reported'}`,
    `CAPTURE TIME: ${item?.capturedAt ?? 'UNKNOWN'}`,
    `DISTANCE FROM QUERY: ${item ? `${Math.round(item.distanceMeters)} m` : 'none'}`,
    `SOURCE: ${item?.sourceUrl ?? item?.viewerUrl ?? 'none'}`,
    `IMAGE URL: ${item?.imageUrl ?? 'none'}`,
    `LICENSE: ${item?.license ?? 'none'}`,
    `ATTRIBUTION: ${item?.attribution ?? 'none'}`,
    `AUTH MODEL: ${item?.authModel ?? 'none'}`,
    'GOOGLE STREET VIEW: not used',
    'FABRICATED PANORAMA: no',
    'COUNCIL ANALYSIS: not included — Observed Data only',
  ].join('\n')
}

export function buildStreetViewCouncilHandoff(input: {
  origin: StreetViewOrigin
  result: StreetViewLookupResult
  item: StreetViewItem | null
  commanderPrompt?: string
}): TerraCouncilHandoffPayload | null {
  const item = input.item
  const origin = input.origin
  const handedOffAt = new Date().toISOString()
  return {
    action: TERRA_HANDOFF_ACTION,
    commanderPrompt: input.commanderPrompt?.trim()
      || 'Preserve this Terra STREET VIEW lookup as Observed Data only. Do not invent a panorama, Google Street View frame, or unobserved coverage.',
    lineage: {
      objectId: item?.id ?? `street-view:${origin.latitude.toFixed(5)},${origin.longitude.toFixed(5)}`,
      layer: 'other',
      type: 'street_image',
      title: item ? `${item.provider} street image` : `Street View ${input.result.state}`,
      provider: item?.provider ?? 'none',
      evidenceId: item?.id ?? null,
      sourceUrl: item?.sourceUrl ?? item?.viewerUrl ?? null,
      latitude: item?.latitude ?? origin.latitude,
      longitude: item?.longitude ?? origin.longitude,
      coordinateOrigin: 'observed',
      freshness: input.result.state === 'AVAILABLE'
        ? 'HISTORICAL'
        : input.result.state === 'AUTH_REQUIRED' || input.result.state === 'PROVIDER_AUTH_REQUIRED'
          ? 'AUTH_REQUIRED'
          : input.result.state === 'ERROR_UPSTREAM' || input.result.state === 'UNAVAILABLE'
            ? 'UNAVAILABLE'
            : 'NO_COVERAGE',
      observedAt: item?.capturedAt ?? null,
      receivedAt: handedOffAt,
      handedOffAt,
      sourceFamily: 'street_image',
      country: null,
      region: null,
      jurisdiction: null,
      commanderAction: TERRA_HANDOFF_ACTION,
    },
    observedFacts: streetViewObservedFacts(input),
  }
}
