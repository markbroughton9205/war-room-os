import { pathToFileURL } from 'node:url'
import { fetchTerraLiveIntel } from './fetchLiveIntel'
import { listMaritimeLiveProviderStatuses, stripLiveIntelSecrets } from './liveGeoIntelligence'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'LIVE'): CaseResult {
  return { name, pass, detail, proof }
}

export async function runLiveGeoIntelligenceLiveAcceptance(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const snapshot = await fetchTerraLiveIntel({
    requestedBy: 'trusted_internal_test',
    bbox: '59.0,24.0,60.5,26.0',
    layers: ['vessels', 'intelligence_events', 'settlement_events'],
  })
  const vessels = snapshot.objects.filter(object => object.layer === 'vessels')
  const intel = snapshot.objects.filter(object => object.layer === 'intelligence_events')
  const digitraffic = snapshot.providers.find(row => row.id === 'digitraffic_marine')
  const barents = snapshot.providers.find(row => row.id === 'barentswatch_ais')
  const aisstream = snapshot.providers.find(row => row.id === 'aisstream')
  const aishub = snapshot.providers.find(row => row.id === 'aishub_marine')
  const noaa = snapshot.providers.find(row => row.id === 'noaa_access_ais')
  const serialized = JSON.stringify(stripLiveIntelSecrets(snapshot))

  cases.push(check(
    'live12_01_digitraffic_layer_present',
    Boolean(digitraffic && digitraffic.implemented && digitraffic.configurationState === 'ENABLED'),
    JSON.stringify({ digitraffic }),
  ))
  cases.push(check(
    'live12_02_real_vessels_or_honest_empty',
    (digitraffic?.freshness === 'LIVE' || digitraffic?.freshness === 'CACHED')
      ? vessels.length >= 1 && vessels.every(v => Number.isFinite(v.latitude) && Number.isFinite(v.longitude) && v.provider === 'digitraffic_marine')
      : digitraffic?.freshness === 'EMPTY',
    JSON.stringify({
      freshness: digitraffic?.freshness,
      count: vessels.length,
      sample: vessels[0] ? { id: vessels[0].id, lat: vessels[0].latitude, lon: vessels[0].longitude, observedAt: vessels[0].observedAt, freshness: vessels[0].freshness } : null,
    }),
  ))
  cases.push(check(
    'live12_03_vessel_provenance',
    vessels.length === 0 || Boolean(vessels[0]?.provider && vessels[0]?.receivedAt && vessels[0]?.evidenceId && vessels[0]?.sourceUrl),
    JSON.stringify(vessels[0] ? { provider: vessels[0].provider, receivedAt: vessels[0].receivedAt, evidenceId: vessels[0].evidenceId, sourceUrl: vessels[0].sourceUrl } : { skipped: true }),
  ))
  cases.push(check(
    'live12_04_second_category_if_real',
    intel.length === 0 || intel.every(item => item.layer === 'intelligence_events' && Number.isFinite(item.latitude)),
    JSON.stringify({ intelCount: intel.length, sample: intel[0] ? { id: intel[0].id, provider: intel[0].provider, freshness: intel[0].freshness } : null }),
  ))
  cases.push(check(
    'live12_05_unconfigured_ais_not_live',
    barents?.freshness === 'NEEDS_CREDENTIALS'
      && aisstream?.freshness === 'NEEDS_CREDENTIALS'
      && aishub?.freshness === 'NEEDS_CREDENTIALS'
      && noaa?.freshness === 'HISTORICAL',
    JSON.stringify({
      barents: barents?.freshness,
      aisstream: aisstream?.freshness,
      aishub: aishub?.freshness,
      noaa: noaa?.freshness,
      registry: listMaritimeLiveProviderStatuses().map(row => ({ id: row.id, freshness: row.freshness })),
    }),
  ))
  cases.push(check(
    'live12_06_no_secrets_in_snapshot',
    !/Bearer\s+\S+|sk-[A-Za-z0-9]+|xai-[A-Za-z0-9]+|AIza[A-Za-z0-9_\-]+|commanderUserId/i.test(serialized),
    `bytes=${serialized.length}`,
  ))
  const catcher = snapshot.providers.find(row => row.id === 'ais_catcher_own_sensor')
  const commercial = snapshot.providers.find(row => row.id === 'commercial_satellite_ais')
  const vesselsLayer = snapshot.layers.find(row => row.id === 'vessels')
  cases.push(check(
    'live12_08_vessels_layer_not_unavailable_when_digitraffic_works',
    vesselsLayer?.freshness !== 'UNAVAILABLE'
      && (digitraffic?.freshness === 'LIVE' || digitraffic?.freshness === 'CACHED' || digitraffic?.freshness === 'EMPTY'),
    JSON.stringify({ layer: vesselsLayer?.freshness, digitraffic: digitraffic?.freshness, count: vessels.length }),
  ))
  cases.push(check(
    'live12_09_own_sensor_and_commercial_are_precise',
    catcher?.freshness === 'NEEDS_LOCAL_SENSOR' && commercial?.freshness === 'NEEDS_COMMERCIAL_ACCOUNT',
    JSON.stringify({ catcher: catcher?.freshness, commercial: commercial?.freshness }),
  ))
  const pacific = await fetchTerraLiveIntel({
    requestedBy: 'trusted_internal_test',
    bbox: '10.0,-160.0,11.0,-159.0',
    layers: ['vessels'],
  })
  const pacificDigitraffic = pacific.providers.find(row => row.id === 'digitraffic_marine')
  const pacificLayer = pacific.layers.find(row => row.id === 'vessels')
  cases.push(check(
    'live12_10_pacific_is_no_coverage_not_unavailable',
    pacificDigitraffic?.freshness === 'NO_COVERAGE'
      && pacificLayer?.freshness !== 'UNAVAILABLE'
      && pacific.objects.filter(object => object.layer === 'vessels').length === 0,
    JSON.stringify({ provider: pacificDigitraffic?.freshness, layer: pacificLayer?.freshness, count: pacific.objects.length }),
  ))
  const inland = await fetchTerraLiveIntel({
    requestedBy: 'trusted_internal_test',
    bbox: '64.2,25.4,64.3,25.5',
    layers: ['vessels'],
  })
  const inlandDigitraffic = inland.providers.find(row => row.id === 'digitraffic_marine')
  cases.push(check(
    'live12_11_inland_empty_or_live_never_unavailable',
    inlandDigitraffic?.freshness === 'EMPTY'
      || inlandDigitraffic?.freshness === 'LIVE'
      || inlandDigitraffic?.freshness === 'CACHED',
    JSON.stringify({ freshness: inlandDigitraffic?.freshness, count: inland.objects.length, error: inland.providers.find(row => row.id === 'digitraffic_marine')?.reason }),
  ))
  cases.push(check(
    'live12_07_settlement_not_fabricated',
    snapshot.objects.every(object => object.layer !== 'settlement_events')
      && snapshot.providers.find(row => row.id === 'settlement_intelligence')?.freshness !== 'LIVE',
    JSON.stringify(snapshot.layers.find(layer => layer.id === 'settlement_events')),
  ))

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cases = await runLiveGeoIntelligenceLiveAcceptance()
  const failed = cases.filter(item => !item.pass)
  for (const item of cases) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} [${item.proof}] ${item.detail}`)
  }
  console.log(`Terra live geo intelligence live acceptance: ${cases.length - failed.length}/${cases.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
