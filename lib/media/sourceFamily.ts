import type {
  MediaGenreFilter,
  MediaPlaybackMode,
  MediaSourceFamily,
  MediaStation,
} from './types'

const OHIO_GENRE: Record<string, string> = {
  'oh-waps': 'OTHER',
  'oh-wjcu': 'OTHER',
  'oh-wksu': 'NEWS / TALK',
  'oh-wclv': 'CLASSICAL',
  'oh-jazzneo': 'JAZZ',
  'oh-folk-alley': 'OTHER',
  'oh-wnir': 'NEWS / TALK',
  'oh-wtam': 'NEWS / TALK',
  'oh-wmms': 'ROCK',
  'oh-wknr': 'SPORTS',
}

export function inferSourceFamily(station: MediaStation): MediaSourceFamily {
  if (station.sourceFamily) return station.sourceFamily
  const provider = station.provider.toLowerCase()
  const homepage = (station.homepage ?? station.listenPage ?? '').toLowerCase()
  if (provider.includes('iheart') || homepage.includes('iheart.com')) return 'iheart'
  if (station.country && !/united states|usa|us/i.test(station.country)) return 'international'
  if (station.sourceClass === 'STREAM_ONLY') return 'direct'
  return 'public'
}

export function inferPlaybackMode(station: MediaStation): MediaPlaybackMode {
  if (station.playbackMode) return station.playbackMode
  if (station.embedUrl) return 'OFFICIAL_EMBED'
  if (station.sourceClass === 'STREAM_ONLY' && station.streamUrl && station.verificationState === 'VERIFIED') {
    return 'DIRECT_STREAM'
  }
  if (station.listenPage || station.homepage) return 'OFFICIAL_PAGE'
  return 'LINK_OUT'
}

export function inferState(station: MediaStation): string | null {
  if (station.state) return station.state
  const region = station.region || ''
  const city = station.city || ''
  const match = /\b([A-Z]{2})\b/.exec(`${region} ${city}`)
  if (match?.[1] && match[1] !== 'FM' && match[1] !== 'AM') return match[1]
  if (/ohio/i.test(`${region} ${city}`)) return 'OH'
  return null
}

export function decorateStation(station: MediaStation): MediaStation {
  const sourceFamily = inferSourceFamily(station)
  return {
    ...station,
    sourceFamily,
    playbackMode: inferPlaybackMode(station),
    market: station.market ?? station.city,
    state: inferState(station),
    country: station.country ?? 'United States',
    genre: station.genre ?? OHIO_GENRE[station.id] ?? null,
    language: station.language ?? 'en',
    artworkUrl: station.artworkUrl ?? null,
    embedUrl: station.embedUrl ?? null,
  }
}

export function stationIdentityKey(station: Pick<MediaStation, 'callSign' | 'city'>): string {
  return `${station.callSign.trim().toLowerCase()}|${station.city.trim().toLowerCase()}`
}

export function sourceFamilyLabel(family: MediaSourceFamily | undefined): string {
  if (family === 'iheart') return 'IHEART'
  if (family === 'public') return 'PUBLIC'
  if (family === 'international') return 'INTERNATIONAL'
  return 'DIRECT'
}

export function playbackModeLabel(mode: MediaPlaybackMode | undefined): string {
  if (mode === 'DIRECT_STREAM') return 'DIRECT'
  if (mode === 'OFFICIAL_EMBED') return 'EMBED'
  if (mode === 'OFFICIAL_PAGE') return 'OFFICIAL PAGE'
  return 'LINK OUT'
}

export function genreMatches(station: MediaStation, filter: MediaGenreFilter): boolean {
  if (filter === 'ALL') return true
  const genre = (station.genre ?? 'OTHER').toUpperCase()
  return genre === filter
}
