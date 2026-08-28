/**
 * The Road Traffic & Camera Source Federation registry — God's Eye Traffic & Camera Intelligence
 * phase's Phase B reconciliation, mirroring lib/terra/maritimeSourceRegistry.ts's exact
 * convention: every Kimi Phase 1 candidate is represented here with an honest activation state,
 * independent of whether a lib/research-engine/providers adapter exists for it yet.
 *
 * Deliberate deviation from the Maritime precedent: Maritime registered every one of its (4) extra
 * candidates as a real ResearchProviderId union member even without an adapter. This registry
 * covers 13 extra candidates — adding 13 speculative ResearchProviderId union members for code
 * that doesn't exist would be exactly the kind of type-system churn this phase's "reconcile before
 * building" mandate is meant to prevent. `researchProviderId` is therefore `null` for every entry
 * without a real adapter; only the two entries this phase actually implemented
 * (digitraffic_road_cameras, drivebc_events) carry a real id.
 *
 * Classification vocabulary (mission's Phase B requirement) recorded in `reconciliationStatus`:
 *   ALREADY_INTEGRATED, PARTIALLY_INTEGRATED, REGISTERED_ONLY, MISSING,
 *   SAME_PROVIDER_FAMILY_REUSE_ADAPTER, NOT_SUITABLE, REQUIRES_LICENSE_REVIEW
 */
import type { ResearchProviderId } from '@/lib/research-engine/core/types'

export const ROAD_TRAFFIC_RECONCILIATION_STATUSES = [
  'ALREADY_INTEGRATED',
  'PARTIALLY_INTEGRATED',
  'REGISTERED_ONLY',
  'MISSING',
  'SAME_PROVIDER_FAMILY_REUSE_ADAPTER',
  'NOT_SUITABLE',
  'REQUIRES_LICENSE_REVIEW',
] as const
export type RoadTrafficReconciliationStatus = (typeof ROAD_TRAFFIC_RECONCILIATION_STATUSES)[number]

export type RoadTrafficSourceConfigurationState =
  | 'ENABLED'
  | 'CREDENTIAL_REQUIRED'
  | 'ACCOUNT_REQUIRED'
  | 'TERMS_DEPENDENT'
  | 'NOT_CONFIGURED'

export type RoadTrafficCapability = 'camera' | 'event' | 'flow' | 'road_weather' | 'sign'

export type RoadTrafficSourceRecord = {
  id: string
  displayName: string
  jurisdiction: string
  capabilities: RoadTrafficCapability[]
  researchProviderId: ResearchProviderId | null
  reconciliationStatus: RoadTrafficReconciliationStatus
  configurationState: RoadTrafficSourceConfigurationState
  authenticationRequired: boolean
  rightsState: string
  evidenceStatus: 'verified_live_this_build' | 'verified_via_official_docs_this_build' | 'research_corpus_unverified'
  evidenceNote: string
}

export const ROAD_TRAFFIC_SOURCE_REGISTRY: RoadTrafficSourceRecord[] = [
  {
    id: 'digitraffic_road_cameras',
    displayName: 'Digitraffic Road Weathercams (Fintraffic, Finland)',
    jurisdiction: 'Finland (national road network)',
    capabilities: ['camera'],
    researchProviderId: 'digitraffic_road_cameras',
    reconciliationStatus: 'SAME_PROVIDER_FAMILY_REUSE_ADAPTER',
    configurationState: 'ENABLED',
    authenticationRequired: false,
    rightsState: 'CC BY 4.0 (Fintraffic) — attribution "Source: Fintraffic / digitraffic.fi, license CC 4.0 BY" required.',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'GET /stations, /stations/data, and /stations/{id} all called live this build (real HTTP 200, real presets/imageUrl/direction/roadAddress). Same organization/host family/terms as the already-integrated digitraffic_marine — this phase reuses the exact adapter shape (safeProviderFetch/withProviderGate/cache pattern), not a second Digitraffic client.',
  },
  {
    id: 'drivebc_events',
    displayName: 'DriveBC / Open511 (British Columbia, Canada)',
    jurisdiction: 'British Columbia, Canada',
    capabilities: ['event'],
    researchProviderId: 'drivebc_events',
    reconciliationStatus: 'MISSING',
    configurationState: 'ENABLED',
    authenticationRequired: false,
    rightsState: 'Open Government Licence — British Columbia.',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'GET api.open511.gov.bc.ca/events (and the equivalent www.drivebc.ca/api/events/) called live this build — real HTTP 200, real Point/LineString geometry, real server-side bbox filtering confirmed by comparing filtered vs unfiltered result sets.',
  },
  {
    id: 'ontario_511',
    displayName: 'Ontario 511 (511on.ca)',
    jurisdiction: 'Ontario, Canada',
    capabilities: ['camera', 'event'],
    researchProviderId: null,
    reconciliationStatus: 'MISSING',
    configurationState: 'NOT_CONFIGURED',
    authenticationRequired: false,
    rightsState: 'Not yet reviewed in detail — Government of Ontario open-data-style terms expected, not yet confirmed this build.',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'GET 511on.ca/api/v2/get/cameras called live this build — real HTTP 200, no key required, real camera locations + per-view URLs. Note: those view URLs are 511on.ca HTML viewer pages, not confirmed direct image endpoints — that gap (and the event endpoint) needs a short follow-up investigation before implementation, which is why this stays MISSING/NOT_CONFIGURED rather than ENABLED this phase, despite being genuinely keyless. Strong next-phase candidate.',
  },
  {
    id: 'alberta_511',
    displayName: '511 Alberta',
    jurisdiction: 'Alberta, Canada',
    capabilities: ['camera', 'event'],
    researchProviderId: null,
    reconciliationStatus: 'REQUIRES_LICENSE_REVIEW',
    configurationState: 'CREDENTIAL_REQUIRED',
    authenticationRequired: true,
    rightsState: 'Not reviewed — blocked before reaching a terms/license question.',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'GET 511.alberta.ca/api/v2/get/cameras called live this build — real HTTP 400 "Invalid Key" (the Iteris/511 platform\'s standard API-key gate). Never implemented per mission\'s explicit "no API-key-required Phase 2 sources" instruction this phase.',
  },
  {
    id: 'south_carolina_511',
    displayName: 'South Carolina 511',
    jurisdiction: 'South Carolina, USA',
    capabilities: ['camera', 'event'],
    researchProviderId: null,
    reconciliationStatus: 'REQUIRES_LICENSE_REVIEW',
    configurationState: 'NOT_CONFIGURED',
    authenticationRequired: true,
    rightsState: 'Not reviewed this build.',
    evidenceStatus: 'research_corpus_unverified',
    evidenceNote: 'Not independently fetched this build. U.S. state 511 systems commonly run on a commercial 511/Iteris/TrafficCast platform requiring a registered developer API key (the same pattern confirmed live for Alberta above) — treated as a real, named candidate pending its own live verification, never assumed enabled.',
  },
  {
    id: 'montana_511',
    displayName: 'Montana 511',
    jurisdiction: 'Montana, USA',
    capabilities: ['camera', 'event'],
    researchProviderId: null,
    reconciliationStatus: 'REQUIRES_LICENSE_REVIEW',
    configurationState: 'NOT_CONFIGURED',
    authenticationRequired: true,
    rightsState: 'Not reviewed this build.',
    evidenceStatus: 'research_corpus_unverified',
    evidenceNote: 'Not independently fetched this build — same commercial-511-platform caveat as South Carolina above.',
  },
  {
    id: 'south_dakota_511',
    displayName: 'South Dakota 511',
    jurisdiction: 'South Dakota, USA',
    capabilities: ['camera', 'event'],
    researchProviderId: null,
    reconciliationStatus: 'REQUIRES_LICENSE_REVIEW',
    configurationState: 'NOT_CONFIGURED',
    authenticationRequired: true,
    rightsState: 'Not reviewed this build.',
    evidenceStatus: 'research_corpus_unverified',
    evidenceNote: 'Not independently fetched this build — same commercial-511-platform caveat as South Carolina above.',
  },
  {
    id: 'quebec_511_wfs',
    displayName: 'Québec 511 (WFS)',
    jurisdiction: 'Québec, Canada',
    capabilities: ['camera', 'event'],
    researchProviderId: null,
    reconciliationStatus: 'REQUIRES_LICENSE_REVIEW',
    configurationState: 'NOT_CONFIGURED',
    authenticationRequired: true,
    rightsState: 'Not reviewed this build.',
    evidenceStatus: 'research_corpus_unverified',
    evidenceNote: 'Not independently fetched this build. A WFS (OGC Web Feature Service) endpoint is a genuinely different integration shape (GML/GeoJSON over WFS, not a plain REST JSON API like the other 511 candidates) — flagged for its own dedicated adapter design, not a drop-in reuse of the Open511/Digitraffic shapes this phase built.',
  },
  {
    id: 'webtris',
    displayName: 'WebTRIS (National Highways, UK)',
    jurisdiction: 'England, UK (strategic road network)',
    capabilities: ['flow'],
    researchProviderId: null,
    reconciliationStatus: 'MISSING',
    configurationState: 'NOT_CONFIGURED',
    authenticationRequired: false,
    rightsState: 'UK Open Government Licence (National Highways).',
    evidenceStatus: 'verified_via_official_docs_this_build',
    evidenceNote: 'webtris.nationalhighways.co.uk\'s own Swagger docs confirmed live this build: "All WebTRIS API endpoints are available without registration or API keys." Real REST endpoints (/sites, /reports/daily, /reports/monthly, /quality/daily). Strongest keyless TrafficFlow candidate found this phase — not implemented this session (scope: one camera source + one event source), a clean, ready-to-build Phase 2 item.',
  },
  {
    id: 'hong_kong_td_traffic_snapshots',
    displayName: 'Hong Kong Transport Department traffic snapshots',
    jurisdiction: 'Hong Kong SAR',
    capabilities: ['camera'],
    researchProviderId: null,
    reconciliationStatus: 'REGISTERED_ONLY',
    configurationState: 'NOT_CONFIGURED',
    authenticationRequired: false,
    rightsState: 'Not reviewed this build.',
    evidenceStatus: 'research_corpus_unverified',
    evidenceNote: 'Not independently fetched this build. Hong Kong\'s data.gov.hk traffic-snapshot feed is a real, named, generally keyless public dataset per general public knowledge, but not re-verified live this phase — registered as a real candidate, not implemented, pending its own live confirmation.',
  },
  {
    id: 'jartic_traffic_volumes',
    displayName: 'JARTIC traffic volumes (Japan)',
    jurisdiction: 'Japan (national)',
    capabilities: ['flow'],
    researchProviderId: null,
    reconciliationStatus: 'REGISTERED_ONLY',
    configurationState: 'NOT_CONFIGURED',
    authenticationRequired: false,
    rightsState: 'Not reviewed this build — primary documentation is Japanese-language; not translated/reviewed this phase.',
    evidenceStatus: 'research_corpus_unverified',
    evidenceNote: 'Not independently fetched this build. JARTIC (Japan Road Traffic Information Center) publishes real open traffic-volume data, but its API shape and terms were not verified live this phase — registered as a real candidate pending dedicated review, not assumed enabled.',
  },
  {
    id: 'wzdx_feed_registry',
    displayName: 'WZDx feed registry / direct feeds',
    jurisdiction: 'USA (multi-state aggregator)',
    capabilities: ['event'],
    researchProviderId: null,
    reconciliationStatus: 'NOT_SUITABLE',
    configurationState: 'NOT_CONFIGURED',
    authenticationRequired: false,
    rightsState: 'Varies per publishing state DOT — not a single license.',
    evidenceStatus: 'research_corpus_unverified',
    evidenceNote: 'The WZDx registry itself is not a single queryable API — it is an index of many independent state-DOT-published GeoJSON feeds, each with its own host, cadence, and terms. This phase\'s drivebc_events already proves the "real WZDx-adjacent Open511/GeoJSON event with LineString geometry" architecture end to end; treating the registry as one federation entry (rather than one entry per state feed it points to) is a deliberate scope decision, not an oversight. A specific WZDx-publishing state feed is a REUSE_ADAPTER candidate against drivebc_events\' own normalizer shape once one is selected.',
  },
  {
    id: 'fl511_arcgis_cameras',
    displayName: 'FL511 (Florida) ArcGIS cameras',
    jurisdiction: 'Florida, USA',
    capabilities: ['camera'],
    researchProviderId: null,
    reconciliationStatus: 'REGISTERED_ONLY',
    configurationState: 'NOT_CONFIGURED',
    authenticationRequired: false,
    rightsState: 'Not reviewed this build.',
    evidenceStatus: 'research_corpus_unverified',
    evidenceNote: 'Attempted one endpoint guess live this build (fl511.com/List/GetCameras) — real HTTP 404, meaning that specific path is wrong, not that FL511\'s real ArcGIS-hosted camera feed doesn\'t exist. Registered as a real, named candidate pending the correct endpoint being located and verified, never assumed enabled from a failed guess.',
  },
]

export function getRoadTrafficSourceRecord(id: string): RoadTrafficSourceRecord | undefined {
  return ROAD_TRAFFIC_SOURCE_REGISTRY.find(record => record.id === id)
}

export function listEnabledRoadTrafficSources(): RoadTrafficSourceRecord[] {
  return ROAD_TRAFFIC_SOURCE_REGISTRY.filter(record => record.configurationState === 'ENABLED')
}
