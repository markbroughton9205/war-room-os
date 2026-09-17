/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/geographicContext.validation.ts
 */
import { pathToFileURL } from 'node:url'
import {
  compactLocalLabel,
  contextMovedMaterially,
  isDeviceOnlyPlaceLabel,
  significantPlaceTokens,
} from './geographicContext'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check(
    'akron_compact_label',
    compactLocalLabel({ city: 'Akron', state: 'Ohio', countryCode: 'US' }) === 'AKRON, OH',
    compactLocalLabel({ city: 'Akron', state: 'Ohio', countryCode: 'US' }) ?? 'none',
  ))
  results.push(check(
    'beulah_compact_label',
    compactLocalLabel({ city: 'Beulah', state: 'Maryland', countryCode: 'US' }) === 'BEULAH, MD',
    compactLocalLabel({ city: 'Beulah', state: 'Maryland', countryCode: 'US' }) ?? 'none',
  ))
  results.push(check(
    'tokyo_compact_label',
    compactLocalLabel({ city: 'Tokyo', countryCode: 'JP' }) === 'TOKYO',
    compactLocalLabel({ city: 'Tokyo', countryCode: 'JP' }) ?? 'none',
  ))
  results.push(check(
    'tokyo_prefecture_state_is_not_abbrev',
    compactLocalLabel({ city: 'Tokyo', state: '東京都', countryCode: 'JP' }) === 'TOKYO',
    compactLocalLabel({ city: 'Tokyo', state: '東京都', countryCode: 'JP' }) ?? 'none',
  ))
  results.push(check(
    'gps_label_is_device_only',
    isDeviceOnlyPlaceLabel('GPS ±12 m') && isDeviceOnlyPlaceLabel('38.4500°, -75.9300°') && !isDeviceOnlyPlaceLabel('Akron, Ohio'),
    'device vs place',
  ))
  results.push(check(
    'stopwords_dropped',
    significantPlaceTokens('Beulah, Dorchester County, Maryland').join(',') === 'beulah,dorchester,maryland',
    significantPlaceTokens('Beulah, Dorchester County, Maryland').join(','),
  ))
  results.push(check(
    'city_move_is_material',
    contextMovedMaterially({ lat: 41.08, lon: -81.52, zoomLevel: 'CITY' }, { lat: 41.5, lon: -81.7, zoomLevel: 'CITY' })
      && !contextMovedMaterially({ lat: 41.08, lon: -81.52, zoomLevel: 'CITY' }, { lat: 41.081, lon: -81.521, zoomLevel: 'CITY' }),
    'cleveland vs jitter',
  ))
  return results
}

export function runGeographicContextValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Geographic context: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
