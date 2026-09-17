/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/searchJurisdiction.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { TerraActiveLocation } from './activeLocation'
import {
  enrichSearchWithReverse,
  isSublocalityName,
  promoteMeaningfulAdmin,
  selectedJurisdictionFromSearch,
} from './searchJurisdiction'
import { parseLocalContext } from './localSources/context'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function location(overrides: Partial<TerraActiveLocation>): TerraActiveLocation {
  return {
    latitude: 35.68,
    longitude: 139.76,
    height: null,
    hasTerrainHeight: false,
    label: '東京都 / Tokyo',
    place: '東京都 / Tokyo',
    address: null,
    region: null,
    source: 'nominatim',
    sourceLabel: 'OpenStreetMap Nominatim',
    sourceUrl: null,
    nativePlaceName: '東京都',
    englishPlaceName: 'Tokyo',
    status: 'resolved',
    confidence: 'provider_supported',
    detail: 'search',
    selectedAt: '2026-09-17T00:00:00.000Z',
    contextType: 'SEARCH',
    city: 'Tokyo',
    county: null,
    state: null,
    country: 'Japan',
    countryCode: 'JP',
    searchQuery: 'Tokyo, Japan',
    jurisdictionType: 'city',
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const tokyo = selectedJurisdictionFromSearch({
    query: 'Tokyo, Japan',
    label: '東京都 / Tokyo',
    latitude: 35.6762,
    longitude: 139.6503,
    nativeName: '東京都',
    englishName: 'Tokyo',
  })
  results.push(check(
    'tokyo_search_is_city_tokyo',
    tokyo.city === 'Tokyo' && tokyo.countryCode === 'JP' && tokyo.jurisdictionType === 'city',
    `${tokyo.city}|${tokyo.countryCode}|${tokyo.jurisdictionType}`,
  ))

  const holmes = selectedJurisdictionFromSearch({
    query: 'Holmes County, Ohio',
    label: 'Holmes County',
    latitude: 40.5612,
    longitude: -81.9188,
  })
  results.push(check(
    'holmes_search_is_county_not_township',
    holmes.city == null && holmes.county === 'Holmes County' && holmes.state === 'Ohio' && holmes.jurisdictionType === 'county',
    `${holmes.city}|${holmes.county}|${holmes.state}|${holmes.jurisdictionType}`,
  ))

  const akron = selectedJurisdictionFromSearch({
    query: 'Akron, Ohio',
    label: '애크런 / Akron',
    latitude: 41.0814,
    longitude: -81.519,
    englishName: 'Akron',
  })
  results.push(check(
    'akron_search_is_city_akron',
    akron.city === 'Akron' && akron.state === 'Ohio' && akron.jurisdictionType === 'city',
    `${akron.city}|${akron.state}|${akron.jurisdictionType}`,
  ))

  const holmesVsTownshipLabel = selectedJurisdictionFromSearch({
    query: 'Holmes County, Ohio',
    label: 'Hardy Township, Holmes County, Ohio, United States',
    latitude: 40.5612,
    longitude: -81.9188,
  })
  results.push(check(
    'holmes_query_wins_over_township_label',
    holmesVsTownshipLabel.city == null && holmesVsTownshipLabel.county === 'Holmes County' && holmesVsTownshipLabel.jurisdictionType === 'county',
    `${holmesVsTownshipLabel.city}|${holmesVsTownshipLabel.county}|${holmesVsTownshipLabel.jurisdictionType}`,
  ))

  results.push(check('ward_is_sublocality', isSublocalityName('千代田区') && isSublocalityName('Chiyoda Ward'), 'jp ward'))
  results.push(check('township_is_sublocality', isSublocalityName('Hardy Township') && !isSublocalityName('Akron'), 'oh township'))

  const selectedTokyo = location({})
  const reverseTokyo = location({
    contextType: 'CLICK',
    city: null,
    locality: '千代田区',
    label: 'AED, 丸の内, 千代田区, 東京都',
    place: '千代田区',
    address: '丸の内, 千代田区',
  })
  const enrichedTokyo = enrichSearchWithReverse(selectedTokyo, reverseTokyo)
  results.push(check(
    'tokyo_reverse_does_not_replace_local_city',
    enrichedTokyo.city === 'Tokyo' && enrichedTokyo.reverseWard === '千代田区' && enrichedTokyo.reverseSublocalityLabel === '千代田区',
    `${enrichedTokyo.city}|${enrichedTokyo.reverseWard}`,
  ))

  const selectedHolmes = location({
    latitude: 40.56,
    longitude: -81.92,
    label: 'Holmes County',
    place: 'Holmes County',
    city: null,
    county: 'Holmes County',
    state: 'Ohio',
    country: 'United States',
    countryCode: 'US',
    searchQuery: 'Holmes County, Ohio',
    jurisdictionType: 'county',
    nativePlaceName: null,
    englishPlaceName: 'Holmes County',
  })
  const reverseHolmes = location({
    city: null,
    locality: 'Hardy Township',
    county: 'Holmes County',
    state: 'Ohio',
    label: 'Hardy Township, Holmes County, Ohio',
  })
  const enrichedHolmes = enrichSearchWithReverse(selectedHolmes, reverseHolmes)
  results.push(check(
    'holmes_reverse_does_not_replace_county',
    enrichedHolmes.city == null && enrichedHolmes.county === 'Holmes County' && enrichedHolmes.reverseTownship === 'Hardy Township',
    `${enrichedHolmes.city}|${enrichedHolmes.county}|${enrichedHolmes.reverseTownship}`,
  ))

  const clickedWard = promoteMeaningfulAdmin(location({
    contextType: 'CLICK',
    city: '千代田区',
    state: '東京都',
    country: 'Japan',
    countryCode: 'JP',
    searchQuery: null,
    jurisdictionType: null,
  }))
  results.push(check(
    'click_tokyo_ward_promotes_to_tokyo',
    clickedWard.city === 'Tokyo' && clickedWard.reverseWard === '千代田区',
    `${clickedWard.city}|${clickedWard.reverseWard}`,
  ))

  const clickedTownship = promoteMeaningfulAdmin(location({
    contextType: 'CAMERA',
    city: 'Hardy Township',
    county: 'Holmes County',
    state: 'Ohio',
    country: 'United States',
    countryCode: 'US',
    searchQuery: null,
  }))
  results.push(check(
    'click_township_promotes_to_county',
    clickedTownship.city == null && clickedTownship.county === 'Holmes County' && clickedTownship.reverseTownship === 'Hardy Township',
    `${clickedTownship.city}|${clickedTownship.county}|${clickedTownship.reverseTownship}`,
  ))

  const clickedAkron = promoteMeaningfulAdmin(location({
    contextType: 'CLICK',
    city: 'Akron',
    county: 'Summit County',
    state: 'Ohio',
    country: 'United States',
    countryCode: 'US',
    searchQuery: null,
  }))
  results.push(check(
    'click_akron_city_unchanged',
    clickedAkron.city === 'Akron' && clickedAkron.county === 'Summit County',
    `${clickedAkron.city}|${clickedAkron.county}`,
  ))

  const holmesReverseParse = parseLocalContext({
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
    'parse_does_not_resurrect_township_as_city',
    holmesReverseParse.city == null && holmesReverseParse.shortLabel === 'HOLMES COUNTY, OH',
    `${holmesReverseParse.city}|${holmesReverseParse.shortLabel}`,
  ))

  const tokyoReverseParse = parseLocalContext({
    latitude: 35.6762,
    longitude: 139.6503,
    place: '千代田区, 東京都, Japan',
    city: null,
    state: '東京都',
    country: 'Japan',
    countryCode: 'JP',
  })
  results.push(check(
    'parse_promotes_tokyo_prefecture_over_ward',
    tokyoReverseParse.city === 'Tokyo' && tokyoReverseParse.shortLabel === 'TOKYO',
    `${tokyoReverseParse.city}|${tokyoReverseParse.shortLabel}`,
  ))

  return results
}

export function runSearchJurisdictionValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Search jurisdiction: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
