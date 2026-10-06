/**
 * Coverage-bounded precision enrichment.
 * County plugin → statewide → keep global geocoder class if enrichment fails.
 * Never runs worldwide. Never averages coordinates.
 */

import { shouldAttemptAddressEnrichment, type ParsedPlaceQuery } from './parsePlaceQuery'
import { precisionImproves, type TerraEnrichmentState, type TerraPlaceMatchClass, type TerraProviderHealth } from './matchClass'
import { eligiblePrecisionProviders } from './providers/registry'
import type { PrecisionHit } from './providers/types'
import { selectPrimaryGeometry, type SelectableGeometry } from './selectPrimaryGeometry'

export type GlobalSeed = {
  longitude: number
  latitude: number
  matchClass: TerraPlaceMatchClass
  label: string
  houseNumber?: string | null
  road?: string | null
  city?: string | null
  state?: string | null
  postcode?: string | null
  provider: string
}

export type EnrichmentOutcome = {
  enrichmentState: TerraEnrichmentState
  health: TerraProviderHealth | 'SKIPPED'
  selected: SelectableGeometry | null
  candidates: SelectableGeometry[]
  reason: string | null
  providerIdsAttempted: string[]
}

function asGeometry(hit: PrecisionHit): SelectableGeometry {
  return {
    id: `${hit.providerId}:${hit.longitude}:${hit.latitude}`,
    longitude: hit.longitude,
    latitude: hit.latitude,
    matchClass: hit.matchClass,
    houseNumber: hit.houseNumber,
    road: [hit.streetName, hit.streetTypeAbbrev].filter(Boolean).join(' '),
    streetName: hit.streetName,
    streetTypeAbbrev: hit.streetTypeAbbrev,
    preDirectional: hit.preDirectional,
    postDirectional: hit.postDirectional,
    city: hit.city,
    state: hit.state,
    postcode: hit.postcode,
    provider: hit.providerId,
    label: hit.label,
    hit,
  }
}

export async function enrichResolvedPlace(input: {
  parsed: ParsedPlaceQuery
  seed: GlobalSeed | null
  signal?: AbortSignal
}): Promise<EnrichmentOutcome> {
  if (!shouldAttemptAddressEnrichment(input.parsed)) {
    return { enrichmentState: 'skipped', health: 'SKIPPED', selected: null, candidates: [], reason: null, providerIdsAttempted: [] }
  }
  const providers = eligiblePrecisionProviders().filter(provider => provider.supports({
    parsed: input.parsed,
    hint: input.seed ? { longitude: input.seed.longitude, latitude: input.seed.latitude } : null,
  }))
  if (providers.length === 0) {
    return { enrichmentState: 'no_coverage', health: 'NO_COVERAGE', selected: null, candidates: [], reason: 'No regional precision plugin covers this place.', providerIdsAttempted: [] }
  }

  const candidates: SelectableGeometry[] = []
  const attempted: string[] = []
  let lastHealth: TerraProviderHealth = 'NO_DATA'
  let lastReason = 'Precision enrichment returned no data.'

  for (const provider of providers) {
    attempted.push(provider.id)
    const result = await provider.lookupAddressPoints({
      parsed: input.parsed,
      hint: input.seed ? { longitude: input.seed.longitude, latitude: input.seed.latitude } : null,
      signal: input.signal,
    })
    lastHealth = result.health
    if (result.health !== 'AVAILABLE') {
      lastReason = 'reason' in result ? result.reason : lastReason
      continue
    }
    candidates.push(...result.hits.map(asGeometry))
    if (candidates.length > 0) break
  }

  if (candidates.length === 0) {
    const unavailable = lastHealth === 'UNAVAILABLE' || lastHealth === 'RATE_LIMITED' || lastHealth === 'AUTH_REQUIRED'
    return {
      enrichmentState: unavailable ? 'unavailable' : 'unavailable',
      health: lastHealth,
      selected: null,
      candidates: [],
      reason: lastReason,
      providerIdsAttempted: attempted,
    }
  }

  const selected = selectPrimaryGeometry(input.parsed, candidates)
  if (selected.status !== 'selected') {
    return {
      enrichmentState: 'unavailable',
      health: 'AVAILABLE',
      selected: null,
      candidates: selected.status === 'ambiguous' ? selected.geometries : candidates,
      reason: selected.status === 'ambiguous' ? selected.reason : selected.reason,
      providerIdsAttempted: attempted,
    }
  }

  let geometry = selected.geometry
  const hit = geometry.hit
  const provider = providers.find(row => row.id === geometry.provider)
  if (hit && provider?.lookupBuildings) {
    const buildings = await provider.lookupBuildings({
      parsed: input.parsed,
      around: { longitude: geometry.longitude, latitude: geometry.latitude },
      hint: { longitude: geometry.longitude, latitude: geometry.latitude },
      signal: input.signal,
    })
    if (buildings.health === 'AVAILABLE' && buildings.hits.length === 1) {
      geometry = asGeometry(buildings.hits[0])
    }
  } else if (hit && provider?.lookupParcels) {
    const parcels = await provider.lookupParcels({
      parsed: input.parsed,
      around: { longitude: geometry.longitude, latitude: geometry.latitude },
      hint: { longitude: geometry.longitude, latitude: geometry.latitude },
      signal: input.signal,
    })
    if (parcels.health === 'AVAILABLE' && parcels.hits.length === 1 && precisionImproves(geometry.matchClass, 'PARCEL')) {
      geometry = asGeometry(parcels.hits[0])
    }
  }

  if (input.seed && !precisionImproves(input.seed.matchClass, geometry.matchClass) && geometry.matchClass !== input.seed.matchClass) {
    if (matchClassNotWorse(input.seed.matchClass, geometry.matchClass)) {
      return { enrichmentState: 'refined', health: 'AVAILABLE', selected: geometry, candidates, reason: null, providerIdsAttempted: attempted }
    }
  }

  return {
    enrichmentState: 'refined',
    health: 'AVAILABLE',
    selected: geometry,
    candidates,
    reason: null,
    providerIdsAttempted: attempted,
  }
}

function matchClassNotWorse(current: TerraPlaceMatchClass, next: TerraPlaceMatchClass): boolean {
  return next === current || precisionImproves(current, next)
}
