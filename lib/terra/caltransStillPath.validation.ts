/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/caltransStillPath.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildCaltransStillUrl, isCaltransStillPath, parseCaltransStillPath } from './caltransStillPath'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const live = 'https://cwwp2.dot.ca.gov/data/d4/cctv/image/tv102i580westofsr24/tv102i580westofsr24.jpg'
  const path = 'd4/cctv/image/tv102i580westofsr24/tv102i580westofsr24.jpg'
  const results: CaseResult[] = []
  results.push(check('parses_d4_still', parseCaltransStillPath(live) === path, parseCaltransStillPath(live) ?? 'null'))
  results.push(check('reconstructs_https_url', buildCaltransStillUrl(path) === live, buildCaltransStillUrl(path) ?? 'null'))
  results.push(check('rejects_other_hosts', parseCaltransStillPath('https://example.com/data/d4/cctv/image/tv102/tv102.jpg') === null, 'foreign host'))
  results.push(check('rejects_hls_host', parseCaltransStillPath('https://wzmedia.dot.ca.gov/D4/tv102.stream/playlist.m3u8') === null, 'hls'))
  results.push(check('rejects_path_traversal', isCaltransStillPath('d4/cctv/image/../secret.jpg') === false, 'dot-dot'))
  results.push(check('rejects_http', parseCaltransStillPath(live.replace('https://', 'http://')) === null, 'http'))
  return results
}

export function runCaltransStillPathValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCaltransStillPathValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Caltrans still path: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
