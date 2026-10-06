import { genreMatches, inferSourceFamily } from './sourceFamily'
import type { MediaGenreFilter, MediaGeoScope, MediaSourceFilter, MediaStation } from './types'

export type MediaLocationHint = {
  city?: string | null
  state?: string | null
  country?: string | null
  region?: string | null
  label?: string | null
}

export type MediaBrowseQuery = {
  stations: readonly MediaStation[]
  search?: string
  geo?: MediaGeoScope
  source?: MediaSourceFilter
  genre?: MediaGenreFilter
  location?: MediaLocationHint | null
}

function haystack(station: MediaStation): string {
  return [
    station.callSign,
    station.name,
    station.frequency,
    station.city,
    station.market,
    station.state,
    station.country,
    station.region,
    station.genre,
    station.provider,
    inferSourceFamily(station),
  ].filter(Boolean).join(' ').toLowerCase()
}

function locationTokens(location: MediaLocationHint | null | undefined): string[] {
  if (!location) return []
  return [location.city, location.state, location.country, location.region, location.label]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map(value => value.trim().toLowerCase())
}

function stationMatchesLocal(station: MediaStation, location: MediaLocationHint | null | undefined): boolean {
  const tokens = locationTokens(location)
  if (tokens.length === 0) return false
  const text = haystack(station)
  return tokens.some(token => {
    const city = token.split(',')[0]?.trim() ?? token
    return city.length >= 3 && text.includes(city)
  })
}

function stationMatchesRegional(station: MediaStation, location: MediaLocationHint | null | undefined): boolean {
  if (stationMatchesLocal(station, location)) return true
  const state = location?.state?.trim().toLowerCase()
  if (!state) return false
  const text = haystack(station)
  if (text.includes(state)) return true
  if (state === 'oh' || state === 'ohio') return text.includes('ohio') || text.includes('oh-') || /\boh\b/.test(text)
  return false
}

export function filterMediaStations(input: MediaBrowseQuery): MediaStation[] {
  const geo = input.geo ?? 'global'
  const source = input.source ?? 'all'
  const genre = input.genre ?? 'ALL'
  const search = input.search?.trim().toLowerCase() ?? ''
  return input.stations.filter(station => {
    if (source !== 'all' && inferSourceFamily(station) !== source) return false
    if (!genreMatches(station, genre)) return false
    if (geo === 'local' && !stationMatchesLocal(station, input.location)) return false
    if (geo === 'regional' && !stationMatchesRegional(station, input.location)) return false
    if (search && !haystack(station).includes(search)) return false
    return true
  })
}
