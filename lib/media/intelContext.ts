import type { MediaIntelKind, MediaStation, MediaSurfaceReason } from './types'

/**
 * Station geography is publisher/station region only.
 * Never treat these as event coordinates extracted from audio.
 */
export type MediaIntelContext = {
  kind: MediaIntelKind
  query: string
  label: string
  href: string
  stationId: string
  note: string
}

export const MEDIA_INTEL_HANDOFF_KEY = 'war-room-media-intel-handoff'
export const MEDIA_INTEL_EVENT = 'war-room-media-intel'

const RADIO_REGION_NOTE =
  'Station publisher/station region. Not an event coordinate extracted from audio.'

const STATION_INTEL_QUERY: Record<string, { query: string; label: string }> = {
  'oh-waps': { query: 'Akron, Ohio', label: 'Akron, Ohio' },
  'oh-wjcu': { query: 'University Heights, Ohio', label: 'University Heights / Cleveland, Ohio' },
  'oh-wksu': { query: 'Northeast Ohio, United States', label: 'Northeast Ohio' },
  'oh-wclv': { query: 'Cleveland, Ohio', label: 'Cleveland, Ohio' },
  'oh-jazzneo': { query: 'Cleveland, Ohio', label: 'Cleveland, Ohio' },
  'oh-folk-alley': { query: 'Cleveland, Ohio', label: 'Cleveland, Ohio' },
  'oh-wnir': { query: 'Akron, Ohio', label: 'Akron, Ohio' },
  'oh-wtam': { query: 'Cleveland, Ohio', label: 'Cleveland, Ohio' },
  'oh-wmms': { query: 'Cleveland, Ohio', label: 'Cleveland, Ohio' },
  'oh-wknr': { query: 'Cleveland, Ohio', label: 'Cleveland, Ohio' },
}

export function intelContextForStation(station: MediaStation | null): MediaIntelContext | null {
  if (!station) return null
  const mapped = STATION_INTEL_QUERY[station.id]
  const query = mapped?.query ?? station.city
  const label = mapped?.label ?? station.city
  if (!query) return null
  const params = new URLSearchParams({ q: query, from: 'media' })
  return {
    kind: 'RADIO_STATION',
    query,
    label,
    href: `/terra?${params.toString()}`,
    stationId: station.id,
    note: RADIO_REGION_NOTE,
  }
}

export function persistMediaIntelHandoff(context: MediaIntelContext): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(MEDIA_INTEL_HANDOFF_KEY, JSON.stringify(context))
  } catch {
    return
  }
  window.dispatchEvent(new CustomEvent(MEDIA_INTEL_EVENT, { detail: context }))
}

export function consumeMediaIntelHandoff(): MediaIntelContext | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(MEDIA_INTEL_HANDOFF_KEY)
    if (!raw) return readMediaIntelFromLocation()
    window.sessionStorage.removeItem(MEDIA_INTEL_HANDOFF_KEY)
    const parsed = JSON.parse(raw) as MediaIntelContext
    if (!parsed || typeof parsed.query !== 'string' || !parsed.query.trim()) {
      return readMediaIntelFromLocation()
    }
    return parsed
  } catch {
    return readMediaIntelFromLocation()
  }
}

function readMediaIntelFromLocation(): MediaIntelContext | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  if (params.get('from') !== 'media') return null
  const query = params.get('q')?.trim()
  if (!query) return null
  return {
    kind: 'RADIO_STATION',
    query,
    label: query,
    href: `${window.location.pathname}?${params.toString()}`,
    stationId: '',
    note: RADIO_REGION_NOTE,
  }
}

export function surfaceReasonCopy(reason: MediaSurfaceReason | null, station: MediaStation | null): string | null {
  if (!reason) return null
  const place = station?.city ?? 'this region'
  if (reason === 'COMMANDER_SELECTED') return 'You selected this station.'
  if (reason === 'LOCAL_MEDIA') return `Local media for ${place}`
  if (reason === 'ACTIVE_LOCATION') return `Active location: ${place}`
  if (reason === 'WEATHER_ALERT') return `Weather alert context for ${place}`
  if (reason === 'INTEL_EVENT') return `Intelligence event context for ${place}`
  if (reason === 'RESTORED_SESSION') return 'Restored Media session.'
  return null
}
