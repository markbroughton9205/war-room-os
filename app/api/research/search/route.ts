import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { RESEARCH_PROVIDER_ENV } from '@/lib/research-engine/config/providerEnv'
import { executeResearch } from '@/lib/research-engine/core/execute'
import { recordResearchAudit, redactedQueryHash } from '@/lib/research-engine/diagnostics/audit'
import type { ResearchProviderId, ResearchQueryIntent } from '@/lib/research-engine/core/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_QUERY_LENGTH = 500
const MAX_RESULTS_CEILING = 50
const KNOWN_PROVIDER_IDS = new Set(RESEARCH_PROVIDER_ENV.map(descriptor => descriptor.id))
const KNOWN_INTENTS = new Set<ResearchQueryIntent>([
  'general_web', 'software_code', 'scholarly', 'medical_biomedical', 'legal_case_law',
  'patents_inventions', 'government_contracts', 'transportation_carriers', 'economics_macro',
  'global_development', 'finance_public_data', 'climate_environment', 'earthquakes_hazards',
  'water_hydrology', 'maps_geospatial', 'historical_web', 'cultural_history',
  'entity_knowledge_graph', 'space_science',
])

type SearchRequestBody = {
  text?: unknown
  intent?: unknown
  providers?: unknown
  maxResults?: unknown
  dateFrom?: unknown
  dateTo?: unknown
  requireCurrent?: unknown
}

function badRequest(message: string) {
  return NextResponse.json({ tool: 'research-engine-search', status: 'invalid_request', message }, { status: 400 })
}

export async function POST(req: Request) {
  const commander = await requireCommanderSession('Research Engine search')
  if (!commander.ok) return commander.response

  let body: SearchRequestBody
  try {
    body = await req.json()
  } catch {
    return badRequest('Request body must be valid JSON.')
  }

  if (typeof body.text !== 'string' || !body.text.trim()) {
    return badRequest('"text" is required and must be a non-empty string.')
  }
  if (body.text.length > MAX_QUERY_LENGTH) {
    return badRequest(`"text" must be ${MAX_QUERY_LENGTH} characters or fewer.`)
  }
  if (body.intent !== undefined && (typeof body.intent !== 'string' || !KNOWN_INTENTS.has(body.intent as ResearchQueryIntent))) {
    return badRequest('"intent" must be one of the known research intents.')
  }
  let providers: ResearchProviderId[] | null = null
  if (body.providers !== undefined) {
    if (!Array.isArray(body.providers) || !body.providers.every(id => typeof id === 'string' && KNOWN_PROVIDER_IDS.has(id as ResearchProviderId))) {
      return badRequest('"providers" must be an array of known Research Engine provider ids.')
    }
    providers = body.providers as ResearchProviderId[]
  }
  if (body.maxResults !== undefined && (typeof body.maxResults !== 'number' || body.maxResults < 1)) {
    return badRequest('"maxResults" must be a positive number.')
  }
  if (body.dateFrom !== undefined && typeof body.dateFrom !== 'string') return badRequest('"dateFrom" must be a string.')
  if (body.dateTo !== undefined && typeof body.dateTo !== 'string') return badRequest('"dateTo" must be a string.')

  const startedAt = new Date().toISOString()
  const started = Date.now()

  const { summary, documents } = await executeResearch({
    text: body.text.trim(),
    intent: (body.intent as ResearchQueryIntent | undefined) ?? null,
    providers,
    maxResults: Math.min(typeof body.maxResults === 'number' ? body.maxResults : 20, MAX_RESULTS_CEILING),
    dateFrom: (body.dateFrom as string | undefined) ?? null,
    dateTo: (body.dateTo as string | undefined) ?? null,
    requireCurrent: Boolean(body.requireCurrent),
    requestedBy: commander.userId,
    requestedAt: startedAt,
  })

  recordResearchAudit({
    operation: 'search',
    provider: 'multi',
    queryHash: redactedQueryHash(body.text),
    startedAt,
    durationMs: Date.now() - started,
    resultCount: summary.resultCount,
    outcome: summary.providerResponses.length === 0 ? 'failure' : summary.partialFailure ? 'partial_failure' : 'success',
    errorCategory: summary.providerResponses.find(response => !response.ok)?.error?.category ?? null,
    requestedBy: commander.userId,
  })

  return NextResponse.json({
    tool: 'research-engine-search',
    status: summary.providerResponses.length === 0 ? 'no_providers_selected' : summary.partialFailure ? 'partial_success' : 'success',
    summary,
    documents,
    secretsExposed: false,
  })
}
