import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'sidra_brazil' as const
const BASE_URL = 'https://servicodados.ibge.gov.br/api/v3/agregados'
// "aggregateId/period/variableId", e.g. "6579/2021/9324" (population estimates).
const QUERY_PATTERN = /^(\d+)\/([\w-]+)\/(\d+)$/
const DEFAULT_QUERY = { aggregateId: '6579', period: '2021', variableId: '9324' }

type Localidade = { id?: string; nome?: string }
type Serie = { localidade?: Localidade; serie?: Record<string, string> }
type Resultado = { series?: Serie[] }
type VariableEntry = { id?: string; variavel?: string; unidade?: string; resultados?: Resultado[] }

function parseQuery(text: string) {
  const match = QUERY_PATTERN.exec(text.trim())
  if (!match) return DEFAULT_QUERY
  return { aggregateId: match[1], period: match[2], variableId: match[3] }
}

/** SIDRA is a fixed aggregate/period/variable data-query API, not a
 * discovery/search API (confirmed live) — query text is "aggregateId/period/variableId". */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const { aggregateId, period, variableId } = parseQuery(query.text)
  const cacheKey = `sidra_brazil:${aggregateId}:${period}:${variableId}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/${aggregateId}/periodos/${period}/variaveis/${variableId}?localidades=N1[all]`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<VariableEntry[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'SIDRA response was not a JSON array.' }
  }

  const canonicalUrl = `https://sidra.ibge.gov.br/tabela/${aggregateId}`
  const documents = data.flatMap(entry => {
    const series = entry.resultados?.flatMap(r => r.series ?? []) ?? []
    return series.map(s => {
      const localidadeId = s.localidade?.id ?? 'unknown'
      const value = s.serie?.[period]
      return makeDocument({
        id: `sidra_brazil:${aggregateId}:${variableId}:${localidadeId}:${period}`,
        provider: PROVIDER,
        providerRecordId: `${aggregateId}:${variableId}:${localidadeId}:${period}`,
        title: `${entry.variavel ?? variableId} — ${s.localidade?.nome ?? localidadeId} (${period})`,
        summary: value != null ? `Value: ${value}${entry.unidade ? ` ${entry.unidade}` : ''}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'SIDRA (IBGE, Brazil)',
        contentType: 'statistical_indicator',
        authors: [],
        organization: 'IBGE',
        publishedAt: period,
        updatedAt: null,
        geography: s.localidade?.nome ?? 'Brazil',
        language: 'pt',
        identifiers: { sidra_aggregate_id: aggregateId, sidra_variable_id: variableId },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`SIDRA lookup failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/6579/periodos/2021/variaveis/9324?localidades=N1[all]`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'variables endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const sidraBrazilAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
