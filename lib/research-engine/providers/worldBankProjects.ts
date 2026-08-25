import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'world_bank_projects' as const
const MAX_RESULTS = 20

// Confirmed live (this mission) via a direct probe: GET /projects?format=json
// with a free-text `qterm` param, unauthenticated, real JSON — the
// `projects` field is an OBJECT keyed by project id, not an array.
type WbProject = {
  id?: string
  project_name?: string
  regionname?: string
  countryname?: string[]
  countryshortname?: string
  status?: string
  boardapprovaldate?: string
  totalamt?: string
  totalcommamt?: string
  url?: string
  sector1?: { Name?: string }
  prodlinetext?: string
}
type WbProjectsResponse = { total?: string; projects?: Record<string, WbProject> }

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('WORLD_BANK_PROJECTS_API_BASE_URL', descriptor)) || 'https://search.worldbank.org/api/v2'
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a free-text term to search World Bank project names/descriptions, e.g. "renewable energy".')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `world_bank_projects:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${baseUrl()}/projects`)
  url.searchParams.set('format', 'json')
  url.searchParams.set('qterm', text)
  url.searchParams.set('rows', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<WbProjectsResponse>(result.text)
  const projectsMap = data?.projects
  if (!projectsMap || typeof projectsMap !== 'object') {
    return { ok: false as const, kind: 'malformed' as const, message: 'World Bank Projects response was missing the "projects" object.' }
  }

  const documents = Object.values(projectsMap).slice(0, limit).filter(p => p.id && p.project_name).map(p => {
    const id = p.id as string
    const canonicalUrl = p.url ?? `https://projects.worldbank.org/en/projects-operations/project-detail/${id}`
    return makeDocument({
      id: `world_bank_projects:${id}`,
      provider: PROVIDER,
      providerRecordId: id,
      title: p.project_name as string,
      summary: null,
      contentSnippet: [p.status, p.sector1?.Name].filter(Boolean).join(' — ') || null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'World Bank Projects & Operations',
      contentType: 'development_project',
      authors: [],
      organization: 'World Bank',
      publishedAt: p.boardapprovaldate ?? null,
      updatedAt: null,
      geography: p.countryshortname ?? p.countryname?.[0] ?? p.regionname ?? null,
      language: 'en',
      identifiers: { world_bank_project_id: id },
      subjects: p.sector1?.Name ? [p.sector1.Name] : [],
      license: null,
      accessStatus: 'open',
    })
  })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`World Bank Projects search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/projects?format=json&rows=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'projects endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const worldBankProjectsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
