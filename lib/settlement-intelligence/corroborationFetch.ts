import type { OfficialAuthority, Provenance } from './corroborationTypes'

export type ReadOnlyFetchResult = { ok: boolean; text: string; provenance: Provenance; error: string | null }

export async function fetchReadOnly(url: string, sourceClass: Provenance['sourceClass'], fetcher: typeof fetch = fetch): Promise<ReadOnlyFetchResult> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('Settlement intelligence permits HTTPS GET requests only.')
  const started = performance.now()
  try {
    const response = await fetcher(parsed, { method: 'GET', redirect: 'follow', headers: { Accept: 'text/html,application/json;q=0.9', 'User-Agent': 'WarRoomOS-SettlementIntelligence/1.0 (read-only discovery)' }, cache: 'no-store' })
    const text = await response.text()
    return { ok: response.ok, text, provenance: { url: response.url || parsed.toString(), sourceClass, retrievedAt: new Date().toISOString(), httpStatus: response.status, contentType: response.headers.get('content-type'), observedLatencyMs: Math.round(performance.now() - started) }, error: response.ok ? null : `HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, text: '', provenance: { url: parsed.toString(), sourceClass, retrievedAt: new Date().toISOString(), httpStatus: null, contentType: null, observedLatencyMs: Math.round(performance.now() - started) }, error: error instanceof Error ? error.message : 'Fetch failed.' }
  }
}

export function classifyOfficialAuthority(url: string): OfficialAuthority | null {
  const host = new URL(url).hostname.toLowerCase()
  if (host.endsWith('.uscourts.gov') || host === 'uscourts.gov' || (host.endsWith('.gov') && /court/.test(host))) return 'OFFICIAL_COURT'
  if (host.endsWith('.gov') || host === 'gov') return 'OFFICIAL_GOVERNMENT'
  if (/(^|\.)(ksacms|veritaglobal|kroll|angeion|simpluris|epiq|jndla)\./.test(host)) return 'OFFICIAL_ADMIN'
  return null
}
