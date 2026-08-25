import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'cisa_kev' as const
const CATALOG_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
const MAX_RESULTS = 25

type KevEntry = {
  cveID?: string
  vendorProject?: string
  product?: string
  vulnerabilityName?: string
  dateAdded?: string
  shortDescription?: string
  requiredAction?: string
  dueDate?: string
  knownRansomwareCampaignUse?: string
}
type KevCatalog = { catalogVersion?: string; dateReleased?: string; count?: number; vulnerabilities?: KevEntry[] }

/**
 * CISA KEV is a bulk static-file source (BULK_ONLY-shaped access mechanism)
 * with no server-side query params — the whole catalog is fetched and cached
 * once, then filtered in-memory per request by CVE ID / vendor / product
 * substring, matching this codebase's convention for bounded-response
 * sources rather than a fabricated server-side search capability.
 */
async function fetchCatalog(): Promise<{ ok: true; catalog: KevCatalog } | { ok: false; status: number | null; message?: string }> {
  const cacheKey = 'cisa_kev:catalog'
  const cached = cacheGet<KevCatalog>(cacheKey)
  if (cached) return { ok: true, catalog: cached }

  const result = await safeProviderFetch(PROVIDER, CATALOG_URL, { timeoutMs: 15_000, maxResponseBytes: 16 * 1024 * 1024 })
  if (!result.ok) return { ok: false, status: result.status }

  const data = safeJsonParse<KevCatalog>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.vulnerabilities)) {
    return { ok: false, status: null, message: 'CISA KEV catalog response "vulnerabilities" field was missing or not an array.' }
  }
  cacheSet(cacheKey, data, CACHE_TTL.codelist)
  return { ok: true, catalog: data }
}

function matchesFilter(entry: KevEntry, text: string): boolean {
  if (!text) return true
  const haystack = `${entry.cveID ?? ''} ${entry.vendorProject ?? ''} ${entry.product ?? ''} ${entry.vulnerabilityName ?? ''}`.toLowerCase()
  return haystack.includes(text.toLowerCase())
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const outcome = await fetchCatalog()
  if (!outcome.ok) return outcome

  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const filtered = (outcome.catalog.vulnerabilities ?? []).filter(entry => matchesFilter(entry, text)).slice(0, limit)

  const documents = filtered
    .filter(entry => entry.cveID)
    .map(entry => {
      const id = entry.cveID as string
      const canonicalUrl = `https://nvd.nist.gov/vuln/detail/${id}`
      return makeDocument({
        id: `cisa_kev:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: entry.vulnerabilityName ?? id,
        summary: entry.shortDescription ?? null,
        contentSnippet: entry.requiredAction ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'CISA Known Exploited Vulnerabilities Catalog',
        contentType: 'vulnerability_record',
        authors: [],
        organization: entry.vendorProject ?? null,
        publishedAt: entry.dateAdded ?? null,
        updatedAt: null,
        geography: null,
        language: 'en',
        // Every entry in this catalog is, by definition, CONFIRMED_EXPLOITED
        // — that is the entire meaning of KEV membership. Distinct from
        // nvd's mirrored field and osv_dev's plain VULNERABILITY_EXISTS.
        identifiers: {
          cve_id: id,
          evidence_class: 'CONFIRMED_EXPLOITED',
          ...(entry.product ? { product: entry.product } : {}),
          ...(entry.dueDate ? { remediation_due_date: entry.dueDate } : {}),
          ...(entry.knownRansomwareCampaignUse ? { known_ransomware_use: entry.knownRansomwareCampaignUse } : {}),
        },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  return { ok: true as const, response: okResponse(PROVIDER, { documents, durationMs: Date.now() - started }) }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      throw new Error(outcome.status ? `CISA KEV catalog fetch failed with HTTP ${outcome.status}` : (outcome.message ?? 'CISA KEV catalog fetch failed'))
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, CATALOG_URL, { timeoutMs: 10_000, maxResponseBytes: 16 * 1024 * 1024 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'catalog reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const cisaKevAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
