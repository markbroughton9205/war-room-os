import 'server-only'

import type { ResearchDocument, ResearchExecutionSummary, ResearchProviderResponse, ResearchRequest } from '@/lib/research-engine/core/types'
import { routeResearchQuery } from '@/lib/research-engine/routing/router'
import { getImplementedAdapter } from '@/lib/research-engine/providers/registry'
import { deduplicateDocuments } from '@/lib/research-engine/normalization/dedupe'
import { attachCitations } from '@/lib/research-engine/citations/citations'

function randomRequestId(): string {
  return `research_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Runs a research request end-to-end: route -> call selected provider
 * adapters concurrently -> aggregate -> dedupe -> attach citations. A single
 * provider throwing or timing out never aborts the whole request — its
 * failure is captured as one ResearchProviderResponse with ok:false.
 */
export async function executeResearch(request: ResearchRequest): Promise<{ summary: ResearchExecutionSummary; documents: ResearchDocument[] }> {
  const startedAt = Date.now()
  const route = routeResearchQuery(request)

  const providerResponses: ResearchProviderResponse[] = await Promise.all(
    route.selectedProviders.map(async providerId => {
      const adapter = getImplementedAdapter(providerId)
      if (!adapter) {
        return {
          provider: providerId,
          ok: false,
          documents: [],
          timeSeries: [],
          geoFeatures: [],
          entities: [],
          error: { provider: providerId, category: 'not_configured' as const, message: 'Adapter not implemented', httpStatus: null },
          durationMs: 0,
          fromCache: false,
        }
      }
      try {
        return await adapter.run(request)
      } catch (error) {
        return {
          provider: providerId,
          ok: false,
          documents: [],
          timeSeries: [],
          geoFeatures: [],
          entities: [],
          error: { provider: providerId, category: 'unknown' as const, message: error instanceof Error ? error.message : String(error), httpStatus: null },
          durationMs: Date.now() - startedAt,
          fromCache: false,
        }
      }
    }),
  )

  const allDocuments = providerResponses.flatMap(response => response.documents).slice(0, route.maxResults * 3)
  const withCitations = attachCitations(allDocuments)
  const { documents: deduped, duplicatesRemoved } = deduplicateDocuments(withCitations)
  const limited = deduped.slice(0, route.maxResults)

  const summary: ResearchExecutionSummary = {
    requestId: randomRequestId(),
    requestedAt: request.requestedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    route,
    providerResponses,
    resultCount: limited.length,
    deduplicatedCount: duplicatesRemoved,
    partialFailure: providerResponses.some(response => !response.ok),
  }

  return { summary, documents: limited }
}
