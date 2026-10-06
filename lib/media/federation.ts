import { IHEART_CATALOG } from './iheart/catalog'
import { decorateStation, inferSourceFamily, stationIdentityKey } from './sourceFamily'
import { OHIO_MEDIA_STATIONS } from './stationRegistry'
import type { MediaSourceFamily, MediaStation } from './types'

export function getFederatedStations(): MediaStation[] {
  const merged: MediaStation[] = []
  const ids = new Set<string>()
  const keys = new Set<string>()
  for (const raw of [...OHIO_MEDIA_STATIONS, ...IHEART_CATALOG]) {
    const station = decorateStation(raw)
    if (ids.has(station.id)) continue
    const key = stationIdentityKey(station)
    if (keys.has(key)) continue
    ids.add(station.id)
    keys.add(key)
    merged.push(station)
  }
  return merged
}

export function getFederatedStationById(id: string): MediaStation | null {
  return getFederatedStations().find(station => station.id === id) ?? null
}

export function federatedStationsByFamily(family: MediaSourceFamily): MediaStation[] {
  return getFederatedStations().filter(station => inferSourceFamily(station) === family)
}

export function assertFederatedStationIdsUnique(stations: readonly MediaStation[] = getFederatedStations()): void {
  const ids = new Set<string>()
  for (const station of stations) {
    if (ids.has(station.id)) throw new Error(`Duplicate federated station id: ${station.id}`)
    ids.add(station.id)
  }
}

export function assertNoFakeIheartStreams(stations: readonly MediaStation[] = getFederatedStations()): void {
  for (const station of stations) {
    if (inferSourceFamily(station) !== 'iheart') continue
    if (station.streamUrl) {
      throw new Error(`iHeart station ${station.id} must not pin a stream URL without an official HTML5 path.`)
    }
    const hay = `${station.streamUrl ?? ''} ${station.notes} ${station.listenPage ?? ''} ${station.homepage ?? ''}`.toLowerCase()
    if (hay.includes('revma.ihrhls.com') && station.streamUrl) {
      throw new Error(`Refusing to pin iHeart revma URL on ${station.id}`)
    }
  }
}

assertFederatedStationIdsUnique()
assertNoFakeIheartStreams()
