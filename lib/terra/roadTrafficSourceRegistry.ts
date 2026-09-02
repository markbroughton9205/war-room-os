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
    id: 'ontario_511_cameras',
    displayName: 'Ontario 511 (511on.ca) — cameras',
    jurisdiction: 'Ontario, Canada',
    capabilities: ['camera'],
    researchProviderId: 'ontario_511_cameras',
    reconciliationStatus: 'MISSING',
    configurationState: 'ENABLED',
    authenticationRequired: false,
    rightsState: 'Government of Ontario / Ministry of Transportation — redistribution/proxying terms not independently confirmed this build (511on.ca/tos redirected during this build\'s live check rather than rendering reviewable text).',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'CORRECTION to Phase 1\'s note (kept here for the audit trail): Phase 1 assumed each camera view\'s Url (511on.ca/map/Cctv/{id}) was an HTML viewer page requiring further investigation. Live-verified this build with a real HTTP GET + header inspection: it returns the raw JPEG directly (content-type: image/jpeg, real embedded EXIF capture datetime, cache-control max-age=20, CloudFront-served, access-control-allow-origin: *) — a Kimi-research-vs-live-behavior discrepancy that resolved in the MORE capable direction. Implemented this phase: GET /api/v2/get/cameras (real HTTP 200, real per-view URLs now confirmed as direct images).',
  },
  {
    id: 'ontario_511_events',
    displayName: 'Ontario 511 (511on.ca) — events',
    jurisdiction: 'Ontario, Canada',
    capabilities: ['event'],
    researchProviderId: 'ontario_511_events',
    reconciliationStatus: 'MISSING',
    configurationState: 'ENABLED',
    authenticationRequired: false,
    rightsState: 'Government of Ontario / Ministry of Transportation — terms not independently confirmed this build.',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'GET 511on.ca/api/v2/get/event called live this build — real HTTP 200, real coordinates, real EventType/Severity/LanesAffected vocabulary, real Unix-epoch Reported/LastUpdated timestamps. Implemented this phase.',
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
    evidenceNote: 'RECONFIRMED this build: GET 511.alberta.ca/api/v2/get/cameras and /api/v2/get/event both return real HTTP 400 application/xml "<Error><Message>Invalid Key</Message></Error>" (the Iteris/511 platform\'s standard API-key gate). EXTERNAL DEPENDENCY: requires a Commander-issued Iteris developer key before any adapter can be built.',
  },
  {
    id: 'south_carolina_511',
    displayName: 'South Carolina 511',
    jurisdiction: 'South Carolina, USA',
    capabilities: ['camera', 'event'],
    researchProviderId: null,
    reconciliationStatus: 'REQUIRES_LICENSE_REVIEW',
    configurationState: 'CREDENTIAL_REQUIRED',
    authenticationRequired: true,
    rightsState: 'Not reviewed this build.',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'UPGRADED to verified_live_this_build: GET 511sc.org/api/v2/get/cameras (with and without a test key param) returns a real HTTP 301 redirecting to https://www.511sc.org/ (the Iteris-powered HTML portal — Iteris copyright banner confirmed in the response body), i.e. no keyless Iteris API path exists at that host the way 511on.ca\'s does. EXTERNAL DEPENDENCY: same registered-developer-key pattern confirmed live for Alberta/FL511 this build.',
  },
  {
    id: 'montana_511',
    displayName: 'Montana 511',
    jurisdiction: 'Montana, USA',
    capabilities: ['camera', 'event'],
    researchProviderId: null,
    reconciliationStatus: 'REQUIRES_LICENSE_REVIEW',
    configurationState: 'CREDENTIAL_REQUIRED',
    authenticationRequired: true,
    rightsState: 'Not reviewed this build.',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'UPGRADED to verified_live_this_build: mdt511.com/api/v2/get/cameras returns a real HTTP 307 to https://www.511mt.net; www.511mt.net/api/v2/get/cameras returns a real HTTP 404 (Apache "Not Found") — no keyless Iteris-style API path exists at either host. EXTERNAL DEPENDENCY: same registered-developer-key pattern as Alberta.',
  },
  {
    id: 'south_dakota_511',
    displayName: 'South Dakota 511',
    jurisdiction: 'South Dakota, USA',
    capabilities: ['camera', 'event'],
    researchProviderId: null,
    reconciliationStatus: 'REQUIRES_LICENSE_REVIEW',
    configurationState: 'CREDENTIAL_REQUIRED',
    authenticationRequired: true,
    rightsState: 'Not reviewed this build.',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'UPGRADED to verified_live_this_build: sd511.org/api/v2/get/cameras (with and without a test key param) returns a real HTTP 301, and the redirect target path serves a real HTTP 404 — no keyless Iteris-style API path exists at that host. EXTERNAL DEPENDENCY: same registered-developer-key pattern as Alberta.',
  },
  {
    id: 'quebec_511_wfs',
    displayName: 'Québec 511 (MTMD open-data WFS)',
    jurisdiction: 'Québec, Canada',
    capabilities: ['camera', 'event'],
    researchProviderId: 'quebec_511_cameras',
    reconciliationStatus: 'MISSING',
    configurationState: 'ENABLED',
    authenticationRequired: false,
    rightsState: 'Québec government open data (donneesquebec.ca listing for the MTMD "Caméra de circulation" dataset, which links this exact WFS).',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'IMPLEMENTED this phase as TWO adapters over the one WFS host (quebec_511_cameras + quebec_511_events — mirroring the Ontario split): GET ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&request=getfeature&typename=ms:infos_cameras|ms:evenements&outputformat=geojson — real HTTP 200 both layers (675 real cameras; real events with French entrave/localisation/direction vocabulary and Point/LineString geometry). Real axis-order discovery: server-side bbox is lat,lon-ordered (WFS 2.0.0/EPSG:4326) — a lon,lat-ordered bbox returns a real 200 with zero features. Honest gap: each camera\'s URL_FLUX_DONNEE is an HTML viewer page, NOT a direct JPEG — no imageUrl is fabricated. The earlier "dedicated WFS adapter design" note was correct and is exactly what was built.',
  },
  {
    id: 'webtris',
    displayName: 'WebTRIS (National Highways, UK)',
    jurisdiction: 'England, UK (strategic road network)',
    capabilities: ['flow'],
    researchProviderId: 'webtris',
    reconciliationStatus: 'MISSING',
    configurationState: 'ENABLED',
    authenticationRequired: false,
    rightsState: 'UK Open Government Licence (National Highways).',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'Implemented this phase. DISCREPANCY vs. Phase 1\'s docs-only note (kept for the audit trail): Phase 1 called this "the strongest keyless TrafficFlow candidate" purely on keyless-access grounds and never checked data recency. Live probing this build (real GET /reports/daily calls across sites spread across the whole ID range) found NO site anywhere in the network has a report for today, yesterday, or even the prior ~8 weeks — the most recent available report date lags real time by roughly two months and drifts. This is a real, source-confirmed fact (WebTRIS\'s reports/daily is a batch-processed statistical report, never documented as real-time) — every observation is therefore always reported historical/STALE, never LIVE, per mission doctrine. Still implemented: real keyless site inventory (20,000+ sites) + real observed Avg mph / Total Volume, honestly labeled as historical.',
  },
  {
    id: 'digitraffic_road_weather',
    displayName: 'Digitraffic Road Weather (Fintraffic, Finland)',
    jurisdiction: 'Finland (national road network)',
    capabilities: ['road_weather'],
    researchProviderId: 'digitraffic_road_weather',
    reconciliationStatus: 'SAME_PROVIDER_FAMILY_REUSE_ADAPTER',
    configurationState: 'ENABLED',
    authenticationRequired: false,
    rightsState: 'CC BY 4.0 (Fintraffic) — attribution "Source: Fintraffic / digitraffic.fi, license CC 4.0 BY" required.',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'GET /stations and /stations/{id}/data both called live this build — real HTTP 200, real sub-minute-fresh sensor readings (air/road/ground temperature, humidity, visibility, wind, precipitation). Same organization/host family/terms as digitraffic_road_cameras and digitraffic_marine — reuses that family\'s exact adapter shape, not a third Digitraffic client. Sensor codes this build cannot decode with documented confidence (road-condition codes, ice-frequency/conductivity diagnostics — Digitraffic publishes no fetchable code-table endpoint) are preserved raw, never guessed.',
  },
  {
    id: 'hong_kong_td_traffic_snapshots',
    displayName: 'Hong Kong Transport Department traffic snapshots',
    jurisdiction: 'Hong Kong SAR',
    capabilities: ['camera'],
    researchProviderId: 'hong_kong_td_cameras',
    reconciliationStatus: 'MISSING',
    configurationState: 'ENABLED',
    authenticationRequired: false,
    rightsState: 'Hong Kong SAR Government open data (data.gov.hk terms of use) — official open dataset hk-td-tis_2-traffic-snapshot-images.',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'IMPLEMENTED this phase. Real endpoints verified live: GET static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.csv → real HTTP 200, 377 KB UTF-16LE tab-separated, 1,013 real cameras with source-supplied WGS84 lat/lon; GET tdcctv.data.one.gov.hk/BC101F.JPG → real HTTP 200 image/jpeg 320x240 (the dataset-documented direct-JPEG pattern). No per-image capture timestamp in the metadata feed — freshness honestly unknown. Zero-auth, keyless — the prior "not re-verified live" caveat is now resolved in the positive.',
  },
  {
    id: 'jartic_traffic_volumes',
    displayName: 'JARTIC traffic volumes (Japan)',
    jurisdiction: 'Japan (national)',
    capabilities: ['flow'],
    researchProviderId: 'jartic_traffic_volumes',
    reconciliationStatus: 'MISSING',
    configurationState: 'ENABLED',
    authenticationRequired: false,
    rightsState: 'Japan MLIT/JARTIC open traffic data program — no credential was required by any request made this build.',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'IMPLEMENTED this phase — CORRECTS the "likely membership-gated" assumption with real live evidence: api.jartic-open-traffic.org/geoserver?service=WFS&request=GetFeature&typeNames=t_travospublic_measure_1h returned real unauthenticated HTTP 200 GeoJSON with real directional vehicle counts (常時観測点コード 3310920 in the Tokyo bbox). Timezone empirically bracketed as JST (at 22:20 UTC / 07:20 JST the newest bucket with data was 0500 JST — a ~2h publication lag); CQL BBOX is lon,lat-ordered. The adapter walks a JST hour ladder back (max 26 steps) to the freshest bucket with real data, never a hardcoded lag.',
  },
  {
    id: 'wzdx_feed_registry',
    displayName: 'WZDx feed registry / direct feeds',
    jurisdiction: 'USA (multi-state aggregator)',
    capabilities: ['event'],
    researchProviderId: null,
    reconciliationStatus: 'PARTIALLY_INTEGRATED',
    configurationState: 'ENABLED',
    authenticationRequired: false,
    rightsState: 'Varies per publishing state DOT — each integrated feed below carries its own registry-listed public status.',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'UPGRADED from NOT_SUITABLE this phase: the registry itself remains an index (not a queryable API — that part of the earlier note stands), but three genuinely public, keyless, registry-listed state feeds were selected, verified live, and implemented behind one reusable WZDx parsing core (lib/research-engine/providers/wzdx_shared.ts): wzdx_wsdot (WZDx v4.2, wzdx.wsdot.wa.gov — real HTTP 200, update_date fresh to the minute), wzdx_iowa_dot (v4.0, iowa-atms.cloud-q-free.com — real HTTP 200, ~1-minute cadence per registry), wzdx_kytc (v4.1, KYTC open-records bucket — real HTTP 200, ~30-minute cadence). See the three per-feed records below.',
  },
  {
    id: 'wzdx_wsdot',
    displayName: 'WSDOT WZDx Work Zone Feed (Washington State)',
    jurisdiction: 'Washington, USA',
    capabilities: ['event'],
    researchProviderId: 'wzdx_wsdot',
    reconciliationStatus: 'MISSING',
    configurationState: 'ENABLED',
    authenticationRequired: false,
    rightsState: 'WSDOT public data feed — listed in the official USDOT WZDx feed registry (data.transportation.gov dataset 69qe-yiui).',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'GET https://wzdx.wsdot.wa.gov/api/v4/WorkZoneFeed — real HTTP 200 (application/json, ~1.4 MB), WZDx v4.2, road_event_feed_info.update_date 2026-08-28T14:57:36Z observed within the same minute it was fetched (feed-info update_frequency: 60). Zero-auth, keyless. Implemented this phase.',
  },
  {
    id: 'wzdx_iowa_dot',
    displayName: 'Iowa DOT WZDx Work Zone Feed',
    jurisdiction: 'Iowa, USA',
    capabilities: ['event'],
    researchProviderId: 'wzdx_iowa_dot',
    reconciliationStatus: 'MISSING',
    configurationState: 'ENABLED',
    authenticationRequired: false,
    rightsState: 'Iowa DOT public data feed — listed in the official USDOT WZDx feed registry.',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'GET https://iowa-atms.cloud-q-free.com/api/rest/dataprism/wzdx/wzdxfeed — real HTTP 200 (application/json, ~1.5 MB), WZDx v4.0, publisher "Iowa DOT", update_date 2026-08-28T22:15:54Z fresh to the minute when fetched. Zero-auth, keyless. Implemented this phase.',
  },
  {
    id: 'wzdx_kytc',
    displayName: 'KYTC WZDx Work Zone Feed (Kentucky)',
    jurisdiction: 'Kentucky, USA',
    capabilities: ['event'],
    researchProviderId: 'wzdx_kytc',
    reconciliationStatus: 'MISSING',
    configurationState: 'ENABLED',
    authenticationRequired: false,
    rightsState: 'KYTC open-records public feed — listed in the official USDOT WZDx feed registry (30-minute cadence).',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'GET https://storage.googleapis.com/kytc-its-2020-openrecords/public/feeds/WZDx/kytc_wzdx_v4.1.geojson — real HTTP 200 (application/json, ~470 KB), WZDx v4.1, real statewide bbox and real per-feature LineString geometry. Zero-auth, keyless. Implemented this phase.',
  },
  {
    id: 'fl511_arcgis_cameras',
    displayName: 'FL511 (Florida)',
    jurisdiction: 'Florida, USA',
    capabilities: ['camera'],
    researchProviderId: null,
    reconciliationStatus: 'REQUIRES_LICENSE_REVIEW',
    configurationState: 'CREDENTIAL_REQUIRED',
    authenticationRequired: true,
    rightsState: 'Not reviewed — blocked before reaching a terms/license question.',
    evidenceStatus: 'verified_live_this_build',
    evidenceNote: 'CORRECTED this build: FL511 is NOT an ArcGIS feed (the "ArcGIS cameras" display name reflects Phase 1\'s guess). GET fl511.com/api/v2/get/cameras returns a real HTTP 400 application/xml "<Error><Message>Invalid Key</Message></Error>" — the exact Iteris API-key gate confirmed for Alberta, i.e. FL511 runs the same Iteris/511 platform. EXTERNAL DEPENDENCY: requires a Commander-issued Iteris developer key before any adapter can be built.',
  },
]

export function getRoadTrafficSourceRecord(id: string): RoadTrafficSourceRecord | undefined {
  return ROAD_TRAFFIC_SOURCE_REGISTRY.find(record => record.id === id)
}

export function listEnabledRoadTrafficSources(): RoadTrafficSourceRecord[] {
  return ROAD_TRAFFIC_SOURCE_REGISTRY.filter(record => record.configurationState === 'ENABLED')
}
