import { pathToFileURL } from 'node:url'
import { parseLocalContext } from './context'
import { matchLocalSources, classifyAreaCoverage } from './match'
import { qualifyLocalStory } from './qualify'
import { TERRA_LOCAL_SOURCE_SEEDS } from './registry'
import { loadTerraLocalIntel } from './fetch'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const akron = parseLocalContext({ latitude: 41.0814, longitude: -81.519, place: 'Akron, Summit County, Ohio, United States' })
  const cleveland = parseLocalContext({ latitude: 41.4993, longitude: -81.6944, place: 'Cleveland, Cuyahoga County, Ohio, United States' })
  const nyc = parseLocalContext({ latitude: 40.7128, longitude: -74.006, place: 'New York, New York, United States' })
  const london = parseLocalContext({ latitude: 51.5074, longitude: -0.1278, place: 'London, England, United Kingdom' })
  const tokyo = parseLocalContext({ latitude: 35.676, longitude: 139.65, place: 'Tokyo, Japan' })
  const capeTown = parseLocalContext({ latitude: -33.9249, longitude: 18.4241, place: 'Cape Town, Western Cape, South Africa' })
  const holmes = parseLocalContext({ latitude: 40.5545, longitude: -81.9168, place: 'Holmes County, Ohio, United States' })

  results.push(check('akron_short_label', akron.shortLabel === 'AKRON, OH' && akron.city === 'Akron' && akron.county === 'Summit County' && akron.metro === 'Akron', `${akron.shortLabel}|${akron.city}|${akron.metro}`))
  results.push(check('tokyo_is_city_not_country_local', tokyo.city === 'Tokyo' && tokyo.countryCode === 'JP', `${tokyo.city}|${tokyo.countryCode}`))
  results.push(check('cape_town_city', capeTown.city === 'Cape Town' && capeTown.countryCode === 'ZA', `${capeTown.city}|${capeTown.countryCode}`))
  results.push(check('holmes_county_label', holmes.shortLabel === 'HOLMES COUNTY, OH' && holmes.city == null && holmes.county === 'Holmes County', `${holmes.shortLabel}|${holmes.city}|${holmes.county}`))

  const holmesReverse = parseLocalContext({
    latitude: 40.5612,
    longitude: -81.9188,
    place: 'Hardy Township, Holmes County, Ohio, United States',
    city: null,
    county: 'Holmes County',
    state: 'Ohio',
    country: 'United States',
    countryCode: 'US',
  })
  results.push(check(
    'holmes_reverse_township_does_not_become_local_city',
    holmesReverse.city == null && holmesReverse.county === 'Holmes County' && holmesReverse.shortLabel === 'HOLMES COUNTY, OH',
    `${holmesReverse.city}|${holmesReverse.county}|${holmesReverse.shortLabel}`,
  ))

  const tokyoReverse = parseLocalContext({
    latitude: 35.6762,
    longitude: 139.6503,
    place: '千代田区, 東京都, Japan',
    city: null,
    state: '東京都',
    country: 'Japan',
    countryCode: 'JP',
  })
  results.push(check(
    'tokyo_reverse_ward_promotes_to_tokyo_city',
    tokyoReverse.city === 'Tokyo' && tokyoReverse.countryCode === 'JP' && tokyoReverse.shortLabel === 'TOKYO',
    `${tokyoReverse.city}|${tokyoReverse.shortLabel}`,
  ))

  const akronSources = matchLocalSources(akron)
  results.push(check(
    'akron_prefers_metro_not_us_national',
    akronSources.some(source => source.id === 'us-oh-wkyc') && akronSources.some(source => source.id === 'us-oh-akron-city') && !akronSources.some(source => source.countryCode !== 'US'),
    akronSources.map(source => `${source.id}:${source.matchLevel}`).join(','),
  ))
  results.push(check('cleveland_has_tv', matchLocalSources(cleveland).some(source => source.type === 'TV' && (source.matchLevel === 'CITY' || source.metro === 'Cleveland')), matchLocalSources(cleveland).map(source => source.id).join(',')))
  results.push(check('nyc_has_city_tv', matchLocalSources(nyc).some(source => source.id === 'us-nyc-abc7'), matchLocalSources(nyc).map(source => source.id).join(',')))
  results.push(check('london_has_bbc_london', matchLocalSources(london).some(source => source.id === 'uk-london-bbc'), matchLocalSources(london).map(source => source.id).join(',')))
  results.push(check('cape_town_has_city_paper', matchLocalSources(capeTown).some(source => source.id === 'za-cape-town-etc'), matchLocalSources(capeTown).map(source => source.id).join(',')))
  results.push(check(
    'tokyo_does_not_claim_nhk_national_as_city_tv',
    !matchLocalSources(tokyo).some(source => /nhk/i.test(source.id)) && matchLocalSources(tokyo).some(source => source.id === 'jp-tokyo-metro'),
    matchLocalSources(tokyo).map(source => source.id).join(',') || 'none',
  ))
  results.push(check(
    'holmes_does_not_inherit_cleveland_tv',
    !matchLocalSources(holmes).some(source => source.id === 'us-oh-wkyc' || source.id === 'us-oh-fox8') && matchLocalSources(holmes).some(source => source.id === 'us-oh-holmes-herald'),
    matchLocalSources(holmes).map(source => `${source.id}:${source.matchLevel}`).join(',') || 'none',
  ))
  const failedRuntime = akronSources.slice(0, 3).map(source => ({
    source,
    health: 'UNAVAILABLE' as const,
    usability: 'UNAVAILABLE' as const,
    itemCount: 0,
    qualifiedCount: 0,
    rejectedCount: 0,
    newestPublishedAt: null,
    error: 'probe failed',
  }))
  results.push(check(
    'seed_active_does_not_inflate_coverage_when_runtime_failed',
    classifyAreaCoverage(akronSources, failedRuntime) === 'NO_COVERAGE' && akronSources.some(source => source.status === 'ACTIVE'),
    classifyAreaCoverage(akronSources, failedRuntime),
  ))

  const wkyc = TERRA_LOCAL_SOURCE_SEEDS.find(source => source.id === 'us-oh-wkyc')!
  results.push(check(
    'france_story_rejected_for_akron',
    qualifyLocalStory({ title: 'Protests continue in France', summary: 'Crowds gathered in Paris.', context: akron, source: { ...wkyc, matchLevel: 'METRO', matchReason: 'test' } }).qualified === false,
    qualifyLocalStory({ title: 'Protests continue in France', summary: 'Crowds gathered in Paris.', context: akron, source: { ...wkyc, matchLevel: 'METRO', matchReason: 'test' } }).reason,
  ))
  results.push(check(
    'akron_council_story_accepted',
    qualifyLocalStory({ title: 'Akron City Council approves road repairs', summary: 'Summit County officials attended.', context: akron, source: { ...wkyc, matchLevel: 'METRO', matchReason: 'test' } }).qualified === true,
    qualifyLocalStory({ title: 'Akron City Council approves road repairs', summary: 'Summit County officials attended.', context: akron, source: { ...wkyc, matchLevel: 'METRO', matchReason: 'test' } }).relevance ?? 'none',
  ))
  results.push(check(
    'cleveland_only_story_rejected_for_akron',
    qualifyLocalStory({ title: 'Cleveland City Council votes on downtown parking', summary: 'Cuyahoga County officials met at City Hall.', context: akron, source: { ...wkyc, matchLevel: 'METRO', matchReason: 'test' } }).qualified === false,
    qualifyLocalStory({ title: 'Cleveland City Council votes on downtown parking', summary: 'Cuyahoga County officials met at City Hall.', context: akron, source: { ...wkyc, matchLevel: 'METRO', matchReason: 'test' } }).reason,
  ))
  results.push(check(
    'ohio_only_story_rejected_for_akron_metro_tv',
    qualifyLocalStory({ title: 'Ohio seniors lost more than $160 million to fraud', summary: 'Statewide figures released by the FBI.', context: akron, source: { ...wkyc, matchLevel: 'METRO', matchReason: 'test' } }).qualified === false,
    qualifyLocalStory({ title: 'Ohio seniors lost more than $160 million to fraud', summary: 'Statewide figures released by the FBI.', context: akron, source: { ...wkyc, matchLevel: 'METRO', matchReason: 'test' } }).reason,
  ))
  const tokyoMetro = TERRA_LOCAL_SOURCE_SEEDS.find(source => source.id === 'jp-tokyo-metro')!
  results.push(check(
    'tokyo_native_name_qualifies',
    qualifyLocalStory({ title: '東京メトロ×シャープ混雑状況に応じた床面投影実証を北千住駅で開始', summary: null, geography: '東京都', context: tokyo, source: { ...tokyoMetro, matchLevel: 'CITY', matchReason: 'test' } }).qualified === true,
    qualifyLocalStory({ title: '東京メトロ×シャープ混雑状況に応じた床面投影実証を北千住駅で開始', summary: null, geography: '東京都', context: tokyo, source: { ...tokyoMetro, matchLevel: 'CITY', matchReason: 'test' } }).reason,
  ))
  const capeEtc = TERRA_LOCAL_SOURCE_SEEDS.find(source => source.id === 'za-cape-town-etc')!
  results.push(check(
    'cape_town_publisher_boilerplate_rejected',
    qualifyLocalStory({
      title: 'Ramaphosa booked off ahead of scheduled parliamentary appearance',
      summary: 'The post Ramaphosa booked off appeared first on Cape Town ETC.',
      context: capeTown,
      source: { ...capeEtc, matchLevel: 'CITY', matchReason: 'test' },
    }).qualified === false,
    qualifyLocalStory({
      title: 'Ramaphosa booked off ahead of scheduled parliamentary appearance',
      summary: 'The post Ramaphosa booked off appeared first on Cape Town ETC.',
      context: capeTown,
      source: { ...capeEtc, matchLevel: 'CITY', matchReason: 'test' },
    }).reason,
  ))
  return results
}

function clusterKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

async function liveProbe(): Promise<CaseResult[]> {
  const locations = [
    { name: 'Akron', latitude: 41.0814, longitude: -81.519, place: 'Akron, Summit County, Ohio, United States' },
    { name: 'Cleveland', latitude: 41.4993, longitude: -81.6944, place: 'Cleveland, Cuyahoga County, Ohio, United States' },
    { name: 'New York City', latitude: 40.7128, longitude: -74.006, place: 'New York, New York, United States' },
    { name: 'London', latitude: 51.5074, longitude: -0.1278, place: 'London, England, United Kingdom' },
    { name: 'Tokyo', latitude: 35.676, longitude: 139.65, place: 'Tokyo, Japan' },
    { name: 'Cape Town', latitude: -33.9249, longitude: 18.4241, place: 'Cape Town, Western Cape, South Africa' },
    { name: 'Holmes County', latitude: 40.5545, longitude: -81.9168, place: 'Holmes County, Ohio, United States' },
    { name: 'Los Angeles', latitude: 34.0522, longitude: -118.2437, place: 'Los Angeles, Los Angeles County, California, United States' },
    { name: 'Chicago', latitude: 41.8781, longitude: -87.6298, place: 'Chicago, Cook County, Illinois, United States' },
    { name: 'Miami', latitude: 25.7617, longitude: -80.1918, place: 'Miami, Miami-Dade County, Florida, United States' },
    { name: 'Toronto', latitude: 43.6532, longitude: -79.3832, place: 'Toronto, Ontario, Canada' },
    { name: 'Paris', latitude: 48.8566, longitude: 2.3522, place: 'Paris, Île-de-France, France' },
    { name: 'Sydney', latitude: -33.8688, longitude: 151.2093, place: 'Sydney, New South Wales, Australia' },
  ]
  const results: CaseResult[] = []
  for (const location of locations) {
    const report = await loadTerraLocalIntel({ ...location, now: new Date().toISOString() })
    const discovered = report.matchedSources.length
    const verified = report.matchedSources.filter(source => source.status === 'ACTIVE' || source.status === 'STALE').length
    const feedsActive = report.sourceRuntime.filter(row => row.health === 'ACTIVE' || row.health === 'STALE').length
    const failed = report.sourceRuntime.filter(row => row.health !== 'ACTIVE' && row.health !== 'STALE' && row.source.feedType !== 'NONE')
    const blocked = report.sourceRuntime.filter(row => row.health === 'BLOCKED')
    const types = [...new Set(report.sourceRuntime.filter(row => row.health === 'ACTIVE' || row.health === 'STALE').map(row => row.source.type))]
    const keys = report.qualified.map(item => clusterKey(item.title)).filter(Boolean)
    const clusters = new Set(keys)
    const coverage = classifyAreaCoverage(report.matchedSources, report.sourceRuntime)
    results.push(check(
      `live:${location.name}`,
      true,
      [
        `label=${report.context.shortLabel}`,
        `discovered=${discovered}`,
        `verified=${verified}`,
        `feeds_active=${feedsActive}`,
        `matched=${report.qualified.length}`,
        `rejected=${report.rejected.length}`,
        `coverage=${coverage}`,
        `health=${report.health}`,
        `types=${types.join('|') || 'none'}`,
        `failed=${failed.map(row => `${row.source.id}:${row.health}`).join('|') || 'none'}`,
        `blocked=${blocked.map(row => row.source.id).join('|') || 'none'}`,
        `dedupe_raw=${report.qualified.length}`,
        `dedupe_clusters=${clusters.size}`,
        `ids=${report.matchedSources.map(source => source.id).join(',') || 'none'}`,
      ].join(' '),
    ))
  }
  return results
}

export function runLocalSourceValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`Terra local sources: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  const live = await liveProbe()
  for (const result of live) {
    console.log(`LIVE ${result.name} ${result.detail}`)
  }
  if (failed.length) process.exit(1)
}
