/**
 * Deterministic canonical URL normalization for evidence independence (Build #6).
 * Collapses tracking wrappers without merging genuinely different resources.
 */

const TRACKING_PARAM_EXACT = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'mc_eid',
  'mc_cid',
  'igshid',
  'mkt_tok',
  'vero_id',
  'yclid',
  'twclid',
  'li_fat_id',
  'spm',
  'scm',
  'ref',
  'ref_src',
  'ref_url',
  'source',
  'feature',
  'si',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  'ncid',
  'nr_email_referer',
])

const TRACKING_PARAM_PREFIXES = ['utm_', 'mtm_', 'pk_', 'hsa_', 'oly_']

export function isTrackingQueryParam(name: string): boolean {
  const key = name.toLowerCase()
  if (TRACKING_PARAM_EXACT.has(key)) return true
  return TRACKING_PARAM_PREFIXES.some(prefix => key.startsWith(prefix))
}

function stripDefaultPort(url: URL): void {
  if (url.port === '80' && url.protocol === 'http:') url.port = ''
  if (url.port === '443' && url.protocol === 'https:') url.port = ''
}

function normalizePathname(pathname: string): string {
  if (!pathname) return '/'
  let path = pathname.replace(/\/{2,}/g, '/')
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path || '/'
}

/**
 * Returns a stable canonical URL string, or null when the input is missing / unparseable.
 * Never fabricates a URL.
 */
export function canonicalizeUrl(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  parsed.hash = ''
  parsed.protocol = 'https:'
  parsed.hostname = parsed.hostname.toLowerCase()
  if (parsed.hostname.startsWith('www.')) parsed.hostname = parsed.hostname.slice(4)
  stripDefaultPort(parsed)
  parsed.pathname = normalizePathname(parsed.pathname)

  const kept = new URLSearchParams()
  const pairs = [...parsed.searchParams.entries()]
    .filter(([key]) => !isTrackingQueryParam(key))
    .sort(([aKey, aVal], [bKey, bVal]) => aKey.localeCompare(bKey) || aVal.localeCompare(bVal))
  for (const [key, value] of pairs) {
    if (!kept.has(key)) kept.append(key, value)
  }
  parsed.search = kept.toString() ? `?${kept.toString()}` : ''

  return parsed.toString()
}

export function hostnameFromUrl(raw: string | null | undefined): string | null {
  const canonical = canonicalizeUrl(raw)
  if (!canonical) return null
  try {
    return new URL(canonical).hostname
  } catch {
    return null
  }
}
