/**
 * Terra planetary clock — coordinate → IANA via tz-lookup, DST via Intl, solar day/night from lat/lon.
 *
 * Does not use the Commander's machine timezone. Does not keep a hand-written zone table.
 * Unresolvable coordinates stay UNAVAILABLE rather than inventing a zone.
 */
import tzlookup from 'tz-lookup'
import { isValidLiveCoordinate } from './liveGeoIntelligence'
import { resolvePlaceDisplayName } from './liveIntelLanguage'

export const TERRA_DAY_NIGHT_STATES = ['DAY', 'SUNRISE', 'SUNSET', 'NIGHT'] as const
export type TerraDayNightState = (typeof TERRA_DAY_NIGHT_STATES)[number]

export const TERRA_WORLD_CLOCK_CITIES = [
  { id: 'new_york', label: 'NEW YORK', nativeLabel: 'New York', englishLabel: 'New York', timeZone: 'America/New_York', latitude: 40.713, longitude: -74.006 },
  { id: 'london', label: 'LONDON', nativeLabel: 'London', englishLabel: 'London', timeZone: 'Europe/London', latitude: 51.507, longitude: -0.128 },
  { id: 'lagos', label: 'LAGOS', nativeLabel: 'Lagos', englishLabel: 'Lagos', timeZone: 'Africa/Lagos', latitude: 6.524, longitude: 3.379 },
  { id: 'dubai', label: 'DUBAI', nativeLabel: 'دبي', englishLabel: 'Dubai', timeZone: 'Asia/Dubai', latitude: 25.205, longitude: 55.271 },
  { id: 'new_delhi', label: 'NEW DELHI', nativeLabel: 'नई दिल्ली', englishLabel: 'New Delhi', timeZone: 'Asia/Kolkata', latitude: 28.614, longitude: 77.209 },
  { id: 'beijing', label: 'BEIJING', nativeLabel: '北京', englishLabel: 'Beijing', timeZone: 'Asia/Shanghai', latitude: 39.904, longitude: 116.407 },
  { id: 'tokyo', label: 'TOKYO', nativeLabel: '東京', englishLabel: 'Tokyo', timeZone: 'Asia/Tokyo', latitude: 35.676, longitude: 139.65 },
  { id: 'sydney', label: 'SYDNEY', nativeLabel: 'Sydney', englishLabel: 'Sydney', timeZone: 'Australia/Sydney', latitude: -33.869, longitude: 151.209 },
] as const

export type TerraWorldClockCityId = (typeof TERRA_WORLD_CLOCK_CITIES)[number]['id']

export type TerraWorldClockRow = {
  id: string
  label: string
  nativeLabel: string | null
  englishLabel: string | null
  timeZone: string | null
  localTime: string | null
  localDate: string | null
  utcOffset: string | null
  abbreviation: string | null
  dayNightState: TerraDayNightState | null
  dstActive: boolean | null
  pinned: boolean
  selected: boolean
}

export type TerraWorldTimeSnapshot = {
  label: string
  nativePlaceName: string | null
  englishPlaceName: string | null
  latitude: number | null
  longitude: number | null
  timeZone: string | null
  utc: string
  localTime: string | null
  localDate: string | null
  utcOffset: string | null
  abbreviation: string | null
  dayNightState: TerraDayNightState | null
  dstActive: boolean | null
  coverageState: 'LIVE' | 'PARTIAL' | 'UNAVAILABLE'
  sourceTimestamp: string | null
  eventLocalTime: string | null
  eventUtcOffset: string | null
}

export function canonicalIanaTimeZone(timeZone: string): string {
  if (timeZone === 'Europe/Kiev' || timeZone === 'Europe/Kyiv') {
    try {
      Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv' }).format(new Date())
      return 'Europe/Kyiv'
    } catch {
      return timeZone === 'Europe/Kyiv' ? 'Europe/Kiev' : timeZone
    }
  }
  return timeZone
}

export function resolveIanaTimeZone(latitude: number, longitude: number): { timeZone: string; coverageState: 'LIVE' | 'PARTIAL' } | null {
  if (!isValidLiveCoordinate(latitude, longitude)) return null
  try {
    const raw = tzlookup(latitude, longitude)
    if (!raw || typeof raw !== 'string') return null
    const timeZone = canonicalIanaTimeZone(raw)
    try {
      Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    } catch {
      return null
    }
    return { timeZone, coverageState: timeZone.startsWith('Etc/') ? 'PARTIAL' : 'LIVE' }
  } catch {
    return null
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function tzOffsetMinutes(date: Date, timeZone: string): number | null {
  try {
    const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
    const zoned = new Date(date.toLocaleString('en-US', { timeZone }))
    return Math.round((zoned.getTime() - utc.getTime()) / 60000)
  } catch {
    return null
  }
}

export function dstActiveInZone(utcIso: string, timeZone: string): boolean | null {
  const ms = Date.parse(utcIso)
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  const year = date.getUTCFullYear()
  const jan = tzOffsetMinutes(new Date(Date.UTC(year, 0, 1, 12)), timeZone)
  const jul = tzOffsetMinutes(new Date(Date.UTC(year, 6, 1, 12)), timeZone)
  const current = tzOffsetMinutes(date, timeZone)
  if (jan === null || jul === null || current === null) return null
  if (jan === jul) return false
  return current === Math.max(jan, jul)
}

export function formatZonedClock(utcIso: string, timeZone: string): {
  localTime: string
  localDate: string
  utcOffset: string
  abbreviation: string
  dstActive: boolean | null
} | null {
  const ms = Date.parse(utcIso)
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  const zone = canonicalIanaTimeZone(timeZone)
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZoneName: 'short',
    }).formatToParts(date)
    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
    const abbreviation = pick('timeZoneName')
    const localTime = `${pick('hour')}:${pick('minute')} ${pick('dayPeriod')} ${abbreviation}`.replace(/\s+/g, ' ').trim()
    const localDate = `${pick('weekday')} ${pick('month')} ${pick('day')} ${pick('year')}`.trim()
    const offsetMinutes = tzOffsetMinutes(date, zone)
    if (offsetMinutes === null) return null
    const sign = offsetMinutes >= 0 ? '+' : '-'
    const abs = Math.abs(offsetMinutes)
    const utcOffset = `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${pad2(abs % 60)}` : ''}`
    return { localTime, localDate, utcOffset, abbreviation, dstActive: dstActiveInZone(utcIso, zone) }
  } catch {
    return null
  }
}

/**
 * Solar elevation in degrees using the NOAA/SPA geometric approximation.
 * Civil band ±6° is SUNRISE (morning) or SUNSET (afternoon); above is DAY; below is NIGHT.
 */
export function solarPosition(latitude: number, longitude: number, utcIso: string): { elevation: number; rising: boolean } | null {
  if (!isValidLiveCoordinate(latitude, longitude)) return null
  const ms = Date.parse(utcIso)
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  const rad = Math.PI / 180
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  const dayOfYear = Math.floor((ms - start) / 86400000)
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (minutes - 720) / 1440)
  const eqTime = 229.18 * (
    0.000075
    + 0.001868 * Math.cos(gamma)
    - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma)
    - 0.040849 * Math.sin(2 * gamma)
  )
  const decl = 0.006918
    - 0.399912 * Math.cos(gamma)
    + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma)
    + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma)
    + 0.00148 * Math.sin(3 * gamma)
  const trueSolar = (minutes + eqTime + 4 * longitude) % 1440
  const hourAngle = (trueSolar / 4) - 180
  const zenith = Math.acos(
    Math.sin(latitude * rad) * Math.sin(decl)
    + Math.cos(latitude * rad) * Math.cos(decl) * Math.cos(hourAngle * rad),
  ) / rad
  return { elevation: 90 - zenith, rising: hourAngle < 0 }
}

export function solarElevationDegrees(latitude: number, longitude: number, utcIso: string): number | null {
  return solarPosition(latitude, longitude, utcIso)?.elevation ?? null
}

export function dayNightStateFromElevation(elevation: number | null, rising?: boolean): TerraDayNightState | null {
  if (elevation === null || !Number.isFinite(elevation)) return null
  if (elevation >= 6) return 'DAY'
  if (elevation <= -6) return 'NIGHT'
  if (rising === undefined) return null
  return rising ? 'SUNRISE' : 'SUNSET'
}

export function resolveDayNightState(latitude: number, longitude: number, utcIso: string): TerraDayNightState | null {
  const position = solarPosition(latitude, longitude, utcIso)
  if (!position) return null
  return dayNightStateFromElevation(position.elevation, position.rising)
}

export function resolveTerraWorldTime(input: {
  utcIso: string
  latitude?: number | null
  longitude?: number | null
  place?: string | null
  nativePlaceName?: string | null
  englishPlaceName?: string | null
  sourceTimestamp?: string | null
  timeZone?: string | null
}): TerraWorldTimeSnapshot {
  const utc = input.utcIso
  const lat = typeof input.latitude === 'number' && Number.isFinite(input.latitude) ? input.latitude : null
  const lon = typeof input.longitude === 'number' && Number.isFinite(input.longitude) ? input.longitude : null
  const names = resolvePlaceDisplayName({
    place: input.place,
    nativeName: input.nativePlaceName,
    englishName: input.englishPlaceName,
  })
  const place = names.displayLabel || input.place?.trim() || null
  const resolved = input.timeZone
    ? { timeZone: canonicalIanaTimeZone(input.timeZone), coverageState: 'LIVE' as const }
    : (lat !== null && lon !== null ? resolveIanaTimeZone(lat, lon) : null)
  const clock = resolved ? formatZonedClock(utc, resolved.timeZone) : null
  const eventClock = resolved && input.sourceTimestamp ? formatZonedClock(input.sourceTimestamp, resolved.timeZone) : null
  const label = place
    || (lat !== null && lon !== null ? `${lat.toFixed(3)}°, ${lon.toFixed(3)}°` : 'No active Terra location')
  return {
    label,
    nativePlaceName: names.nativeName,
    englishPlaceName: names.englishName,
    latitude: lat,
    longitude: lon,
    timeZone: resolved?.timeZone ?? null,
    utc,
    localTime: clock?.localTime ?? null,
    localDate: clock?.localDate ?? null,
    utcOffset: clock?.utcOffset ?? null,
    abbreviation: clock?.abbreviation ?? null,
    dayNightState: lat !== null && lon !== null ? resolveDayNightState(lat, lon, utc) : null,
    dstActive: clock?.dstActive ?? null,
    coverageState: !resolved || !clock ? 'UNAVAILABLE' : resolved.coverageState,
    sourceTimestamp: input.sourceTimestamp ?? null,
    eventLocalTime: eventClock?.localTime ?? null,
    eventUtcOffset: eventClock?.utcOffset ?? null,
  }
}

export function worldClockStrip(utcIso: string, local?: TerraWorldTimeSnapshot | null): TerraWorldClockRow[] {
  const cities = TERRA_WORLD_CLOCK_CITIES.map(city => {
    const clock = formatZonedClock(utcIso, city.timeZone)
    return {
      id: city.id,
      label: city.label,
      nativeLabel: city.nativeLabel,
      englishLabel: city.englishLabel,
      timeZone: city.timeZone,
      localTime: clock?.localTime ?? null,
      localDate: clock?.localDate ?? null,
      utcOffset: clock?.utcOffset ?? null,
      abbreviation: clock?.abbreviation ?? null,
      dayNightState: resolveDayNightState(city.latitude, city.longitude, utcIso),
      dstActive: clock?.dstActive ?? null,
      pinned: true,
      selected: local?.timeZone === city.timeZone,
    }
  })
  return [
    {
      id: 'local',
      label: 'LOCAL',
      nativeLabel: local?.nativePlaceName ?? null,
      englishLabel: local?.englishPlaceName ?? null,
      timeZone: local?.timeZone ?? null,
      localTime: local?.localTime ?? null,
      localDate: local?.localDate ?? null,
      utcOffset: local?.utcOffset ?? null,
      abbreviation: local?.abbreviation ?? null,
      dayNightState: local?.dayNightState ?? null,
      dstActive: local?.dstActive ?? null,
      pinned: true,
      selected: true,
    },
    ...cities,
  ]
}

export function relativeAgeLabel(utcIso: string, nowIso: string): string | null {
  const then = Date.parse(utcIso)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(then) || !Number.isFinite(now) || now < then) return null
  const minutes = Math.round((now - then) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes === 1) return '1 minute ago'
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours === 1) return '1 hour ago'
  if (hours < 48) return `${hours} hours ago`
  return null
}

export const TERRA_WORLD_CLOCK_PIN_STORAGE_KEY = 'terra.liveIntel.worldClock.pinned'
