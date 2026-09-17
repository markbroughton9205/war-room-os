/**
 * Present-only Digitraffic / Terra vessel fields. Never invents absent AIS values.
 * Safe to import from client components (no Node builtins).
 */
import type { TerraCouncilHandoffPayload } from '@/lib/terra/councilHandoff'
import type { TerraLiveGeoObject } from '@/lib/terra/liveGeoIntelligence'
import type { TerraGeoFeature } from '@/lib/terra/types'

export type AstraObservedVessel = {
  mmsi?: string
  imo?: string
  name?: string
  latitude?: number
  longitude?: number
  speedKnots?: number
  courseDeg?: number
  headingDeg?: number
  navigationStatus?: string
  observedAt?: string
  freshness?: string
  provider?: string
  evidenceId?: string
  sourceUrl?: string
}

function presentString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function presentNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function observedVesselFromSelection(args: {
  object?: TerraLiveGeoObject | null
  feature?: TerraGeoFeature | null
}): AstraObservedVessel | null {
  const object = args.object
  const feature = args.feature
  if (!object && feature?.kind !== 'vessel_position') return null
  const properties = feature?.kind === 'vessel_position' ? feature.properties : {}
  const vessel: AstraObservedVessel = {}
  const mmsi = presentString(properties.mmsi) ?? presentString(object?.id)
  const name = presentString(object?.title) ?? presentString(feature?.title)
  const latitude = presentNumber(object?.latitude) ?? presentNumber(feature?.latitude)
  const longitude = presentNumber(object?.longitude) ?? presentNumber(feature?.longitude)
  const speedKnots = presentNumber(properties.speedKnots)
  const courseDeg = presentNumber(properties.courseDeg)
  const headingDeg = presentNumber(properties.headingDeg)
  const navigationStatus = presentString(properties.navStatLabel)
  const imo = presentString(properties.imo)
  const observedAt = presentString(object?.observedAt) ?? presentString(feature?.timestamp)
  const freshness = presentString(object?.freshness)
  const provider = presentString(object?.provider) ?? presentString(feature?.provenance.provider)
  const evidenceId = presentString(object?.evidenceId)
  const sourceUrl = presentString(object?.sourceUrl) ?? presentString(feature?.rawReference.canonicalUrl)

  if (mmsi) vessel.mmsi = mmsi
  if (imo) vessel.imo = imo
  if (name) vessel.name = name
  if (latitude !== undefined) vessel.latitude = latitude
  if (longitude !== undefined) vessel.longitude = longitude
  if (speedKnots !== undefined) vessel.speedKnots = speedKnots
  if (courseDeg !== undefined) vessel.courseDeg = courseDeg
  if (headingDeg !== undefined) vessel.headingDeg = headingDeg
  if (navigationStatus) vessel.navigationStatus = navigationStatus
  if (observedAt) vessel.observedAt = observedAt
  if (freshness) vessel.freshness = freshness
  if (provider) vessel.provider = provider
  if (evidenceId) vessel.evidenceId = evidenceId
  if (sourceUrl) vessel.sourceUrl = sourceUrl

  return Object.keys(vessel).length ? vessel : null
}

export function observedVesselFromTerraSeed(
  seed: TerraCouncilHandoffPayload | null,
  extra?: AstraObservedVessel | null,
): AstraObservedVessel | null {
  const vessel: AstraObservedVessel = { ...(extra ?? {}) }
  if (seed) {
    const lineage = seed.lineage
    if (!vessel.name && lineage.title) vessel.name = lineage.title
    if (vessel.latitude === undefined && typeof lineage.latitude === 'number') vessel.latitude = lineage.latitude
    if (vessel.longitude === undefined && typeof lineage.longitude === 'number') vessel.longitude = lineage.longitude
    if (!vessel.observedAt && lineage.observedAt) vessel.observedAt = lineage.observedAt
    if (!vessel.freshness) vessel.freshness = lineage.freshness
    if (!vessel.provider) vessel.provider = lineage.provider
    if (!vessel.evidenceId && lineage.evidenceId) vessel.evidenceId = lineage.evidenceId
    if (!vessel.sourceUrl && lineage.sourceUrl) vessel.sourceUrl = lineage.sourceUrl
    if (!vessel.mmsi) vessel.mmsi = presentString(lineage.objectId)
    const facts = seed.observedFacts
    const mmsi = facts.match(/^MMSI:\s*(.+)$/m)?.[1]?.trim()
    const imo = facts.match(/^IMO:\s*(.+)$/m)?.[1]?.trim()
    const speed = facts.match(/^SPEED:\s*([0-9.]+)/m)?.[1]
    const course = facts.match(/^COURSE:\s*(-?[0-9.]+)/m)?.[1]
    const heading = facts.match(/^HEADING:\s*(-?[0-9.]+)/m)?.[1]
    const nav = facts.match(/^NAV STATUS:\s*(.+)$/m)?.[1]?.trim()
    if (!vessel.mmsi && mmsi) vessel.mmsi = mmsi
    if (!vessel.imo && imo) vessel.imo = imo
    if (vessel.speedKnots === undefined && speed && Number.isFinite(Number(speed))) vessel.speedKnots = Number(speed)
    if (vessel.courseDeg === undefined && course && Number.isFinite(Number(course))) vessel.courseDeg = Number(course)
    if (vessel.headingDeg === undefined && heading && Number.isFinite(Number(heading))) vessel.headingDeg = Number(heading)
    if (!vessel.navigationStatus && nav) vessel.navigationStatus = nav
  }
  return Object.keys(vessel).length ? vessel : null
}

export function isAstraObservedVessel(value: unknown): value is AstraObservedVessel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const rec = value as Record<string, unknown>
  const allowed = [
    'mmsi', 'imo', 'name', 'latitude', 'longitude', 'speedKnots', 'courseDeg',
    'headingDeg', 'navigationStatus', 'observedAt', 'freshness', 'provider',
    'evidenceId', 'sourceUrl',
  ]
  for (const key of Object.keys(rec)) {
    if (!allowed.includes(key)) return false
  }
  if (rec.mmsi !== undefined && typeof rec.mmsi !== 'string') return false
  if (rec.imo !== undefined && typeof rec.imo !== 'string') return false
  if (rec.name !== undefined && typeof rec.name !== 'string') return false
  if (rec.latitude !== undefined && typeof rec.latitude !== 'number') return false
  if (rec.longitude !== undefined && typeof rec.longitude !== 'number') return false
  if (rec.speedKnots !== undefined && typeof rec.speedKnots !== 'number') return false
  if (rec.courseDeg !== undefined && typeof rec.courseDeg !== 'number') return false
  if (rec.headingDeg !== undefined && typeof rec.headingDeg !== 'number') return false
  if (rec.navigationStatus !== undefined && typeof rec.navigationStatus !== 'string') return false
  if (rec.observedAt !== undefined && typeof rec.observedAt !== 'string') return false
  if (rec.freshness !== undefined && typeof rec.freshness !== 'string') return false
  if (rec.provider !== undefined && typeof rec.provider !== 'string') return false
  if (rec.evidenceId !== undefined && typeof rec.evidenceId !== 'string') return false
  if (rec.sourceUrl !== undefined && typeof rec.sourceUrl !== 'string') return false
  return true
}
