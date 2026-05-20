import 'server-only'

import { runLiveResearchRouter } from '@/lib/research/researchRouter'
import { runFederatedSignalIngestion } from '@/lib/signals/router/federation'
import { evaluateFreshness } from '@/lib/signals/freshness'
import type { SignalRawItem } from '@/lib/signals/model'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import type { CouncilStoryContext, SourceEvidenceLabel, SourceRef } from './types'

export type GatheredSourceBundle = {
  sources: SourceRef[]
  sourceBlock: string
  sourcesUnavailable: boolean
  operatorGuidance: string | null
  federationMode: string | null
  liveRouterOk: boolean
  generatedAt: string
}

function evidenceLabelForItem(item: SignalRawItem): SourceEvidenceLabel {
  const label = item.metadata?.evidenceLabel
  if (label === 'HISTORICAL_PATTERN_BASED') return 'HISTORICAL_PATTERN_BASED'
  if (item.provider === 'historical') return 'HISTORICAL_PATTERN_BASED'
  const fresh = item.metadata?.freshnessStatus
  if (fresh === 'LIVE' || fresh === 'RECENT') return 'LIVE_SIGNAL_BACKED'
  if (item.provider === 'cached') return 'CACHED'
  return 'UNVERIFIED'
}

function rawItemToSourceRef(item: SignalRawItem): SourceRef {
  const metaPublished = item.metadata?.articlePublishedAt ?? item.metadata?.publishedAt
  const publishedAt =
    typeof metaPublished === 'string' && metaPublished.trim()
      ? metaPublished
      : null
  const freshness = evaluateFreshness(publishedAt, { provider: item.provider })
  return {
    title: item.title,
    url: item.url ?? null,
    snippet: (item.summary ?? item.title).slice(0, 600),
    provider: item.provider,
    freshnessStatus: freshness.status,
    confidence: Math.round(Math.min(100, Math.max(0, (item.rawScore ?? 0.5) * 100))),
    evidenceLabel: evidenceLabelForItem(item),
    publishedAt,
  }
}

function storyContextToSource(story: CouncilStoryContext): SourceRef {
  return {
    title: story.headline,
    url: story.url,
    snippet: [story.shortSummary, story.whyItMatters].filter(Boolean).join(' ').slice(0, 800),
    provider: story.provider,
    freshnessStatus: story.freshnessStatus,
    confidence: story.confidence,
    evidenceLabel: story.url ? 'LIVE_SIGNAL_BACKED' : 'UNVERIFIED',
    publishedAt: null,
  }
}

function routerHitsToSources(
  router: Awaited<ReturnType<typeof runLiveResearchRouter>>,
): SourceRef[] {
  const out: SourceRef[] = []
  for (const r of router.tavily.results) {
    out.push({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      provider: 'tavily',
      freshnessStatus: 'unknown',
      confidence: 72,
      evidenceLabel: router.tavily.ok ? 'LIVE_SIGNAL_BACKED' : 'UNVERIFIED',
      publishedAt: null,
    })
  }
  for (const d of router.direct) {
    if (!d.ok || !d.contentSnippet.trim()) continue
    out.push({
      title: d.url,
      url: d.url,
      snippet: d.contentSnippet.slice(0, 600),
      provider: 'direct_fetch',
      freshnessStatus: 'unknown',
      confidence: 65,
      evidenceLabel: 'LIVE_SIGNAL_BACKED',
      publishedAt: null,
    })
  }
  return out
}

function dedupeSources(sources: SourceRef[]): SourceRef[] {
  const seen = new Set<string>()
  const out: SourceRef[] = []
  for (const s of sources) {
    const key = `${(s.url ?? s.title).toLowerCase()}::${s.title.slice(0, 80)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out.slice(0, 24)
}

function buildSourceBlock(sources: SourceRef[]): string {
  if (!sources.length) {
    return 'No source-backed items were returned. Do not invent live headlines, prices, or events.'
  }
  return sources
    .map((s, i) => {
      const label = s.evidenceLabel === 'HISTORICAL_PATTERN_BASED' ? '[HISTORICAL]' : s.evidenceLabel === 'CACHED' ? '[CACHED]' : ''
      return [
        `### Source ${i + 1} ${label}`.trim(),
        `Title: ${s.title}`,
        s.url ? `URL: ${s.url}` : 'URL: (none)',
        `Provider: ${s.provider} · Freshness: ${s.freshnessStatus} · Confidence: ${s.confidence}% · Evidence: ${s.evidenceLabel}`,
        s.publishedAt ? `Published: ${s.publishedAt}` : '',
        `Snippet: ${s.snippet}`,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}

export async function gatherCouncilResearchSources(args: {
  decree: string
  storyContext?: CouncilStoryContext
}): Promise<GatheredSourceBundle> {
  const generatedAt = new Date().toISOString()
  const sup = tryWarRoomSupabase()
  const sources: SourceRef[] = []

  if (args.storyContext) {
    sources.push(storyContextToSource(args.storyContext))
  }

  const federationSources: import('@/lib/signals/model').SignalSourceDefinition[] = args.storyContext?.url
    ? [{
        id: `story-${args.storyContext.headline.slice(0, 40)}`,
        label: args.storyContext.source,
        provider: 'source_url',
        kind: 'page_extract',
        categories: ['AI_trends'],
        url: args.storyContext.url,
        query: null,
        configured: true,
        reliabilityScore: 0.7,
        notes: 'News Intel story handoff',
      }]
    : []

  const [routerResult, federationResult] = await Promise.allSettled([
    runLiveResearchRouter({
      decreeText: args.decree,
      supabase: sup.ok ? sup.client : null,
    }),
    runFederatedSignalIngestion({
      capturedAt: generatedAt,
      sources: federationSources,
    }),
  ])

  let liveRouterOk = false
  let operatorGuidance: string | null = null
  let federationMode: string | null = null

  if (routerResult.status === 'fulfilled') {
    liveRouterOk = routerResult.value.tavily.ok || routerResult.value.direct.some(d => d.ok)
    sources.push(...routerHitsToSources(routerResult.value))
  }

  if (federationResult.status === 'fulfilled') {
    federationMode = federationResult.value.status.mode
    operatorGuidance = federationResult.value.status.operatorGuidance
    for (const item of federationResult.value.items.slice(0, 12)) {
      sources.push(rawItemToSourceRef(item))
    }
  }

  const deduped = dedupeSources(sources)
  const liveBacked = deduped.some(s => s.evidenceLabel === 'LIVE_SIGNAL_BACKED')
  const sourcesUnavailable = deduped.length === 0

  return {
    sources: deduped,
    sourceBlock: buildSourceBlock(deduped),
    sourcesUnavailable,
    operatorGuidance,
    federationMode,
    liveRouterOk: liveRouterOk || liveBacked,
    generatedAt,
  }
}
