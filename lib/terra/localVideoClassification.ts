/**
 * LOCAL video classification.
 *
 * A verified local-service-area video enters LOCAL only when BOTH are true:
 * 1. source service area overlaps the active Terra location
 * 2. the item itself has local relevance (qualifyLocalStory)
 *
 * Publisher headquarters / officialName is not locality.
 * National and global channels never become LOCAL.
 * Local-service-area videos that fail either condition are suppressed — they
 * do not leak into HEADLINES, EARTH, Tokyo LOCAL, or Area Live.
 */
import { qualifyLocalStory } from './localSources/qualify'
import { localSourceTouchesContext } from './localSources/match'
import { parseLocalContext } from './localSources/context'
import type { TerraLocalContext, TerraLocalSource } from './localSources/types'
import type { TerraLiveIntelNewsSeed } from './liveIntelPanelModel'
import {
  videoSourceIsLocalEligible,
  verifiedVideoSourceById,
  youtubeChannelAtomFeedUrl,
  type VerifiedVideoSource,
} from './verifiedVideoSources'

export type VerifiedVideoLane = 'GLOBAL' | 'LOCAL' | 'SUPPRESSED'

export type ClassifiedVerifiedVideoSeed = {
  lane: VerifiedVideoLane
  reason: string
  seed: TerraLiveIntelNewsSeed
}

export type ClassifiedVerifiedVideoSeeds = {
  globalSeeds: TerraLiveIntelNewsSeed[]
  localSeeds: TerraLiveIntelNewsSeed[]
  suppressed: { id: string; title: string; reason: string }[]
}

export function videoSourceAsLocalSource(source: VerifiedVideoSource): TerraLocalSource | null {
  const geo = source.geography
  if (!geo || geo.localityScope !== 'LOCAL_SERVICE_AREA' || !geo.serviceArea) return null
  return {
    id: source.id,
    name: source.officialName,
    type: source.localSourceType ?? 'TV',
    city: geo.city ?? null,
    county: geo.county ?? null,
    metro: geo.metro ?? null,
    region: geo.region ?? null,
    state: geo.state ?? null,
    country: geo.country ?? 'United States',
    countryCode: geo.countryCode ?? 'US',
    coverageLevel: geo.coverageLevel ?? 'METRO',
    serviceArea: geo.serviceArea,
    aliases: geo.aliases ?? [],
    homepage: source.channelUrl,
    feedUrl: youtubeChannelAtomFeedUrl(source.channelId),
    feedType: 'ATOM',
    language: source.language ?? 'en',
    provider: source.provider,
    lastVerified: '2026-09-17',
    status: source.enabled ? 'ACTIVE' : 'UNAVAILABLE',
    licenseClass: 'PUBLIC_RSS',
    provenance: source.verificationSource,
  }
}

export function videoSourceOverlapsActiveLocation(source: VerifiedVideoSource, context: TerraLocalContext): boolean {
  const local = videoSourceAsLocalSource(source)
  if (!local) return false
  return localSourceTouchesContext(local, context) != null
}

export function resolveVerifiedVideoSource(seed: TerraLiveIntelNewsSeed): VerifiedVideoSource | null {
  if (seed.verifiedVideoSourceId) return verifiedVideoSourceById(seed.verifiedVideoSourceId)
  const match = /^yt:([^:]+):/.exec(seed.id)
  return match ? verifiedVideoSourceById(match[1] ?? '') : null
}

export function classifyVerifiedVideoSeed(
  seed: TerraLiveIntelNewsSeed,
  context: TerraLocalContext | null,
): ClassifiedVerifiedVideoSeed {
  const source = resolveVerifiedVideoSource(seed)
  if (!source || !videoSourceIsLocalEligible(source)) {
    return { lane: 'GLOBAL', reason: 'National or global official video — not LOCAL.', seed }
  }
  if (!context) {
    return {
      lane: 'SUPPRESSED',
      reason: 'No active Terra location. Local-service-area video is not shown globally.',
      seed,
    }
  }
  const localSource = videoSourceAsLocalSource(source)
  if (!localSource) {
    return { lane: 'SUPPRESSED', reason: 'Local video source is missing a service area.', seed }
  }
  const matchLevel = localSourceTouchesContext(localSource, context)
  if (!matchLevel) {
    return {
      lane: 'SUPPRESSED',
      reason: `Source service area (${localSource.serviceArea}) does not overlap ${context.shortLabel}.`,
      seed,
    }
  }
  const qualification = qualifyLocalStory({
    title: seed.title,
    summary: seed.summary,
    geography: seed.geography,
    context,
    source: { ...localSource, matchLevel, matchReason: `${matchLevel} overlap for ${context.shortLabel}` },
  })
  if (!qualification.qualified) {
    return {
      lane: 'SUPPRESSED',
      reason: qualification.reason,
      seed,
    }
  }
  return {
    lane: 'LOCAL',
    reason: qualification.reason,
    seed: {
      ...seed,
      intelCategory: 'LOCAL',
      localSourceType: source.localSourceType ?? 'TV',
      localServiceArea: source.geography?.serviceArea ?? seed.localServiceArea ?? null,
      localRelevance: qualification.relevance,
      geography: seed.geography ?? null,
    },
  }
}

export function classifyVerifiedVideoSeeds(
  seeds: readonly TerraLiveIntelNewsSeed[],
  context: TerraLocalContext | null,
): ClassifiedVerifiedVideoSeeds {
  const globalSeeds: TerraLiveIntelNewsSeed[] = []
  const localSeeds: TerraLiveIntelNewsSeed[] = []
  const suppressed: ClassifiedVerifiedVideoSeeds['suppressed'] = []
  for (const seed of seeds) {
    const classified = classifyVerifiedVideoSeed(seed, context)
    if (classified.lane === 'LOCAL') localSeeds.push(classified.seed)
    else if (classified.lane === 'GLOBAL') globalSeeds.push(classified.seed)
    else suppressed.push({ id: seed.id, title: seed.title, reason: classified.reason })
  }
  return { globalSeeds, localSeeds, suppressed }
}

export function localContextFromTerraLocation(input: {
  latitude?: number | null
  longitude?: number | null
  place?: string | null
  city?: string | null
  county?: string | null
  state?: string | null
  country?: string | null
  countryCode?: string | null
}): TerraLocalContext | null {
  if (typeof input.latitude !== 'number' || typeof input.longitude !== 'number') return null
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) return null
  return parseLocalContext({
    latitude: input.latitude,
    longitude: input.longitude,
    place: input.place,
    city: input.city,
    county: input.county,
    state: input.state,
    country: input.country,
    countryCode: input.countryCode,
  })
}
