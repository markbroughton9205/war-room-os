/**
 * Terra "Related Intelligence" — the smallest reusable Terra-facing result model for external
 * news/article/official-report coverage of a selected event/location, and the pure normalizer from
 * the Research Engine's generic ResearchDocument/ResearchProviderResponse shapes into it.
 *
 * Deliberately reuses the existing Research Engine (executeResearch, the same providers, the same
 * safeProviderFetch/withProviderGate/cache boundary every other Terra route already goes through —
 * see app/api/terra/event-intelligence/route.ts) rather than a second search/provider system.
 *
 * No video adapter exists anywhere in the Research Engine today (verified: no provider file
 * references video/YouTube search) — TERRA_EVENT_INTELLIGENCE_PROVIDERS and
 * TERRA_VIDEO_PROVIDER_GAP_MESSAGE make that gap explicit rather than fabricating a video result.
 */
import type { ResearchDocument, ResearchProviderId, ResearchProviderResponse } from '@/lib/research-engine/core/types'

export const TERRA_RELATED_INTELLIGENCE_MEDIA_TYPES = ['news', 'article', 'official_report', 'video', 'other'] as const
export type TerraRelatedIntelligenceMediaType = (typeof TERRA_RELATED_INTELLIGENCE_MEDIA_TYPES)[number]

export type TerraRelatedIntelligenceResult = {
  id: string
  title: string
  provider: ResearchProviderId
  sourceName: string
  sourceUrl: string | null
  mediaType: TerraRelatedIntelligenceMediaType
  /** True only when the provider/content-type identity genuinely supports it (e.g. ReliefWeb's own
   * 'humanitarian_report' contentType) — never inferred from a domain merely looking authoritative. */
  isOfficialSource: boolean
  publishedAt: string | null
  retrievedAt: string
  snippet: string | null
  /** Always null today — no configured provider supplies a real thumbnail image URL; never
   * synthesized. */
  thumbnailUrl: string | null
}

export type TerraRelatedIntelligenceProviderStatus = {
  provider: ResearchProviderId
  ok: boolean
  configured: boolean
  resultCount: number
  message: string | null
}

/** Only providers a real, currently-integrated Research Engine adapter can honestly classify this
 * way — extend this set only when a new adapter is actually wired, never speculatively. */
const OFFICIAL_REPORT_CONTENT_TYPES = new Set<string>(['humanitarian_report'])

function classifyMediaType(document: ResearchDocument): { mediaType: TerraRelatedIntelligenceMediaType; isOfficialSource: boolean } {
  if (OFFICIAL_REPORT_CONTENT_TYPES.has(document.contentType)) return { mediaType: 'official_report', isOfficialSource: true }
  if (document.contentType === 'web_page') return { mediaType: 'article', isOfficialSource: false }
  return { mediaType: 'other', isOfficialSource: false }
}

export function normalizeTerraRelatedIntelligence(
  documents: ResearchDocument[],
  providerResponses: ResearchProviderResponse[],
  /** Providers the router itself dropped before any adapter ran (e.g. ReliefWeb with no
   * RELIEFWEB_APPNAME configured) — summary.route.rejectedProviders. These never produce a
   * ResearchProviderResponse at all, so without folding them in here a Commander would see no
   * mention of that provider whatsoever rather than an honest "not configured" status. */
  rejectedProviders: { provider: ResearchProviderId; reason: string }[] = [],
): { results: TerraRelatedIntelligenceResult[]; providerStatuses: TerraRelatedIntelligenceProviderStatus[] } {
  const results = documents.map(document => {
    const { mediaType, isOfficialSource } = classifyMediaType(document)
    return {
      id: document.id,
      title: document.title,
      provider: document.provider,
      sourceName: document.sourceName,
      sourceUrl: document.canonicalUrl ?? document.sourceUrl,
      mediaType,
      isOfficialSource,
      publishedAt: document.publishedAt,
      retrievedAt: document.retrievedAt,
      snippet: document.contentSnippet ?? document.summary,
      thumbnailUrl: null,
    }
  })

  const providerStatuses: TerraRelatedIntelligenceProviderStatus[] = [
    ...providerResponses.map(response => ({
      provider: response.provider,
      ok: response.ok,
      configured: response.error?.category !== 'not_configured',
      resultCount: response.documents.length,
      message: response.error?.message ?? null,
    })),
    ...rejectedProviders.map(rejected => ({
      provider: rejected.provider,
      ok: false,
      configured: false,
      resultCount: 0,
      message: rejected.reason,
    })),
  ]

  return { results, providerStatuses }
}

/** Fixed, explicit provider set for event/location Related Intelligence — the exact providers
 * confirmed (by reading the real adapters) to genuinely produce news/article/official-report
 * ResearchDocuments. Not the intent-based router: an explicit list, the same pattern
 * app/api/terra/layers/[layerId]/route.ts already uses for one-providerId layers. */
export const TERRA_EVENT_INTELLIGENCE_PROVIDERS: ResearchProviderId[] = ['exa', 'reliefweb']

export const TERRA_VIDEO_PROVIDER_GAP_MESSAGE =
  'Video coverage — no configured provider. The Research Engine has no video-search adapter today; none is fabricated here.'
