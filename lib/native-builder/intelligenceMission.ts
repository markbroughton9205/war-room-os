/**
 * Global Intelligence evidence layer. Reuses lib/research/researchRouter.ts's
 * `runLiveResearchRouter` — already real, already running Tavily search, Grok framing, and
 * validated direct-URL fetches as three INDEPENDENT parallel legs (confirmed: direct fetch has
 * its own SSRF-guarded fetch() call, entirely independent of Tavily's HTTP client). This module
 * does not add new retrieval — it normalizes what already comes back into the provider-neutral
 * SignalEvidence schema, so canonical intelligence truth belongs to War Room's evidence layer,
 * not to any single provider's response shape.
 *
 * Honest scope for this pass: only the Tavily and direct-fetch legs become evidence (both are
 * genuine external retrieval). Grok's leg is commentary/framing, not a source, so it is not
 * turned into a SignalEvidence row. RSS and the other 17 scout types from Part 19 are real,
 * separately-audited infrastructure (lib/signals/rss/runtime.ts) but are NOT wired into this
 * mission runner this pass — see the final report's honest limitations.
 */
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { runLiveResearchRouter, type LiveResearchRouterResult } from '@/lib/research/researchRouter'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type SignalEvidenceSourceType = 'rss' | 'search' | 'direct_web' | 'browser' | 'public_api' | 'government' | 'international' | 'academic' | 'news' | 'market' | 'local_archive'

export type SignalEvidenceSourceAuthority = 'primary' | 'official' | 'secondary' | 'commentary' | 'unknown'

export type SignalEvidenceRetrievalStatus = 'complete' | 'partial' | 'failed' | 'access_restricted'

export type SignalEvidence = {
  id: string
  missionId: string
  agentId: string
  providerId?: string
  sourceType: SignalEvidenceSourceType
  title: string
  sourceUrl?: string
  officialSourceId?: string
  publisher?: string
  issuingOrganization?: string
  country?: string
  region?: string
  language?: string
  retrievedAt: string
  publishedAt?: string
  updatedAt?: string
  excerpt?: string
  structuredData?: unknown
  claims: string[]
  sourceAuthority: SignalEvidenceSourceAuthority
  retrievalStatus: SignalEvidenceRetrievalStatus
  confidence: number
  contentHash?: string
  failureReason?: string
  accessRestriction?: string
}

function hashOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 24)
}

/** Pure mapping — no I/O. Takes whatever the router actually returned (real or, in a test,
 * simulated) and produces honest SignalEvidence rows. A failed Tavily leg simply contributes zero
 * 'search' rows; it never blocks the 'direct_web' rows from the independent direct-fetch leg. */
export function mapRouterResultToEvidence(missionId: string, result: LiveResearchRouterResult): SignalEvidence[] {
  const evidence: SignalEvidence[] = []

  if (result.tavily.ok) {
    for (const hit of result.tavily.results) {
      evidence.push({
        id: randomUUID(),
        missionId,
        agentId: 'tavily_connector',
        providerId: 'tavily',
        sourceType: 'search',
        title: hit.title,
        sourceUrl: hit.url,
        retrievedAt: result.generatedAt,
        excerpt: hit.snippet,
        claims: [],
        sourceAuthority: 'secondary',
        retrievalStatus: 'complete',
        confidence: 70,
        contentHash: hashOf(hit.snippet || hit.url),
      })
    }
  }

  for (const item of result.direct) {
    evidence.push({
      id: randomUUID(),
      missionId,
      agentId: 'direct_web_scout',
      sourceType: 'direct_web',
      title: item.url,
      sourceUrl: item.url,
      retrievedAt: result.generatedAt,
      excerpt: item.ok ? item.contentSnippet : undefined,
      claims: [],
      sourceAuthority: 'primary',
      retrievalStatus: item.ok ? 'complete' : /^HTTP 40[13]|blocked|forbidden/i.test(item.error ?? '') ? 'access_restricted' : 'failed',
      confidence: item.ok ? 75 : 0,
      contentHash: item.ok ? hashOf(item.contentSnippet) : undefined,
      failureReason: item.ok ? undefined : item.error,
      accessRestriction: item.ok ? undefined : /^HTTP 40[13]/.test(item.error ?? '') ? `SOURCE IDENTIFIED — ACCESS RESTRICTED (${item.error})` : undefined,
    })
  }

  return evidence
}

export type GlobalIntelligenceMissionResult = {
  missionId: string
  routerResult: LiveResearchRouterResult
  evidence: SignalEvidence[]
  routesAttempted: string[]
  routesWithEvidence: string[]
  tavilyUsed: boolean
  firecrawlUsed: false // this router never calls Firecrawl — confirmed by the Phase-1 audit
}

/** Real call — no paid-provider requirement to succeed: direct-fetch works even if Tavily is
 * unconfigured/unreachable, since the two legs run independently via Promise.all upstream. */
export async function runGlobalIntelligenceMission(args: {
  decreeText: string
  supabase: WarRoomSupabase | null
  conversationId?: string | null
}): Promise<GlobalIntelligenceMissionResult> {
  const missionId = randomUUID()
  const routerResult = await runLiveResearchRouter({
    decreeText: args.decreeText,
    supabase: args.supabase,
    conversationId: args.conversationId,
  })
  const evidence = mapRouterResultToEvidence(missionId, routerResult)

  const routesAttempted = ['search:tavily', 'direct_web:direct_fetch']
  const routesWithEvidence = [
    ...(evidence.some(e => e.sourceType === 'search' && e.retrievalStatus === 'complete') ? ['search:tavily'] : []),
    ...(evidence.some(e => e.sourceType === 'direct_web' && e.retrievalStatus === 'complete') ? ['direct_web:direct_fetch'] : []),
  ]

  return {
    missionId,
    routerResult,
    evidence,
    routesAttempted,
    routesWithEvidence,
    tavilyUsed: routerResult.tavily.ok,
    firecrawlUsed: false,
  }
}
