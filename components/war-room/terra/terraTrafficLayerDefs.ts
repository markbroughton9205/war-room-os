'use client'

/**
 * God's Eye Phase 3 — the registry of bounded-coverage traffic/transportation layers rendered by
 * TerraTrafficLayer. One entry per source; the six Phase 1/2 layers (previously copy-pasted
 * bespoke blocks in TerraShell) and the seven Phase 3 layers from
 * lib/terra/PHASE3_HANDOFF_UI_LANE.md share this single table. Every entry pairs its source's own
 * bbox module (the coverage gate + query builder — each returns null outside the provider's real,
 * documented envelope) with the refresh cadence from the layer catalog (never faster than the
 * source's own update cadence or the repo's 60s floor; JARTIC 15 min, KYTC 5 min per handoff).
 */
import type { TerraTrafficLayerDef } from './TerraTrafficLayer'
import { buildTerraRoadCameraBoundingBoxQuery, terraCameraViewHasRoadCameraCoverage } from '@/lib/terra/roadCameraBoundingBox'
import { buildTerraTrafficEventBoundingBoxQuery, terraCameraViewHasTrafficEventCoverage } from '@/lib/terra/trafficEventBoundingBox'
import { buildTerraWebtrisBoundingBoxQuery, terraCameraViewHasWebtrisCoverage } from '@/lib/terra/webtrisBoundingBox'
import { buildTerraRoadWeatherBoundingBoxQuery, terraCameraViewHasRoadWeatherCoverage } from '@/lib/terra/digitrafficRoadWeatherBoundingBox'
import { buildTerraOntario511BoundingBoxQuery, terraCameraViewHasOntario511Coverage } from '@/lib/terra/ontarioBoundingBox'
import { buildTerraHongKongTdBoundingBoxQuery, terraCameraViewHasHongKongTdCoverage } from '@/lib/terra/hongKongBoundingBox'
import { buildTerraQuebec511BoundingBoxQuery, terraCameraViewHasQuebec511Coverage } from '@/lib/terra/quebec511BoundingBox'
import { buildTerraJarticBoundingBoxQuery, terraCameraViewHasJarticCoverage } from '@/lib/terra/jarticBoundingBox'
import { buildTerraWzdxBoundingBoxQuery, terraCameraViewHasWzdxCoverage } from '@/lib/terra/wzdxBoundingBox'

export const TERRA_TRAFFIC_LAYER_DEFS: TerraTrafficLayerDef[] = [
  {
    layerId: 'digitraffic_road_cameras',
    label: 'Cameras (Digitraffic Road — Finland)',
    unitNoun: 'camera',
    refreshMs: 60_000,
    cluster: true,
    coverageRegionLabel: "Finland's road network",
    hasCoverage: terraCameraViewHasRoadCameraCoverage,
    buildQuery: buildTerraRoadCameraBoundingBoxQuery,
  },
  {
    layerId: 'drivebc_events',
    label: 'Events (DriveBC / Open511 — British Columbia)',
    unitNoun: 'event',
    refreshMs: 60_000,
    coverageRegionLabel: 'British Columbia',
    hasCoverage: terraCameraViewHasTrafficEventCoverage,
    buildQuery: buildTerraTrafficEventBoundingBoxQuery,
  },
  {
    layerId: 'webtris',
    label: 'Flow (WebTRIS — England, UK)',
    unitNoun: 'site',
    refreshMs: 6 * 60 * 60 * 1000,
    cluster: true,
    allHistorical: true,
    recencyNote: 'Historical data (lags real time by roughly two months) — never rendered as live.',
    coverageRegionLabel: "England's strategic road network",
    hasCoverage: terraCameraViewHasWebtrisCoverage,
    buildQuery: buildTerraWebtrisBoundingBoxQuery,
  },
  {
    layerId: 'digitraffic_road_weather',
    label: 'Road Weather (Digitraffic — Finland)',
    unitNoun: 'station',
    refreshMs: 60_000,
    cluster: true,
    coverageRegionLabel: "Finland's road network",
    hasCoverage: terraCameraViewHasRoadWeatherCoverage,
    buildQuery: buildTerraRoadWeatherBoundingBoxQuery,
  },
  {
    layerId: 'ontario_511_cameras',
    label: 'Cameras (Ontario 511 — Canada)',
    unitNoun: 'camera',
    refreshMs: 60_000,
    cluster: true,
    coverageRegionLabel: 'Ontario',
    hasCoverage: terraCameraViewHasOntario511Coverage,
    buildQuery: buildTerraOntario511BoundingBoxQuery,
  },
  {
    layerId: 'ontario_511_events',
    label: 'Events (Ontario 511 — Canada)',
    unitNoun: 'event',
    refreshMs: 60_000,
    coverageRegionLabel: 'Ontario',
    hasCoverage: terraCameraViewHasOntario511Coverage,
    buildQuery: buildTerraOntario511BoundingBoxQuery,
  },
  {
    layerId: 'hong_kong_td_cameras',
    label: 'Cameras (Hong Kong TD — Hong Kong SAR)',
    unitNoun: 'camera',
    refreshMs: 60_000,
    cluster: true,
    coverageRegionLabel: 'Hong Kong SAR',
    hasCoverage: terraCameraViewHasHongKongTdCoverage,
    buildQuery: buildTerraHongKongTdBoundingBoxQuery,
  },
  {
    layerId: 'quebec_511_cameras',
    label: 'Cameras (Québec 511 — Canada)',
    unitNoun: 'camera',
    refreshMs: 60_000,
    cluster: true,
    coverageRegionLabel: 'Québec',
    hasCoverage: terraCameraViewHasQuebec511Coverage,
    buildQuery: buildTerraQuebec511BoundingBoxQuery,
  },
  {
    layerId: 'quebec_511_events',
    label: 'Events (Québec 511 — Canada)',
    unitNoun: 'event',
    refreshMs: 60_000,
    coverageRegionLabel: 'Québec',
    hasCoverage: terraCameraViewHasQuebec511Coverage,
    buildQuery: buildTerraQuebec511BoundingBoxQuery,
  },
  {
    layerId: 'jartic_traffic_volumes',
    label: 'Traffic Volumes (JARTIC — Japan)',
    unitNoun: 'site',
    refreshMs: 15 * 60 * 1000,
    cluster: true,
    allHistorical: true,
    recencyNote: 'Hourly source data (lags real time by roughly two hours) — never rendered as live.',
    coverageRegionLabel: 'Japan',
    hasCoverage: terraCameraViewHasJarticCoverage,
    buildQuery: buildTerraJarticBoundingBoxQuery,
  },
  {
    layerId: 'wzdx_wsdot',
    label: 'Work Zones (WSDOT WZDx — Washington State)',
    unitNoun: 'event',
    refreshMs: 60_000,
    coverageRegionLabel: 'Washington State',
    hasCoverage: rect => terraCameraViewHasWzdxCoverage(rect, 'wzdx_wsdot'),
    buildQuery: rect => buildTerraWzdxBoundingBoxQuery(rect, 'wzdx_wsdot'),
  },
  {
    layerId: 'wzdx_iowa_dot',
    label: 'Work Zones (Iowa DOT WZDx — Iowa)',
    unitNoun: 'event',
    refreshMs: 60_000,
    coverageRegionLabel: 'Iowa',
    hasCoverage: rect => terraCameraViewHasWzdxCoverage(rect, 'wzdx_iowa_dot'),
    buildQuery: rect => buildTerraWzdxBoundingBoxQuery(rect, 'wzdx_iowa_dot'),
  },
  {
    layerId: 'wzdx_kytc',
    label: 'Work Zones (KYTC WZDx — Kentucky)',
    unitNoun: 'event',
    refreshMs: 5 * 60 * 1000,
    coverageRegionLabel: 'Kentucky',
    hasCoverage: rect => terraCameraViewHasWzdxCoverage(rect, 'wzdx_kytc'),
    buildQuery: rect => buildTerraWzdxBoundingBoxQuery(rect, 'wzdx_kytc'),
  },
]
