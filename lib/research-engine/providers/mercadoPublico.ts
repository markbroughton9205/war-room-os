import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'mercado_publico' as const
const BASE_URL = 'https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json'
const CODE_PATTERN = /^[A-Za-z0-9-]{3,40}$/

// Chile's ChileCompra public-procurement API is ticket-key gated (confirmed
// real: unauthenticated calls return a real "Ingrese ticket valido" error).
// Free ticket via account registration at mercadopublico.cl. Query text is a
// tender code ("codigo"), the only reliable getById-style lookup this API
// supports without a date-range scan.
type Tender = { CodigoExterno?: string; Nombre?: string; Descripcion?: string; FechaPublicacion?: string; Comprador?: { NombreOrganismo?: string }; Estado?: string }
type Response = { Listado?: Tender[] }

function ticket(): string {
  return process.env.MERCADO_PUBLICO_TICKET?.trim() ?? ''
}

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const codigo = query.text.trim()
  if (!CODE_PATTERN.test(codigo)) {
    throw new Error('Query must be a Mercado Público tender code (e.g. "750301-1-L124").')
  }
  const cacheKey = `mercado_publico:${codigo}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('ticket', ticket())
  url.searchParams.set('codigo', codigo)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Response>(result.text)
  const listing = data?.Listado
  if (!Array.isArray(listing)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Mercado Público response "Listado" field was missing or not an array.' }
  }

  const documents = listing
    .filter(t => typeof t.CodigoExterno === 'string')
    .map(t => {
      const code = t.CodigoExterno as string
      const canonicalUrl = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(code)}`
      return makeDocument({
        id: `mercado_publico:${code}`,
        provider: PROVIDER,
        providerRecordId: code,
        title: t.Nombre ?? code,
        summary: t.Descripcion ?? null,
        contentSnippet: t.Estado ? `Estado: ${t.Estado}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Mercado Público (ChileCompra)',
        contentType: 'government_tender',
        authors: [],
        organization: t.Comprador?.NombreOrganismo ?? null,
        publishedAt: t.FechaPublicacion ?? null,
        updatedAt: null,
        geography: 'CL',
        language: 'es',
        identifiers: { mercado_publico_codigo: code },
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
    return notConfiguredResponse(PROVIDER, 'MERCADO_PUBLICO_TICKET is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`Mercado Público lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'MERCADO_PUBLICO_TICKET missing', durationMs: null }
  }
  try {
    const url = new URL(BASE_URL)
    url.searchParams.set('ticket', ticket())
    url.searchParams.set('estado', 'activas')
    const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'licitaciones endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const mercadoPublicoAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
