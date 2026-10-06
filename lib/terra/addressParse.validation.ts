/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/addressParse.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { parseUsStyleAddress, structuredSearchFromParsedAddress } from './addressParse'
import { expandStreetSuffix } from './streetNameGuard'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const gold = parseUsStyleAddress('936 Springdale St, Akron, OH 44310')
  results.push(check('gold_house', gold?.houseNumber === '936', gold?.houseNumber ?? 'null'))
  results.push(check('gold_stem', gold?.streetStem === 'SPRINGDALE', gold?.streetStem ?? 'null'))
  results.push(check('gold_type_abbrev', gold?.streetTypeAbbrev === 'ST', gold?.streetTypeAbbrev ?? 'null'))
  results.push(check('gold_city', gold?.city === 'Akron', gold?.city ?? 'null'))
  results.push(check('gold_state', gold?.stateCode === 'OH', gold?.stateCode ?? 'null'))
  results.push(check('gold_zip', gold?.postcode === '44310', gold?.postcode ?? 'null'))
  const springdale = parseUsStyleAddress('932 Springdale St, Akron, OH 44310')
  results.push(check('springdale_parses_house', springdale?.houseNumber === '932', springdale?.houseNumber ?? 'null'))
  results.push(check('springdale_parses_street', springdale?.street === 'Springdale St', springdale?.street ?? 'null'))
  results.push(check('springdale_parses_city', springdale?.city === 'Akron', springdale?.city ?? 'null'))
  results.push(check('springdale_parses_state', springdale?.stateCode === 'OH', springdale?.stateCode ?? 'null'))
  results.push(check('springdale_parses_zip', springdale?.postcode === '44310', springdale?.postcode ?? 'null'))
  results.push(check('springdale_is_us', springdale?.countrycodes === 'us', String(springdale?.countrycodes)))
  const structured = springdale ? structuredSearchFromParsedAddress(springdale) : null
  results.push(check(
    'springdale_structured_expands_street',
    structured?.street === '932 Springdale Street' && structured.city === 'Akron' && structured.state === 'OH' && structured.postalcode === '44310' && structured.countrycodes === 'us',
    JSON.stringify(structured),
  ))
  results.push(check('suffix_expand_st', expandStreetSuffix('Springdale St') === 'Springdale Street', expandStreetSuffix('Springdale St')))
  const noComma = parseUsStyleAddress('932 Springdale St Akron OH 44310')
  results.push(check('no_comma_still_parses_city', noComma?.city === 'Akron' && noComma.street === 'Springdale St', JSON.stringify(noComma)))
  results.push(check('berlin_is_not_us_structured', parseUsStyleAddress('Berlin, Germany') === null, 'null'))
  results.push(check('barcelona_postcode_is_not_us', parseUsStyleAddress('Carrer de Mallorca 401, Barcelona 08008') === null, JSON.stringify(parseUsStyleAddress('Carrer de Mallorca 401, Barcelona 08008'))))
  results.push(check('madrid_is_not_us', parseUsStyleAddress('Calle Mayor 1, Madrid, Spain') === null, 'null'))
  results.push(check('helsinki_is_not_us', parseUsStyleAddress('Mannerheimintie 1, Helsinki, Finland') === null, 'null'))
  results.push(check('singapore_is_not_us', parseUsStyleAddress('Orchard Road, Singapore') === null, 'null'))
  results.push(check('quebec_on_is_not_us_state', parseUsStyleAddress('Rue Saint-Denis, Montréal, QC') === null, 'null'))
  return results
}

export function runAddressParseValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Address parse: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
