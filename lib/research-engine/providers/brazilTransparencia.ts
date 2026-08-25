import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'brazil_transparencia' as const
const BASE_URL = 'https://api.portaldatransparencia.gov.br/api-de-dados/despesas/documentos'
const ORG_CODE_PATTERN = /^\d{5}$/

// Auth mechanism (chave-api-dados header, real structured 401 error shape)
// confirmed live this mission. Free self-service registration via
// portaldatransparencia.gov.br/api-de-dados/cadastrar-email, no approval
// gate apparent. Response body shape for a valid key not independently
// re-verified live (no key available this build) — recommend one
// live-verification pass once a Commander registers a key.
type Documento = {
  documento?: string
  valor?: number | string
  dataDocumento?: string
  favorecido?: { nome?: string; codigoFormatado?: string }
  orgao?: { nome?: string }
}

function apiKey(): string {
  return process.env.BRAZIL_TRANSPARENCIA_API_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const orgCode = query.text.trim()
  if (!ORG_CODE_PATTERN.test(orgCode)) {
    throw new Error('Query must be a 5-digit Brazilian government org code (codigoOrgao), e.g. "26246".')
  }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, 25))
  const cacheKey = `brazil_transparencia:${orgCode}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('codigoOrgao', orgCode)
  url.searchParams.set('pagina', '1')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'chave-api-dados': apiKey() }, timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Documento[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Portal da Transparência response was not a JSON array.' }
  }

  const documents = data
    .slice(0, limit)
    .filter(d => typeof d.documento === 'string')
    .map(d => {
      const id = d.documento as string
      const canonicalUrl = `https://portaldatransparencia.gov.br/despesas/documento/${id}`
      return makeDocument({
        id: `brazil_transparencia:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: d.favorecido?.nome ?? id,
        summary: d.orgao?.nome ?? null,
        contentSnippet: d.valor != null ? `Valor: R$${d.valor}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Portal da Transparência (Brazil)',
        contentType: 'government_expenditure',
        authors: [],
        organization: d.orgao?.nome ?? null,
        publishedAt: d.dataDocumento ?? null,
        updatedAt: null,
        geography: 'Brazil',
        language: 'pt',
        identifiers: { transparencia_documento_id: id, codigo_orgao: orgCode },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'BRAZIL_TRANSPARENCIA_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Portal da Transparência search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'BRAZIL_TRANSPARENCIA_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?codigoOrgao=26246&pagina=1`, { headers: { 'chave-api-dados': apiKey() }, timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'documentos endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const brazilTransparenciaAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
