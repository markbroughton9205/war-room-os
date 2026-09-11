/**
 * Live Overpass acceptance for Terra urban geography — Akron, Ohio and Helsinki, Finland.
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/urbanDetail/live-acceptance.ts
 *
 * Hits the public Overpass interpreter once per city with a neighborhood bbox. Does not go through
 * the Commander-session API (that is exercised in the browser). Failures are reported honestly;
 * this never fabricates buildings.
 */
import { pathToFileURL } from 'node:url'
import { normalizeOverpassUrbanGeometry, type OverpassResponse } from './normalize'
import { buildUrbanOverpassQuery } from './query'
import { isHouseBuildingType } from './lod'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'LIVE'): CaseResult {
  return { name, pass, detail, proof }
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

async function queryOverpass(south: number, west: number, north: number, east: number) {
  const query = buildUrbanOverpassQuery({ south, west, north, east }, 'building')
  const started = Date.now()
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'WarRoomTerraUrbanLiveAcceptance/1.0',
    },
    body: `data=${encodeURIComponent(query)}`,
  })
  const text = await response.text()
  const durationMs = Date.now() - started
  if (!response.ok) {
    return { ok: false as const, status: response.status, durationMs, message: text.slice(0, 240) }
  }
  const parsed = JSON.parse(text) as OverpassResponse
  return { ok: true as const, durationMs, parsed }
}

export async function runUrbanDetailLiveAcceptance(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const akron = await queryOverpass(41.076, -81.526, 41.087, -81.512)
  if (!akron.ok) {
    cases.push(check('akron_overpass_reachable', false, JSON.stringify(akron), 'LIVE'))
    return cases
  }
  const akronGeometry = normalizeOverpassUrbanGeometry(akron.parsed, 'building')
  cases.push(check('akron_overpass_ok', true, `ms=${akron.durationMs}`, 'LIVE'))
  cases.push(check('akron_has_roads', akronGeometry.roads.length > 0, `roads=${akronGeometry.roads.length}`, 'LIVE'))
  cases.push(check('akron_has_buildings', akronGeometry.buildings.length > 0, `buildings=${akronGeometry.buildings.length}`, 'LIVE'))
  cases.push(check(
    'akron_has_houses_or_residential',
    akronGeometry.buildings.some(building => isHouseBuildingType(building.buildingType)),
    `houses=${akronGeometry.buildings.filter(building => isHouseBuildingType(building.buildingType)).length}`,
    'LIVE',
  ))
  cases.push(check(
    'akron_height_truth_present',
    akronGeometry.buildings.every(building => building.heightSource === 'SOURCE' || building.heightSource === 'INFERRED'),
    JSON.stringify({
      source: akronGeometry.buildings.filter(building => building.heightSource === 'SOURCE').length,
      inferred: akronGeometry.buildings.filter(building => building.heightSource === 'INFERRED').length,
    }),
    'LIVE',
  ))

  const helsinki = await queryOverpass(60.160, 24.930, 60.175, 24.955)
  if (!helsinki.ok) {
    cases.push(check('helsinki_overpass_reachable', false, JSON.stringify(helsinki), 'LIVE'))
    return cases
  }
  const helsinkiGeometry = normalizeOverpassUrbanGeometry(helsinki.parsed, 'building')
  cases.push(check('helsinki_overpass_ok', true, `ms=${helsinki.durationMs}`, 'LIVE'))
  cases.push(check('helsinki_has_dense_buildings', helsinkiGeometry.buildings.length > 20, `buildings=${helsinkiGeometry.buildings.length}`, 'LIVE'))
  cases.push(check('helsinki_has_roads', helsinkiGeometry.roads.length > 0, `roads=${helsinkiGeometry.roads.length}`, 'LIVE'))
  cases.push(check('no_fake_coordinates_outside_bbox', helsinkiGeometry.buildings.every(building => building.latitude >= 60.15 && building.latitude <= 60.19 && building.longitude >= 24.92 && building.longitude <= 24.97), 'bbox'))
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runUrbanDetailLiveAcceptance()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Terra urbanDetail live acceptance: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
