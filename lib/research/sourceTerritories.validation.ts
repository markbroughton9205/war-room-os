import { pathToFileURL } from 'node:url'
import {
  googleNewsLocaleForRegion,
  primaryProviderIdsForRegion,
  regionHasPrimaryPublicEndpoint,
  SOURCE_TERRITORIES,
  territoriesForRegion,
} from './sourceTerritories'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

export function runSourceTerritoryValidation(): CaseResult[] {
  const cases: CaseResult[] = []
  const required = ['NORTH_AMERICA', 'EAST_ASIA', 'EUROPE'] as const
  for (const region of required) {
    const territories = territoriesForRegion(region)
    cases.push(check(
      `territory_01_${region}_declared`,
      territories.length > 0 && territories.every(item => item.liveAvailable === true || item.liveAvailable === false),
      territories.map(item => `${item.id}:${item.queryCapability}:${item.liveAvailable}`).join(','),
    ))
  }
  cases.push(check(
    'territory_02_na_has_federal_register',
    primaryProviderIdsForRegion('NORTH_AMERICA').includes('federal_register'),
    primaryProviderIdsForRegion('NORTH_AMERICA').join(','),
  ))
  cases.push(check(
    'territory_03_east_asia_locale_is_ja',
    googleNewsLocaleForRegion('EAST_ASIA').queryLanguage === 'ja' && googleNewsLocaleForRegion('EAST_ASIA').gl === 'JP',
    JSON.stringify(googleNewsLocaleForRegion('EAST_ASIA')),
  ))
  cases.push(check(
    'territory_04_europe_locale_differs_from_us',
    googleNewsLocaleForRegion('EUROPE').gl !== 'US' && googleNewsLocaleForRegion('NORTH_AMERICA').gl === 'US',
    `${googleNewsLocaleForRegion('EUROPE').gl} vs ${googleNewsLocaleForRegion('NORTH_AMERICA').gl}`,
  ))
  cases.push(check(
    'territory_05_catalog_does_not_invent_unsupported_live',
    SOURCE_TERRITORIES.every(item => item.queryCapability !== 'unsupported' || item.liveAvailable === false),
    String(SOURCE_TERRITORIES.length),
  ))
  cases.push(check('territory_06_required_regions_have_primary_or_honest_gap', required.every(region => regionHasPrimaryPublicEndpoint(region) || territoriesForRegion(region).some(item => item.queryCapability === 'rss_feed')), 'ok'))
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runSourceTerritoryValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  if (results.some(item => !item.pass)) process.exit(1)
}
