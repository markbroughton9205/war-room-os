import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { executeResearch } from '@/lib/research-engine/core/execute'
import { normalizeTerraRelatedIntelligence, TERRA_EVENT_INTELLIGENCE_PROVIDERS, TERRA_VIDEO_PROVIDER_GAP_MESSAGE } from '@/lib/terra/relatedIntelligence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Terra event/location "Related Intelligence" route — the exact executeResearch()-then-normalize
 * pattern app/api/terra/layers/[layerId]/route.ts already established for Terra, scoped to the
 * fixed provider set (TERRA_EVENT_INTELLIGENCE_PROVIDERS) that can honestly return news/article/
 * official-report ResearchDocuments. No video provider is requested — the Research Engine has no
 * video-search adapter; the client surfaces TERRA_VIDEO_PROVIDER_GAP_MESSAGE instead of a
 * fabricated result. `q` is built client-side by lib/terra/eventIntelligenceQuery.ts from the
 * selected event's own observed semantics plus (once resolved) its reverse-resolved location —
 * never from a raw internal id.
 */
export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra related intelligence')
  if (!commander.ok) return commander.response

  const queryText = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (!queryText) {
    return NextResponse.json(
      {
        tool: 'terra-event-intelligence',
        status: 'error',
        query: '',
        results: [],
        providerStatuses: [],
        videoProviderMessage: TERRA_VIDEO_PROVIDER_GAP_MESSAGE,
        fetchedAt: new Date().toISOString(),
        error: { message: 'A non-empty query is required.' },
      },
      { status: 400 },
    )
  }

  const startedAt = new Date().toISOString()
  const { summary, documents } = await executeResearch({
    text: queryText,
    intent: null,
    providers: TERRA_EVENT_INTELLIGENCE_PROVIDERS,
    maxResults: 12,
    dateFrom: null,
    dateTo: null,
    requireCurrent: false,
    requestedBy: commander.userId,
    requestedAt: startedAt,
  })

  const { results, providerStatuses } = normalizeTerraRelatedIntelligence(documents, summary.providerResponses, summary.route.rejectedProviders)

  return NextResponse.json({
    tool: 'terra-event-intelligence',
    status: results.length === 0 ? 'empty' : 'success',
    query: queryText,
    results,
    providerStatuses,
    videoProviderMessage: TERRA_VIDEO_PROVIDER_GAP_MESSAGE,
    fetchedAt: summary.completedAt,
    error: null,
  })
}
