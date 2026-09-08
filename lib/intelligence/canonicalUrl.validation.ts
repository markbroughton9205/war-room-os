import { pathToFileURL } from 'node:url'
import { canonicalizeUrl, isTrackingQueryParam } from './canonicalUrl'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

export function runCanonicalUrlValidation(): CaseResult[] {
  const cases: CaseResult[] = []
  cases.push(check(
    'canonical_01_strips_fragment_and_utm',
    canonicalizeUrl('https://News.Example.com/path/article/?utm_source=x&utm_medium=y&fbclid=1#section') === 'https://news.example.com/path/article',
    canonicalizeUrl('https://News.Example.com/path/article/?utm_source=x&utm_medium=y&fbclid=1#section') ?? 'null',
  ))
  cases.push(check(
    'canonical_02_keeps_resource_id_query',
    canonicalizeUrl('https://example.com/item?id=99&utm_campaign=ad') === 'https://example.com/item?id=99',
    canonicalizeUrl('https://example.com/item?id=99&utm_campaign=ad') ?? 'null',
  ))
  cases.push(check(
    'canonical_03_does_not_collapse_different_paths',
    canonicalizeUrl('https://example.com/a') !== canonicalizeUrl('https://example.com/b'),
    `${canonicalizeUrl('https://example.com/a')} vs ${canonicalizeUrl('https://example.com/b')}`,
  ))
  cases.push(check(
    'canonical_04_trailing_slash_non_root',
    canonicalizeUrl('https://example.com/path/') === canonicalizeUrl('https://example.com/path'),
    canonicalizeUrl('https://example.com/path/') ?? 'null',
  ))
  cases.push(check('canonical_05_tracking_param_detected', isTrackingQueryParam('gclid') && isTrackingQueryParam('utm_term'), 'gclid+utm'))
  cases.push(check('canonical_06_null_on_garbage', canonicalizeUrl('not a url') === null, 'null'))
  cases.push(check('canonical_07_http_to_https', canonicalizeUrl('http://example.com/x') === 'https://example.com/x', canonicalizeUrl('http://example.com/x') ?? 'null'))
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCanonicalUrlValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  if (results.some(item => !item.pass)) process.exit(1)
}
