/**
 * The Maritime Source Federation registry — Terra Phase 3's answer to "one provider -> vessel
 * dots." Every candidate source Terra researched for Maritime is represented here with an honest
 * activation state, independent of whether a lib/research-engine/providers adapter exists for it
 * yet. This is NOT a second provider framework: entries that do have a real adapter reference their
 * exact ResearchProviderId (researchProviderId), and the Research Engine remains the only thing
 * that ever makes an HTTP/WebSocket call. This file is purely the federation-level bookkeeping the
 * mission requires — coverage, protocol, rights, and configuration state per source class — so a
 * Commander (or Council) can see the whole Maritime acquisition plan at a glance, not just
 * whichever one source happens to be wired up today.
 *
 * IMPORTANT: this registry is NOT the research corpus (the ~738-row live-source registry /
 * regional feed matrix / licensing matrix the Terra research phase produced). That corpus is
 * discovery/evidence, not a production allowlist — every entry actually ENABLED here
 * (configurationState 'ENABLED') was independently re-verified against its own current official
 * documentation during this build phase (see each entry's `evidenceNote`), not copied from the
 * corpus on trust. Entries with any other configurationState are real, named sources with a real,
 * specific, honestly-stated blocker — never a placeholder invented for symmetry with the ones that
 * work.
 */
import type { ResearchProviderId } from '@/lib/research-engine/core/types'
import type { TerraDegreeRectangle } from './aircraftBoundingBox'
import { DIGITRAFFIC_MARINE_COVERAGE_BBOX } from './maritimeBoundingBox'

export const MARITIME_SOURCE_CLASSES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] as const
export type MaritimeSourceClass = (typeof MARITIME_SOURCE_CLASSES)[number]

export const MARITIME_SOURCE_CLASS_LABELS: Record<MaritimeSourceClass, string> = {
  C1: 'Own sensor',
  C2: 'Community sensor',
  C3: 'Government feed',
  C4: 'Open API',
  C5: 'Open/public stream',
  C6: 'Scientific / historical',
  C7: 'Optional commercial',
}

/**
 * Honest activation state (mission's "register its state honestly" requirement). 'ENABLED' is the
 * only state an adapter is actually wired for; every other state names the real, specific reason
 * it isn't, never a generic "unavailable."
 */
export type MaritimeSourceConfigurationState =
  | 'ENABLED'
  | 'ACCOUNT_REQUIRED'
  | 'CREDENTIAL_REQUIRED'
  | 'TERMS_DEPENDENT'
  | 'EARNED_BY_FEEDING'
  | 'HISTORICAL_ONLY'
  | 'HARDWARE_REQUIRED'
  | 'COMMERCIAL_REVIEW'
  | 'NOT_CONFIGURED'

export type MaritimeSourceProtocol = 'REST' | 'WebSocket' | 'MQTT' | 'local_receiver' | 'bulk_archive'

export type MaritimeSourceRecord = {
  id: string
  displayName: string
  sourceClass: MaritimeSourceClass
  /** The exact Research Engine adapter this source is wired through, or null when this entry has
   * no HTTP/WebSocket adapter by definition (C1 own hardware) or no adapter built yet in a way
   * that would even make a researchProviderId meaningful today. */
  researchProviderId: ResearchProviderId | null
  protocol: MaritimeSourceProtocol
  /** Human-readable, honestly scoped — never "global" unless the source genuinely is. */
  coverageDescription: string
  coverageBoundingBox: TerraDegreeRectangle | null
  expectedLatency: string
  authenticationRequired: boolean
  rightsState: string
  commercialState: 'none' | 'optional_paid_tier' | 'required_paid'
  configurationState: MaritimeSourceConfigurationState
  evidenceStatus: 'verified_live_this_build' | 'verified_via_official_docs_this_build' | 'research_corpus_unverified'
  evidenceNote: string
}

export const MARITIME_SOURCE_REGISTRY: MaritimeSourceRecord[] = [
  {
    id: 'digitraffic_marine',
    displayName: 'Digitraffic Marine Traffic (Fintraffic, Finland)',
    sourceClass: 'C3',
    researchProviderId: 'digitraffic_marine',
    protocol: 'REST',
    coverageDescription: 'Finnish territorial waters + EEZ (Gulf of Finland, Bothnian Bay/Sea, Archipelago Sea) — coastal/national, not blue-water.',
    coverageBoundingBox: DIGITRAFFIC_MARINE_COVERAGE_BBOX,
    expectedLatency: 'Near-real-time; responses cached ~1 minute upstream.',
    authenticationRequired: false,
    rightsState: 'CC BY 4.0 (Fintraffic) — attribution "Source: Fintraffic / digitraffic.fi, license CC 4.0 BY" required.',
    commercialState: 'none',
    configurationState: 'ENABLED',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'GET /locations and /vessels called live this build (real HTTP 200, ~1,300-1,400 real vessels); terms-of-service page read live for the CC BY 4.0 license text.',
  },
  {
    id: 'barentswatch_ais',
    displayName: 'BarentsWatch Open AIS (Norway)',
    sourceClass: 'C3',
    researchProviderId: 'barentswatch_ais',
    protocol: 'REST',
    coverageDescription: 'Norwegian waters, including satellite-AIS-augmented coverage within Norwegian zones.',
    coverageBoundingBox: null,
    expectedLatency: 'Live position + 14-day historic, per official docs.',
    authenticationRequired: true,
    rightsState: 'NLOD (Norwegian Licence for Open Government Data).',
    commercialState: 'none',
    configurationState: 'ACCOUNT_REQUIRED',
    evidenceStatus: 'verified_via_official_docs_this_build',
    evidenceNote: 'developer.barentswatch.no read this build: requires a free developer-portal account and an OAuth2 client-credentials grant via id.barentswatch.no before any AIS call — no anonymous path.',
  },
  {
    id: 'aisstream',
    displayName: 'AISStream.io',
    sourceClass: 'C5',
    researchProviderId: 'aisstream',
    protocol: 'WebSocket',
    coverageDescription: 'Global (community-fed AIS network) — per-connection bbox/MMSI filters.',
    coverageBoundingBox: null,
    expectedLatency: 'Live stream; no publish SLA or replay per official docs.',
    authenticationRequired: true,
    rightsState: 'Terms of Service leaves commercial-use unanswered (project GitHub issue #16, open as of this research corpus).',
    commercialState: 'none',
    configurationState: 'CREDENTIAL_REQUIRED',
    evidenceStatus: 'verified_via_official_docs_this_build',
    evidenceNote: 'aisstream.io/documentation read this build: free API key required to open the socket; 3-connection cap documented; ToS commercial-use ambiguity confirmed still open. Per mission doctrine this never becomes Maritime\'s sole/primary source even once a key exists.',
  },
  {
    id: 'aishub_marine',
    displayName: 'AISHub community aggregate feed',
    sourceClass: 'C2',
    researchProviderId: 'aishub_marine',
    protocol: 'REST',
    coverageDescription: 'Global community-contributed AIS aggregate.',
    coverageBoundingBox: null,
    expectedLatency: 'Contributor-dependent; documented qualification bar is ≤10s delay.',
    authenticationRequired: true,
    rightsState: 'Reciprocal barter — feed access granted in exchange for contributed coverage, not a license purchase.',
    commercialState: 'none',
    configurationState: 'EARNED_BY_FEEDING',
    evidenceStatus: 'verified_via_official_docs_this_build',
    evidenceNote: 'aishub.net/join-us read this build: access requires operating a real AIS receiver (e.g. AIS-catcher — see the ais_catcher_own_sensor entry below) and sustaining ≥10 vessels at ≥90% uptime. Not purchasable; not activatable by this build alone.',
  },
  {
    id: 'noaa_access_ais',
    displayName: 'NOAA AccessAIS / MarineCadastre',
    sourceClass: 'C6',
    researchProviderId: 'noaa_access_ais',
    protocol: 'bulk_archive',
    coverageDescription: 'U.S. coastal waters, historical only.',
    coverageBoundingBox: null,
    expectedLatency: 'N/A — annual/monthly bulk archive files, not a live feed.',
    authenticationRequired: false,
    rightsState: 'CC0 (U.S. federal public domain).',
    commercialState: 'none',
    configurationState: 'HISTORICAL_ONLY',
    evidenceStatus: 'verified_via_official_docs_this_build',
    evidenceNote: 'marinecadastre.gov/accessais and coast.noaa.gov read this build: distributed as large annual/monthly CSV/zip archives, no queryable live REST/WebSocket "current position" endpoint exists.',
  },
  {
    id: 'ais_catcher_own_sensor',
    displayName: 'AIS-catcher / local SDR receiver (own sensor)',
    sourceClass: 'C1',
    researchProviderId: null,
    protocol: 'local_receiver',
    coverageDescription: 'Whatever the Commander\'s own receiver/antenna siting can reach — terrestrial AIS is line-of-sight, commonly cited in the ~40-50 nm range under favorable conditions, never treated as a universal constant.',
    coverageBoundingBox: null,
    expectedLatency: 'Real-time, receiver-local.',
    authenticationRequired: false,
    rightsState: 'License-clean by construction — Terra-operated hardware, no third-party terms.',
    commercialState: 'none',
    configurationState: 'HARDWARE_REQUIRED',
    evidenceStatus: 'research_corpus_unverified',
    evidenceNote: 'No hardware fielded this phase — this entry exists solely to reserve the architectural boundary (see lib/terra/maritimeOwnSensorBridge.ts) so a future real AIS-catcher/SDR feed plugs into the same normalized vessel model instead of a second system. Never fabricated as active.',
  },
  {
    id: 'commercial_satellite_ais',
    displayName: 'Commercial satellite AIS (e.g. Kpler/Spire, S&P/ORBCOMM, MarineTraffic/VesselFinder APIs)',
    sourceClass: 'C7',
    researchProviderId: null,
    protocol: 'REST',
    coverageDescription: 'True blue-water/open-ocean coverage terrestrial AIS structurally cannot reach.',
    coverageBoundingBox: null,
    expectedLatency: 'Vendor-dependent, typically minutes to hours for satellite passes.',
    authenticationRequired: true,
    rightsState: 'Commercial license/contract required per vendor.',
    commercialState: 'required_paid',
    configurationState: 'COMMERCIAL_REVIEW',
    evidenceStatus: 'research_corpus_unverified',
    evidenceNote: 'Deliberately never built or purchased this phase (mission constraint: no third-party accounts, no purchases). Registered only so open-ocean coverage gaps have a named, real augmentation path in the federation plan — per Rule R0 doctrine, this must never become Maritime\'s sole or primary dependency even if procured later.',
  },
]

export function getMaritimeSourceRecord(id: string): MaritimeSourceRecord | undefined {
  return MARITIME_SOURCE_REGISTRY.find(record => record.id === id)
}

export function listEnabledMaritimeSources(): MaritimeSourceRecord[] {
  return MARITIME_SOURCE_REGISTRY.filter(record => record.configurationState === 'ENABLED')
}
