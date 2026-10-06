/**
 * Type-aware top-down vehicle silhouettes for Terra live aircraft (OpenSky) and vessels
 * (Digitraffic / AIS). Classification uses only source-supplied fields. UNKNOWN stays UNKNOWN —
 * OpenSky `/states/all` does not identify airliner vs cargo vs military, so those classes are
 * never invented from weight, callsign, or country.
 */
import type { TerraViewBand } from './layerGovernor/viewBands'
import { isLocalBand, isOrbitBand, isWideBand } from './layerGovernor/viewBands'
import { terraAircraftBillboardRotationRadians } from './aircraftOrientation'
import { isTerraAircraftStale, TERRA_AIRCRAFT_STALE_AFTER_MS } from './aircraftStaleness'
import { isTerraVesselStale, TERRA_VESSEL_STALE_AFTER_MS } from './vesselStaleness'

export const AIRCRAFT_ICON_TYPES = [
  'AIRLINER',
  'CARGO',
  'GENERAL_AVIATION',
  'HELICOPTER',
  'MILITARY',
  'UNKNOWN_AIRCRAFT',
] as const
export type AircraftIconType = (typeof AIRCRAFT_ICON_TYPES)[number]

export const VESSEL_ICON_TYPES = [
  'CARGO',
  'TANKER',
  'PASSENGER',
  'FERRY',
  'FISHING',
  'TUG',
  'PLEASURE',
  'GOVERNMENT',
  'UNKNOWN_VESSEL',
] as const
export type VesselIconType = (typeof VESSEL_ICON_TYPES)[number]

export const VEHICLE_LAYER_FILTERS = [
  'PASSENGER',
  'CARGO',
  'HELICOPTER',
  'TANKER',
  'FISHING',
  'OTHER',
] as const
export type VehicleLayerFilter = (typeof VEHICLE_LAYER_FILTERS)[number]

export const VEHICLE_FRESHNESS = ['LIVE', 'RECENT', 'STALE', 'UNAVAILABLE', 'NO_COVERAGE'] as const
export type VehicleFreshness = (typeof VEHICLE_FRESHNESS)[number]

/** OpenSky ADS-B emitter category (state vector index 17) — sourced labels only. */
export const OPENSKY_EMITTER_CATEGORY_LABELS: Record<number, string> = {
  0: 'No information',
  1: 'No ADS-B emitter category',
  2: 'Light',
  3: 'Small',
  4: 'Large',
  5: 'High vortex large',
  6: 'Heavy',
  7: 'High performance',
  8: 'Rotorcraft',
  9: 'Glider / sailplane',
  10: 'Lighter-than-air',
  11: 'Parachutist / skydiver',
  12: 'Ultralight / hang-glider / paraglider',
  13: 'Reserved',
  14: 'UAV',
  15: 'Space / trans-atmospheric vehicle',
  16: 'Surface emergency vehicle',
  17: 'Surface service vehicle',
  18: 'Point obstacle',
  19: 'Cluster obstacle',
  20: 'Line obstacle',
}

const ABSTRACT_ARROW_PATH = 'M14 1 L20 19 L14 15 L8 19 Z'
const ABSTRACT_HULL_PATH = 'M14 2 L19 10 L19 22 L14 26 L9 22 L9 10 Z'

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * OpenSky category 8 is the only emitter class that legitimately identifies a helicopter.
 * Light/small/glider/ultralight are GENERAL_AVIATION. Large/heavy/high-performance are still
 * UNKNOWN_AIRCRAFT — those weight classes do not identify airliner vs cargo vs military.
 */
export function classifyAircraftIconType(properties: Record<string, unknown>): AircraftIconType {
  const stored = asString(properties.aircraftIconType)
  if (stored && (AIRCRAFT_ICON_TYPES as readonly string[]).includes(stored)) return stored as AircraftIconType
  const category = asFiniteNumber(properties.emitterCategory ?? properties.category)
  if (category === 8) return 'HELICOPTER'
  if (category === 2 || category === 3 || category === 9 || category === 12) return 'GENERAL_AVIATION'
  return 'UNKNOWN_AIRCRAFT'
}

export function classifyVesselIconType(properties: Record<string, unknown>): VesselIconType {
  const stored = asString(properties.vesselIconType)
  if (stored && (VESSEL_ICON_TYPES as readonly string[]).includes(stored)) return stored as VesselIconType
  const code = asFiniteNumber(properties.shipTypeCode)
  if (code !== null) return vesselIconTypeFromAisCode(code)
  const label = (asString(properties.shipTypeLabel) ?? '').toLowerCase()
  if (!label) return 'UNKNOWN_VESSEL'
  if (label === 'fishing') return 'FISHING'
  if (label === 'tug' || label === 'towing') return 'TUG'
  if (label === 'sailing' || label === 'pleasure craft') return 'PLEASURE'
  if (label === 'passenger') return 'PASSENGER'
  if (label === 'cargo') return 'CARGO'
  if (label === 'tanker') return 'TANKER'
  if (
    label === 'military operations'
    || label === 'pilot vessel'
    || label === 'search and rescue vessel'
    || label === 'law enforcement'
  ) return 'GOVERNMENT'
  return 'UNKNOWN_VESSEL'
}

export function vesselIconTypeFromAisCode(code: number): VesselIconType {
  if (!Number.isFinite(code) || code <= 0) return 'UNKNOWN_VESSEL'
  if (code === 30) return 'FISHING'
  if (code === 31 || code === 32 || code === 52) return 'TUG'
  if (code === 36 || code === 37) return 'PLEASURE'
  if (code === 35 || code === 50 || code === 51 || code === 55) return 'GOVERNMENT'
  if (code >= 60 && code <= 69) return 'PASSENGER'
  if (code >= 70 && code <= 79) return 'CARGO'
  if (code >= 80 && code <= 89) return 'TANKER'
  return 'UNKNOWN_VESSEL'
}

/** Aircraft: true_track/heading. Vessel: AIS heading, else COG. Never invents a direction. */
export function sourcedVehicleHeadingDeg(kind: string, properties: Record<string, unknown>): number | null {
  const heading = asFiniteNumber(properties.headingDeg)
  if (kind === 'aircraft_state') return heading
  if (kind === 'vessel_position') {
    if (heading !== null) return heading
    return asFiniteNumber(properties.courseDeg)
  }
  return null
}

export function vehicleBillboardRotationRadians(headingDeg: number | null): number {
  if (headingDeg === null) return 0
  return terraAircraftBillboardRotationRadians(headingDeg)
}

export function vehicleObservationFreshness(
  kind: 'aircraft_state' | 'vessel_position',
  observedAtIso: string | null,
  nowIso: string,
): VehicleFreshness {
  if (!observedAtIso) return 'UNAVAILABLE'
  const observedMs = Date.parse(observedAtIso)
  const nowMs = Date.parse(nowIso)
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs)) return 'UNAVAILABLE'
  const age = nowMs - observedMs
  if (kind === 'aircraft_state') {
    if (age <= TERRA_AIRCRAFT_STALE_AFTER_MS) return 'LIVE'
    if (age <= TERRA_AIRCRAFT_STALE_AFTER_MS * 2) return 'RECENT'
    return isTerraAircraftStale(observedAtIso, nowIso) ? 'STALE' : 'RECENT'
  }
  if (age <= TERRA_VESSEL_STALE_AFTER_MS) return 'LIVE'
  if (age <= TERRA_VESSEL_STALE_AFTER_MS * 2) return 'RECENT'
  return isTerraVesselStale(observedAtIso, nowIso) ? 'STALE' : 'RECENT'
}

export function vehicleIconScale(band: TerraViewBand, selected = false, hovered = false): number {
  const base = band === 'SPACE' ? 0.28
    : band === 'GLOBAL' ? 0.32
      : band === 'CONTINENTAL' ? 0.48
        : band === 'REGIONAL' ? 0.78
          : band === 'CITY' ? 1
            : 1.12
  const emphasis = selected ? 1.08 : hovered ? 1.04 : 1
  return Number((base * emphasis).toFixed(3))
}

export function vehicleClusterPixelRange(band: TerraViewBand, detailLevel?: string): number {
  if (detailLevel === 'AGGREGATED' || isOrbitBand(band)) return 96
  if (band === 'CONTINENTAL') return 72
  if (band === 'REGIONAL') return 52
  if (band === 'CITY') return 36
  return 24
}

export function vehicleClusterMinimumSize(band: TerraViewBand): number {
  if (isWideBand(band)) return 3
  if (band === 'REGIONAL') return 3
  if (band === 'CITY') return 4
  return 5
}

export function vehicleShowHeadingTick(band: TerraViewBand): boolean {
  return isLocalBand(band)
}

export function vehicleColor(kind: 'aircraft_state' | 'vessel_position', selected: boolean, hovered: boolean): string {
  if (selected) return '#FDE68A'
  if (kind === 'vessel_position') return hovered ? '#A5F3FC' : '#67E8F9'
  return hovered ? '#F8FAFC' : '#E2E8F0'
}

export function vehicleMatchesLayerFilter(
  kind: 'aircraft_state' | 'vessel_position',
  iconType: AircraftIconType | VesselIconType,
  filter: VehicleLayerFilter,
): boolean {
  if (filter === 'HELICOPTER') return kind === 'aircraft_state' && iconType === 'HELICOPTER'
  if (filter === 'PASSENGER') return kind === 'vessel_position' && (iconType === 'PASSENGER' || iconType === 'FERRY')
  if (filter === 'CARGO') return kind === 'vessel_position' && iconType === 'CARGO'
  if (filter === 'TANKER') return kind === 'vessel_position' && iconType === 'TANKER'
  if (filter === 'FISHING') return kind === 'vessel_position' && iconType === 'FISHING'
  if (filter === 'OTHER') {
    if (kind === 'aircraft_state') return iconType !== 'HELICOPTER'
    return iconType !== 'PASSENGER' && iconType !== 'FERRY' && iconType !== 'CARGO' && iconType !== 'TANKER' && iconType !== 'FISHING'
  }
  return false
}

export function filterVehicleFeatures<T extends { kind: string; properties: Record<string, unknown> }>(
  features: T[],
  filters: readonly VehicleLayerFilter[],
): T[] {
  if (filters.length === 0) return features
  return features.filter(feature => {
    if (feature.kind !== 'aircraft_state' && feature.kind !== 'vessel_position') return true
    const iconType = feature.kind === 'aircraft_state'
      ? classifyAircraftIconType(feature.properties)
      : classifyVesselIconType(feature.properties)
    return filters.some(filter => vehicleMatchesLayerFilter(feature.kind as 'aircraft_state' | 'vessel_position', iconType, filter))
  })
}

function svgDataUri(svg: string): string {
  const encoded = typeof btoa === 'function' ? btoa(svg) : Buffer.from(svg, 'utf8').toString('base64')
  return `data:image/svg+xml;base64,${encoded}`
}

function wrapSvg(body: string, tick: boolean): string {
  const tail = tick ? '<path d="M16 28 L16 31.5" stroke="white" stroke-width="1.2" stroke-linecap="round"/>' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}${tail}</svg>`
}

const AIRCRAFT_PATHS: Record<AircraftIconType, string> = {
  UNKNOWN_AIRCRAFT: '<path fill="white" d="M16 3.2 L17.1 12.2 L29 15.4 L17.2 17 L16.5 28.4 L15.5 28.4 L14.8 17 L3 15.4 L14.9 12.2 Z"/>',
  AIRLINER: '<path fill="white" d="M16 2.8 L17.4 11.6 L30 15.2 L17.6 17.2 L16.6 28.6 L15.4 28.6 L14.4 17.2 L2 15.2 L14.6 11.6 Z"/><path fill="white" d="M13.2 25.2 L16 23.6 L18.8 25.2 L16 27.4 Z"/>',
  CARGO: '<path fill="white" d="M16 4 L17.6 12.4 L28.4 16.2 L17.4 18 L16.6 28.2 L15.4 28.2 L14.6 18 L3.6 16.2 L14.4 12.4 Z"/><rect x="13.2" y="14.8" width="5.6" height="6.2" fill="white"/>',
  GENERAL_AVIATION: '<path fill="white" d="M16 4.4 L16.9 13 L26.2 16 L16.8 17.2 L16.4 26.8 L15.6 26.8 L15.2 17.2 L5.8 16 L15.1 13 Z"/>',
  HELICOPTER: '<circle cx="16" cy="13" r="9.2" fill="none" stroke="white" stroke-width="1.15"/><path fill="white" d="M14.2 10.2 L17.8 10.2 L18.6 18.4 L16 22.6 L13.4 18.4 Z"/><path d="M16 22.4 L16 29.2" stroke="white" stroke-width="1.3" stroke-linecap="round"/><path d="M14.2 28.6 L17.8 28.6" stroke="white" stroke-width="1.1" stroke-linecap="round"/>',
  MILITARY: '<path fill="white" d="M16 2.4 L17.6 11 L27.5 13.6 L30 16 L17.4 16.8 L16.5 28.8 L15.5 28.8 L14.6 16.8 L2 16 L4.5 13.6 L14.4 11 Z"/>',
}

const VESSEL_PATHS: Record<VesselIconType, string> = {
  UNKNOWN_VESSEL: '<path fill="white" d="M16 3.4 L22.4 11.2 L22.4 27.6 L9.6 27.6 L9.6 11.2 Z"/>',
  CARGO: '<path fill="white" d="M16 4.2 L23 12 L23 27.4 L9 27.4 L9 12 Z"/><rect x="11.2" y="14.2" width="9.6" height="8.4" fill="#0B1A22" opacity="0.35"/>',
  TANKER: '<path fill="white" d="M16 3.2 L21.2 10.4 L21.6 28 L10.4 28 L10.8 10.4 Z"/><rect x="12" y="13" width="8" height="11.5" fill="#0B1A22" opacity="0.28"/>',
  PASSENGER: '<path fill="white" d="M16 3.6 L22.8 11.6 L22.2 27.8 L9.8 27.8 L9.2 11.6 Z"/><rect x="12.2" y="12.4" width="7.6" height="6.2" fill="#0B1A22" opacity="0.4"/>',
  FERRY: '<path fill="white" d="M11.4 7.2 L20.6 7.2 L24 14.2 L23.2 26.8 L8.8 26.8 L8 14.2 Z"/><rect x="11.6" y="11.4" width="8.8" height="5" fill="#0B1A22" opacity="0.35"/>',
  FISHING: '<path fill="white" d="M16 6.2 L21.4 13.2 L20.8 26.4 L11.2 26.4 L10.6 13.2 Z"/><path fill="white" d="M14.4 9.2 L17.6 9.2 L17.6 13.6 L14.4 13.6 Z"/>',
  TUG: '<path fill="white" d="M12.2 8.4 L19.8 8.4 L23.2 16.2 L22.4 26.6 L9.6 26.6 L8.8 16.2 Z"/>',
  PLEASURE: '<path fill="white" d="M16 4.4 L21.6 14.8 L20.4 26.2 L11.6 26.2 L10.4 14.8 Z"/>',
  GOVERNMENT: '<path fill="white" d="M16 3.8 L22 11.6 L21.6 27.4 L10.4 27.4 L10 11.6 Z"/><rect x="14.6" y="12.2" width="2.8" height="5.4" fill="#0B1A22" opacity="0.45"/>',
}

const URI_CACHE = new Map<string, string>()

function cachedUri(key: string, svg: string): string {
  const hit = URI_CACHE.get(key)
  if (hit) return hit
  const uri = svgDataUri(svg)
  URI_CACHE.set(key, uri)
  return uri
}

export function aircraftSilhouetteSvg(type: AircraftIconType, tick: boolean): string {
  return wrapSvg(AIRCRAFT_PATHS[type] ?? AIRCRAFT_PATHS.UNKNOWN_AIRCRAFT, tick)
}

export function vesselSilhouetteSvg(type: VesselIconType, tick: boolean): string {
  return wrapSvg(VESSEL_PATHS[type] ?? VESSEL_PATHS.UNKNOWN_VESSEL, tick)
}

export function aircraftSilhouetteDataUri(type: AircraftIconType, tick = false): string {
  return cachedUri(`ac:${type}:${tick ? 1 : 0}`, aircraftSilhouetteSvg(type, tick))
}

export function vesselSilhouetteDataUri(type: VesselIconType, tick = false): string {
  return cachedUri(`vs:${type}:${tick ? 1 : 0}`, vesselSilhouetteSvg(type, tick))
}

export function vehicleSilhouetteDataUri(
  kind: 'aircraft_state' | 'vessel_position',
  properties: Record<string, unknown>,
  tick = false,
): string {
  if (kind === 'vessel_position') return vesselSilhouetteDataUri(classifyVesselIconType(properties), tick)
  return aircraftSilhouetteDataUri(classifyAircraftIconType(properties), tick)
}

export function silhouetteContainsAbstractArrow(svg: string): boolean {
  return svg.includes(ABSTRACT_ARROW_PATH) || svg.includes(ABSTRACT_HULL_PATH)
}

export const VEHICLE_ICON_CONTRACT = {
  abstractArrowPath: ABSTRACT_ARROW_PATH,
  abstractHullPath: ABSTRACT_HULL_PATH,
  aircraftTypes: AIRCRAFT_ICON_TYPES,
  vesselTypes: VESSEL_ICON_TYPES,
} as const
