import { pathToFileURL } from 'node:url'
import { filterMediaStations } from '../browse'
import { getFederatedStations, assertFederatedStationIdsUnique, assertNoFakeIheartStreams } from '../federation'
import { getIheartCatalogStations, iheartMarkets } from './catalog'
import { inferPlaybackMode, inferSourceFamily } from '../sourceFamily'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

export function runIheartFederationValidation(): CaseResult[] {
  const results: CaseResult[] = []
  const catalog = getIheartCatalogStations()
  const federated = getFederatedStations()
  const iheart = federated.filter(station => inferSourceFamily(station) === 'iheart')
  const markets = iheartMarkets(iheart)

  results.push(check('iheart_catalog_has_multiple_stations', catalog.length >= 5, String(catalog.length)))
  results.push(check(
    'iheart_akron_examples',
    iheart.some(station => /kdd|wkdd/i.test(`${station.id} ${station.callSign} ${station.name}`))
      && iheart.some(station => /whlo/i.test(`${station.id} ${station.callSign}`))
      && iheart.some(station => /akron/i.test(station.city)),
    iheart.filter(station => /akron/i.test(station.city)).map(station => station.callSign).join(','),
  ))
  results.push(check(
    'iheart_non_akron_markets',
    iheart.some(station => /los angeles/i.test(station.city)) && iheart.some(station => /new york/i.test(station.city)),
    markets.join(' | '),
  ))
  results.push(check('iheart_markets_include_ohio_and_beyond', markets.length >= 3, markets.join(' | ')))
  results.push(check(
    'iheart_playback_mode_is_official_page',
    iheart.every(station => inferPlaybackMode(station) === 'OFFICIAL_PAGE' && station.sourceClass === 'LINK_OUT' && !station.streamUrl),
    iheart.map(station => `${station.id}:${inferPlaybackMode(station)}`).join(','),
  ))
  results.push(check(
    'iheart_no_revma_stream_pin',
    iheart.every(station => !station.streamUrl && !(station.embedUrl ?? '').includes('revma.ihrhls.com')),
    'no fake streams',
  ))
  try {
    assertFederatedStationIdsUnique(federated)
    results.push(check('federated_ids_unique', true, String(federated.length)))
  } catch (error) {
    results.push(check('federated_ids_unique', false, error instanceof Error ? error.message : 'dup'))
  }
  try {
    assertNoFakeIheartStreams(federated)
    results.push(check('no_fake_iheart_streams', true, 'ok'))
  } catch (error) {
    results.push(check('no_fake_iheart_streams', false, error instanceof Error ? error.message : 'fail'))
  }
  results.push(check(
    'unified_registry_includes_direct_and_iheart',
    federated.some(station => station.id === 'oh-waps') && federated.some(station => station.id === 'iheart-wkdd'),
    String(federated.length),
  ))
  const akronLocal = filterMediaStations({
    stations: federated,
    geo: 'local',
    location: { city: 'Akron', state: 'OH', label: 'Akron, OH' },
  })
  results.push(check(
    'local_akron_includes_waps_and_iheart',
    akronLocal.some(station => station.id === 'oh-waps') && akronLocal.some(station => station.id === 'iheart-wkdd'),
    akronLocal.map(station => station.id).join(','),
  ))
  const laLocal = filterMediaStations({
    stations: federated,
    geo: 'local',
    source: 'iheart',
    location: { city: 'Los Angeles', state: 'CA', label: 'Los Angeles, CA' },
  })
  results.push(check(
    'local_la_iheart_is_non_akron',
    laLocal.some(station => station.id === 'iheart-kiis') && !laLocal.some(station => /akron/i.test(station.city)),
    laLocal.map(station => station.id).join(','),
  ))
  const searchKdd = filterMediaStations({ stations: federated, search: 'kdd', geo: 'global' })
  results.push(check('search_matches_callsign_or_name', searchKdd.some(station => station.id === 'iheart-wkdd'), searchKdd.map(station => station.id).join(',')))
  const iheartOnly = filterMediaStations({ stations: federated, source: 'iheart', geo: 'global' })
  results.push(check('iheart_source_filter', iheartOnly.length >= 5 && iheartOnly.every(station => inferSourceFamily(station) === 'iheart'), String(iheartOnly.length)))
  const wtam = federated.find(station => station.id === 'oh-wtam')
  results.push(check(
    'existing_ohio_iheart_stations_keep_one_id',
    Boolean(wtam && inferSourceFamily(wtam) === 'iheart' && !federated.some(station => station.id !== 'oh-wtam' && station.callSign === 'WTAM')),
    wtam?.id ?? 'missing',
  ))
  return results
}

const isDirect = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
if (isDirect) {
  const results = runIheartFederationValidation()
  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.pass ? '' : ` — ${item.detail}`}`)
  }
  console.log(`iHeart federation validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
