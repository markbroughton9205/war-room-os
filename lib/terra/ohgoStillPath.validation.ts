/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/ohgoStillPath.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildOhgoStillUrl, isOhgoStillPath, parseOhgoStillPath } from './ohgoStillPath'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check(
    'parses_live_toledo_pattern',
    parseOhgoStillPath('https://itscameras.dot.state.oh.us:443/images/toledo/SR2-EB-WestSign.jpg') === 'toledo/SR2-EB-WestSign.jpg',
    parseOhgoStillPath('https://itscameras.dot.state.oh.us:443/images/toledo/SR2-EB-WestSign.jpg') ?? 'null',
  ))
  results.push(check(
    'parses_cmh_pattern',
    parseOhgoStillPath('https://itscameras.dot.state.oh.us/images/CMH/2134.jpg') === 'CMH/2134.jpg',
    parseOhgoStillPath('https://itscameras.dot.state.oh.us/images/CMH/2134.jpg') ?? 'null',
  ))
  results.push(check('rejects_other_hosts', parseOhgoStillPath('https://example.com/images/CMH/2134.jpg') === null, 'foreign host'))
  results.push(check('rejects_path_traversal', isOhgoStillPath('toledo/../secret.jpg') === false, 'dot-dot'))
  results.push(check('rejects_absolute_path', isOhgoStillPath('/images/CMH/2134.jpg') === false, 'leading slash'))
  results.push(check(
    'reconstructs_https_url_without_port',
    buildOhgoStillUrl('CMH/2134.jpg') === 'https://itscameras.dot.state.oh.us/images/CMH/2134.jpg',
    buildOhgoStillUrl('CMH/2134.jpg') ?? 'null',
  ))
  results.push(check('rejects_http', parseOhgoStillPath('http://itscameras.dot.state.oh.us/images/CMH/2134.jpg') === null, 'http'))
  return results
}

export function runOhgoStillPathValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runOhgoStillPathValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`OHGO still path: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
