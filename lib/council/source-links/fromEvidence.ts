import type { DeliberationEvidenceReference } from '@/lib/council/family-deliberation/types'
import type { EbcPublicEvidenceRow, EbcPublicSnapshot, EbcPublicSourceRow } from '@/lib/council/evidence-board/types'
import { applyRelevantLocation, classifyCouncilSourceUrl } from './urlSafety'
import type { CouncilSourceLink, SourceAuthorityLabel, SourceFreshnessState } from './types'
import { COUNCIL_SOURCE_LINK_SCHEMA } from './types'

function authorityFrom(source: Pick<EbcPublicSourceRow, 'primary' | 'authoritative' | 'source_type'>): SourceAuthorityLabel {
  const kind = String(source.source_type || '').toLowerCase()
  if (source.primary || kind.includes('primary') || kind.includes('official')) return source.authoritative ? 'OFFICIAL' : 'PRIMARY'
  if (kind.includes('academic') || kind.includes('arxiv') || kind.includes('doi')) return 'ACADEMIC'
  if (kind.includes('tech') || kind.includes('docs') || kind.includes('documentation')) return 'TECHNICAL'
  if (kind.includes('news')) return 'NEWS'
  if (source.authoritative) return 'OFFICIAL'
  if (kind.includes('secondary')) return 'SECONDARY'
  return 'UNKNOWN'
}

function freshnessFrom(decision: string, publishedAt: string | null): SourceFreshnessState {
  if (/stale/i.test(decision)) return 'STALE'
  if (/historic|historical|archive/i.test(decision)) return 'HISTORICAL'
  if (publishedAt) return 'CURRENT'
  return 'UNKNOWN'
}

function isWebSourceType(sourceType: string): boolean {
  return !/repo_config|tool_result|live_telemetry|local_log|internal|receipt/i.test(sourceType)
}

export function councilSourceFromEbc(
  source: EbcPublicSourceRow,
  evidence: EbcPublicEvidenceRow[] = [],
  missionId: string | null = null,
  sessionId: string | null = null,
): CouncilSourceLink {
  const related = evidence.filter(row => row.source_id === source.id)
  const classified = classifyCouncilSourceUrl(source.url)
  const web = classified.ok && isWebSourceType(source.source_type)
  const supporting = source.usable === true
  return {
    schema: COUNCIL_SOURCE_LINK_SCHEMA,
    source_id: source.id,
    title: source.title || (classified.ok ? classified.domain : source.url) || source.id,
    url: classified.ok ? classified.url : (source.url || null),
    domain: classified.ok ? classified.domain : null,
    source_type: source.source_type || 'unknown',
    source_authority: authorityFrom(source),
    published_at: source.published_at,
    observed_at: source.observed_at,
    freshness_state: freshnessFrom(source.relevance_decision, source.published_at),
    claim_ids: [...new Set(related.flatMap(row => row.claim_ids ?? []))],
    evidence_ids: related.map(row => row.id),
    mission_id: missionId,
    session_id: sessionId,
    relevant_location: null,
    internal_open_supported: web,
    external_open_supported: web,
    copy_supported: web,
    usable: source.usable,
    supporting,
    rejection_reason: supporting ? null : (source.relevance_decision || 'REJECTED'),
  }
}

export function councilSourceFromDeliberationRef(
  ref: DeliberationEvidenceReference,
  missionId: string | null = null,
  sessionId: string | null = null,
  claimIds: string[] = [],
): CouncilSourceLink {
  const classified = classifyCouncilSourceUrl(ref.url)
  const web = classified.ok
  return {
    schema: COUNCIL_SOURCE_LINK_SCHEMA,
    source_id: ref.evidence_reference_id,
    title: ref.label || (classified.ok ? classified.domain : ref.evidence_reference_id),
    url: classified.ok ? classified.url : ref.url,
    domain: classified.ok ? classified.domain : null,
    source_type: ref.source_kind || ref.origin_type || 'unknown',
    source_authority: 'UNKNOWN',
    published_at: null,
    observed_at: null,
    freshness_state: 'UNKNOWN',
    claim_ids: claimIds,
    evidence_ids: [ref.evidence_reference_id],
    mission_id: missionId,
    session_id: sessionId,
    relevant_location: null,
    internal_open_supported: web,
    external_open_supported: web,
    copy_supported: web,
    usable: web,
    supporting: web,
    rejection_reason: null,
  }
}

export function councilSourcesFromSnapshot(
  snapshot: Partial<Pick<EbcPublicSnapshot, 'mission_id' | 'sources' | 'evidence'>> | null | undefined,
  sessionId: string | null = null,
): CouncilSourceLink[] {
  if (!snapshot?.sources?.length) return []
  return snapshot.sources.map(source => councilSourceFromEbc(source, snapshot.evidence ?? [], snapshot.mission_id ?? null, sessionId))
}

export function mergeCouncilSources(groups: CouncilSourceLink[][]): CouncilSourceLink[] {
  const seen = new Set<string>()
  const out: CouncilSourceLink[] = []
  for (const group of groups) {
    for (const link of group) {
      const key = `${link.source_id}::${link.url ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(link)
    }
  }
  return out
}

export function navigableUrl(link: CouncilSourceLink): string | null {
  if (!link.internal_open_supported && !link.external_open_supported) return null
  if (!link.url) return null
  return applyRelevantLocation(link.url, link.relevant_location)
}
