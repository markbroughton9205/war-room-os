import 'server-only'

import type { ResearchDocument, ResearchProviderId } from '@/lib/research-engine/core/types'
import { makeDocument } from '@/lib/research-engine/providers/shared'

export const AIS_HEADING_NOT_AVAILABLE = 511
export const AIS_COG_NOT_AVAILABLE = 360
export const AIS_SOG_NOT_AVAILABLE = 102.3
export const AIS_IMO_NOT_AVAILABLE = 0
export const AIS_DRAUGHT_NOT_AVAILABLE = 0

export const AIS_NAV_STATUS_LABELS: Record<number, string> = {
  0: 'Under way using engine',
  1: 'At anchor',
  2: 'Not under command',
  3: 'Restricted manoeuvrability',
  4: 'Constrained by her draught',
  5: 'Moored',
  6: 'Aground',
  7: 'Engaged in fishing',
  8: 'Under way sailing',
  9: 'Reserved (high-speed craft)',
  10: 'Reserved (wing-in-ground craft)',
  11: 'Power-driven vessel towing astern (regional)',
  12: 'Power-driven vessel pushing ahead/towing alongside (regional)',
  13: 'Reserved for future use',
  14: 'AIS-SART/MOB-AIS/EPIRB-AIS active',
  15: 'Not defined (default)',
}

export function classifyAisShipType(code: number): string | null {
  if (!Number.isFinite(code) || code <= 0) return null
  if (code >= 20 && code <= 29) return 'Wing in ground (WIG)'
  if (code === 30) return 'Fishing'
  if (code === 31 || code === 32) return 'Towing'
  if (code === 33) return 'Dredging or underwater operations'
  if (code === 34) return 'Diving operations'
  if (code === 35) return 'Military operations'
  if (code === 36) return 'Sailing'
  if (code === 37) return 'Pleasure craft'
  if (code >= 40 && code <= 49) return 'High-speed craft (HSC)'
  if (code === 50) return 'Pilot vessel'
  if (code === 51) return 'Search and rescue vessel'
  if (code === 52) return 'Tug'
  if (code === 53) return 'Port tender'
  if (code === 54) return 'Anti-pollution equipment'
  if (code === 55) return 'Law enforcement'
  if (code === 58) return 'Medical transport'
  if (code >= 60 && code <= 69) return 'Passenger'
  if (code >= 70 && code <= 79) return 'Cargo'
  if (code >= 80 && code <= 89) return 'Tanker'
  if (code >= 90 && code <= 99) return 'Other type'
  return `Type ${code} (reserved/other)`
}

export type MaritimeAisObservation = {
  mmsi: number
  latitude: number
  longitude: number
  name?: string | null
  callSign?: string | null
  imo?: number | null
  destination?: string | null
  draughtMeters?: number | null
  shipTypeCode?: number | null
  speedKnots?: number | null
  courseDeg?: number | null
  headingDeg?: number | null
  navStatCode?: number | null
  observedAtIso: string
  canonicalUrl: string
  sourceName: string
  organization: string
  license: string
  isHistorical?: boolean
}

function cleanString(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim()
  return trimmed ? trimmed : null
}

function finiteOrNull(value: number | null | undefined, sentinel?: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (sentinel !== undefined && value === sentinel) return null
  return value
}

export function makeMaritimeVesselDocument(provider: ResearchProviderId, observation: MaritimeAisObservation): ResearchDocument {
  const name = cleanString(observation.name)
  const callSign = cleanString(observation.callSign)
  const imo = finiteOrNull(observation.imo, AIS_IMO_NOT_AVAILABLE)
  const destination = cleanString(observation.destination)
  const draughtMeters = finiteOrNull(observation.draughtMeters, AIS_DRAUGHT_NOT_AVAILABLE)
  const shipTypeCode = finiteOrNull(observation.shipTypeCode)
  const shipTypeLabel = shipTypeCode !== null ? classifyAisShipType(shipTypeCode) : null
  const sog = finiteOrNull(observation.speedKnots, AIS_SOG_NOT_AVAILABLE)
  const cog = finiteOrNull(observation.courseDeg, AIS_COG_NOT_AVAILABLE)
  const heading = finiteOrNull(observation.headingDeg, AIS_HEADING_NOT_AVAILABLE)
  const navStatCode = finiteOrNull(observation.navStatCode)
  const navStatLabel = navStatCode !== null ? AIS_NAV_STATUS_LABELS[navStatCode] ?? null : null
  const title = name ?? `Vessel ${observation.mmsi}`
  const document = makeDocument({
    id: `${provider}:${observation.mmsi}`,
    provider,
    providerRecordId: String(observation.mmsi),
    title,
    summary: navStatLabel ? `Navigation status: ${navStatLabel}` : null,
    contentSnippet: `lat ${observation.latitude}, lon ${observation.longitude}`,
    canonicalUrl: observation.canonicalUrl,
    sourceUrl: observation.canonicalUrl,
    sourceName: observation.sourceName,
    contentType: 'vessel_position',
    authors: [],
    organization: observation.organization,
    publishedAt: observation.observedAtIso,
    updatedAt: null,
    geography: `lat ${observation.latitude}, lon ${observation.longitude}`,
    language: null,
    identifiers: {
      mmsi: String(observation.mmsi),
      ...(callSign ? { callSign } : {}),
      ...(imo !== null ? { imo: String(imo) } : {}),
      latitude: String(observation.latitude),
      longitude: String(observation.longitude),
      ...(sog !== null ? { speedKnots: String(sog) } : {}),
      ...(cog !== null ? { courseDeg: String(cog) } : {}),
      ...(heading !== null ? { headingDeg: String(heading) } : {}),
      ...(navStatCode !== null ? { navStatCode: String(navStatCode) } : {}),
      ...(navStatLabel ? { navStatLabel } : {}),
      ...(destination ? { destination } : {}),
      ...(draughtMeters !== null ? { draughtMeters: String(draughtMeters) } : {}),
      ...(shipTypeCode !== null ? { shipTypeCode: String(shipTypeCode) } : {}),
      ...(shipTypeLabel ? { shipTypeLabel } : {}),
      lastObservedIso: observation.observedAtIso,
    },
    subjects: [],
    license: observation.license,
    accessStatus: 'open',
  })
  if (observation.isHistorical) document.provenance.isHistorical = true
  return document
}

export const MARITIME_BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/

export function parseMaritimeBbox(text: string): { lamin: number; lomin: number; lamax: number; lomax: number } | null {
  const match = MARITIME_BBOX_PATTERN.exec(text.trim())
  if (!match) return null
  const [lamin, lomin, lamax, lomax] = match.slice(1).map(Number)
  if (![lamin, lomin, lamax, lomax].every(Number.isFinite) || lamax <= lamin || lomax <= lomin) return null
  return { lamin, lomin, lamax, lomax }
}

export function observationInBbox(
  latitude: number,
  longitude: number,
  bbox: { lamin: number; lomin: number; lamax: number; lomax: number },
): boolean {
  return latitude >= bbox.lamin && latitude <= bbox.lamax && longitude >= bbox.lomin && longitude <= bbox.lomax
}
