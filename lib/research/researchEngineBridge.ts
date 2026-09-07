import 'server-only'

import type { ResearchDocument, ResearchProviderId } from '@/lib/research-engine/core/types'
import { getImplementedAdapter } from '@/lib/research-engine/providers/registry'
import { extractPrimaryQuerySentence, type ResearchDomain } from '@/lib/research/researchDomainRouter'

/**
 * Thin bridge from the live Council research path into a small, curated slice of the existing
 * lib/research-engine/ adapter library (245+ providers, previously wired to zero live consumers —
 * see the Build #4 readiness audit). This intentionally does NOT reimplement fetch/parse logic for
 * any provider: every call here goes straight through `getImplementedAdapter(id).run()`, the same
 * function the research-engine's own diagnostics call. There is no parallel registry — this file
 * only decides *which* of the existing adapters are worth calling for a live Council decree and
 * *when*.
 *
 * Selection criteria (Build #4A): genuinely free/public, not a hard dependency on a paid service.
 * Two of the five below (`sec_edgar`, `wikidata`) need a self-supplied descriptive User-Agent
 * string identifying this app to the upstream service — not a secret or paid credential, just a
 * config value set once in `.env.local` (`SEC_EDGAR_USER_AGENT_BASE`, `WIKIMEDIA_USER_AGENT_BASE`).
 * Each adapter still independently checks its own required env before making a request and returns
 * an honest `not_configured` error if it's missing, so this bridge never needs to duplicate that
 * check — it just calls `run()` and looks at `response.ok`.
 */
const BRIDGED_PROVIDERS_BY_DOMAIN: Record<ResearchDomain, ResearchProviderId[]> = {
  SCIENCE_ACADEMIC: ['arxiv', 'crossref', 'ncbi'],
  ECONOMIC_FINANCIAL: ['sec_edgar', 'wikidata'],
  GOVERNMENT_REGULATORY: ['sec_edgar', 'wikidata'],
  // No credential-free, free-text-searchable research-engine provider currently covers freight/
  // trucking/logistics industry news (FMCSA is the one transportation adapter in the library, and
  // it requires a paid-style `FMCSA_WEB_KEY` plus only supports exact-USDOT-number lookups, not
  // free-text industry queries) — SEC EDGAR full-text search is the closest genuine fit, since
  // public freight/logistics companies' own filings discuss "freight brokerage"/"logistics" in
  // their own words. This is an honest best-available mapping, not a fabricated logistics source.
  TRANSPORTATION_LOGISTICS: ['sec_edgar'],
  GENERAL_CURRENT: [],
  HYBRID: [],
}

const MAX_RESULTS_PER_PROVIDER = 4
const PROVIDER_TIMEOUT_MS = 12_000
const MAX_QUERY_CHARS = 220

/**
 * The router's `searchQuery` is sometimes a decree augmented with generic multi-topic instruction
 * text (e.g. "...today? Cover distinct current-event areas without repeating the same search: 1.
 * current geopolitics ... 2. global economics ...") meant to broaden a generalist RSS/web sweep.
 * That instructional tail reads as noise, not a search term, to a literal full-text index like SEC
 * EDGAR's — sent verbatim it reliably returns zero hits even when the actual question has a real
 * answer (confirmed live: the same question alone returns real filings, the question plus that tail
 * returns none). Bridged providers get just the first sentence of the query instead.
 */
export function compactQueryText(text: string): string {
  const compact = extractPrimaryQuerySentence(text)
  return (compact || text).slice(0, MAX_QUERY_CHARS)
}

export type BridgedProviderResult = {
  providerId: ResearchProviderId
  ok: boolean
  documents: ResearchDocument[]
  error?: string
}

export type ResearchEngineBridgeLeg = {
  domain: ResearchDomain
  attempted: boolean
  providerIds: ResearchProviderId[]
  results: BridgedProviderResult[]
  documents: ResearchDocument[]
  ok: boolean
}

function providersForDomain(domain: ResearchDomain, extra: ResearchDomain[]): ResearchProviderId[] {
  const ids = new Set<ResearchProviderId>(BRIDGED_PROVIDERS_BY_DOMAIN[domain])
  for (const d of extra) {
    for (const id of BRIDGED_PROVIDERS_BY_DOMAIN[d]) ids.add(id)
  }
  return Array.from(ids)
}

async function runWithTimeout(providerId: ResearchProviderId, queryText: string): Promise<BridgedProviderResult> {
  const adapter = getImplementedAdapter(providerId)
  if (!adapter) {
    return { providerId, ok: false, documents: [], error: 'adapter_not_registered' }
  }
  try {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('research_engine_bridge_timeout')), PROVIDER_TIMEOUT_MS)
    })
    const response = await Promise.race([
      adapter.run({ text: queryText, maxResults: MAX_RESULTS_PER_PROVIDER }),
      timeout,
    ])
    return {
      providerId,
      ok: response.ok && response.documents.length > 0,
      documents: response.documents.slice(0, MAX_RESULTS_PER_PROVIDER),
      error: response.error?.message,
    }
  } catch (error) {
    return { providerId, ok: false, documents: [], error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * `domain` is the query's primary classification; for `HYBRID` pass every matched domain in
 * `matchedDomains` so the bridge queries the union of their provider sets.
 */
export async function runResearchEngineBridge(args: {
  queryText: string
  domain: ResearchDomain
  matchedDomains?: ResearchDomain[]
}): Promise<ResearchEngineBridgeLeg> {
  const { queryText, domain, matchedDomains = [] } = args
  const providerIds = providersForDomain(domain, matchedDomains)

  if (providerIds.length === 0) {
    return { domain, attempted: false, providerIds: [], results: [], documents: [], ok: false }
  }

  const compactText = compactQueryText(queryText)
  const results = await Promise.all(providerIds.map(id => runWithTimeout(id, compactText)))
  const documents = results.flatMap(r => r.documents)

  return {
    domain,
    attempted: true,
    providerIds,
    results,
    documents,
    ok: documents.length > 0,
  }
}
