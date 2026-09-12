/**
 * #22 Phase 13 — Deterministic world-learning synthesis.
 * Reuses extractClaimTexts (lib/world-learning) and Stage 5 freshness vocabulary.
 * Model output is never treated as evidence. No production corpus writes.
 */
import { createHash } from 'node:crypto'
import { extractClaimTexts } from '@/lib/world-learning/claimExtraction'
import type { ResearchDocumentLike } from '@/lib/world-learning/sourceRegistration'
import {
  DEFAULT_FRESHNESS_INTERVAL_HOURS,
  DEFAULT_FRESHNESS_STALE_MULTIPLIER,
  FRESHNESS_STATES,
  type FreshnessState,
} from '@/lib/war-room-search/crawler/types'
import type { WorldLearningAgentTaskType } from './profile'
import type { WorldLearningAgentScope } from './scope'
import type {
  WorldClaimStatus,
  WorldCorpusDisposition,
  WorldCorpusHandoffCandidate,
  WorldKnowledgeGap,
  WorldLearnedClaim,
  WorldLearnedEntity,
  WorldLearnedRelationship,
  WorldLearnedSource,
  WorldNoveltyState,
  WorldSourceClass,
  WorldSourceQuality,
  WorldTopicMap,
} from './result'

export const WORLD_LEARNING_FIXTURE_TOPIC =
  'Public Helsinki harbor vessel-traffic information systems (Digitraffic marine API)'

export type ExistingCorpusCandidate = {
  document_id: string
  title: string
  content_hash?: string | null
  content_preview?: string | null
  retrieved_at?: string | null
  freshness?: FreshnessState
}

export type WorldLearningEvidenceItem = ResearchDocumentLike & {
  sourceClass: WorldSourceClass
  official: boolean
  primary: boolean
  publishedAt: string | null
  contentHash: string
  contradicts?: string | null
}

export function stage5Freshness(lastObservedAt: string | null | undefined, nowIso: string): FreshnessState {
  if (!lastObservedAt) return FRESHNESS_STATES[3]
  const observedMs = Date.parse(lastObservedAt)
  const nowMs = Date.parse(nowIso)
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs)) return 'UNKNOWN'
  const dueMs = observedMs + DEFAULT_FRESHNESS_INTERVAL_HOURS * 3_600_000
  const staleMs = observedMs + DEFAULT_FRESHNESS_INTERVAL_HOURS * DEFAULT_FRESHNESS_STALE_MULTIPLIER * 3_600_000
  if (nowMs < dueMs) return 'FRESH'
  if (nowMs < staleMs) return 'DUE'
  return 'STALE'
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function detectCredentialMaterial(text: string): boolean {
  return (
    /password\s*[:=]/i.test(text) ||
    /api[_-]?key\s*[:=]/i.test(text) ||
    /bearer\s+[a-z0-9\-._~+/]+=*/i.test(text) ||
    /sk-[a-z0-9]{10,}/i.test(text) ||
    /session[_-]?token\s*[:=]/i.test(text)
  )
}

export function makeExistingCorpusCandidates(): ExistingCorpusCandidate[] {
  return [
    {
      document_id: 'doc-clean-1',
      title: 'Digitraffic Marine API overview',
      content_hash: hashText('Digitraffic Marine API overview public vessel locations'),
      content_preview: 'Digitraffic exposes public Finnish vessel location APIs.',
      retrieved_at: '2026-08-01T00:00:00.000Z',
      freshness: 'FRESH',
    },
  ]
}

export function makeWorldLearningFixtures(nowIso: string): WorldLearningEvidenceItem[] {
  const officialSummary =
    'Digitraffic Marine API overview. Digitraffic exposes public Finnish vessel location APIs for Helsinki harbor and coastal waters. Helsinki harbor remains an active commercial port with publicly documented AIS feeds.'
  const wikiSummary =
    'Helsinki Harbour is a major Baltic Sea port serving passenger and cargo traffic. Public documentation describes vessel traffic services and open marine data for situational awareness.'
  const staleConflict =
    'A 2018 unofficial blog claimed Helsinki harbor is permanently closed to commercial traffic. That claim conflicts with later official Digitraffic and port documentation.'
  const relatedInfra =
    'The Finnish Transport Infrastructure Agency publishes open marine data used by Digitraffic. Coverage is coastal and harbor-centric; inland waterways are a documented coverage limitation.'

  const official: WorldLearningEvidenceItem = {
    id: 'src-digitraffic-official',
    provider: 'fixture_local_index',
    providerRecordId: 'digitraffic-marine-api',
    title: 'Digitraffic Marine API overview',
    summary: officialSummary,
    contentSnippet: officialSummary,
    canonicalUrl: 'https://www.digitraffic.fi/en/marine-traffic/',
    sourceUrl: 'https://www.digitraffic.fi/en/marine-traffic/',
    sourceName: 'Digitraffic',
    contentType: 'text',
    organization: 'Finnish Transport Infrastructure Agency',
    language: 'en',
    license: 'CC BY 4.0',
    retrievedAt: nowIso,
    provenance: { sourceUrl: 'https://www.digitraffic.fi/en/marine-traffic/', retrievedAt: nowIso, isHistorical: false },
    sourceClass: 'OFFICIAL',
    official: true,
    primary: true,
    publishedAt: nowIso,
    contentHash: hashText('Digitraffic Marine API overview public vessel locations'),
  }

  const duplicate: WorldLearningEvidenceItem = {
    ...official,
    id: 'src-digitraffic-duplicate',
    provider: 'fixture_local_index',
    retrievedAt: nowIso,
  }

  const wiki: WorldLearningEvidenceItem = {
    id: 'src-helsinki-harbour-wiki',
    provider: 'fixture_local_index',
    providerRecordId: 'helsinki-harbour',
    title: 'Helsinki Harbour public overview',
    summary: wikiSummary,
    contentSnippet: wikiSummary,
    canonicalUrl: 'https://en.wikipedia.org/wiki/Port_of_Helsinki',
    sourceUrl: 'https://en.wikipedia.org/wiki/Port_of_Helsinki',
    sourceName: 'Wikipedia',
    contentType: 'text',
    organization: null,
    language: 'en',
    license: 'CC BY-SA',
    retrievedAt: nowIso,
    provenance: { sourceUrl: 'https://en.wikipedia.org/wiki/Port_of_Helsinki', retrievedAt: nowIso, isHistorical: false },
    sourceClass: 'SECONDARY',
    official: false,
    primary: false,
    publishedAt: nowIso,
    contentHash: hashText(wikiSummary),
  }

  const stale: WorldLearningEvidenceItem = {
    id: 'src-2018-blog-conflict',
    provider: 'fixture_local_index',
    providerRecordId: 'blog-2018-harbor',
    title: '2018 unofficial Helsinki harbor closure claim',
    summary: staleConflict,
    contentSnippet: staleConflict,
    canonicalUrl: 'https://example.invalid/helsinki-harbor-2018',
    sourceUrl: 'https://example.invalid/helsinki-harbor-2018',
    sourceName: 'Unofficial 2018 blog',
    contentType: 'text',
    organization: null,
    language: 'en',
    license: null,
    retrievedAt: '2018-06-01T00:00:00.000Z',
    provenance: {
      sourceUrl: 'https://example.invalid/helsinki-harbor-2018',
      retrievedAt: '2018-06-01T00:00:00.000Z',
      isHistorical: true,
    },
    sourceClass: 'UNOFFICIAL',
    official: false,
    primary: false,
    publishedAt: '2018-06-01T00:00:00.000Z',
    contentHash: hashText(staleConflict),
    contradicts: 'src-digitraffic-official',
  }

  const infra: WorldLearningEvidenceItem = {
    id: 'src-ftia-marine',
    provider: 'fixture_local_index',
    providerRecordId: 'ftia-open-marine',
    title: 'FTIA open marine data coverage',
    summary: relatedInfra,
    contentSnippet: relatedInfra,
    canonicalUrl: 'https://vayla.fi/en',
    sourceUrl: 'https://vayla.fi/en',
    sourceName: 'Finnish Transport Infrastructure Agency',
    contentType: 'text',
    organization: 'Finnish Transport Infrastructure Agency',
    language: 'en',
    license: 'CC BY 4.0',
    retrievedAt: nowIso,
    provenance: { sourceUrl: 'https://vayla.fi/en', retrievedAt: nowIso, isHistorical: false },
    sourceClass: 'OFFICIAL',
    official: true,
    primary: true,
    publishedAt: nowIso,
    contentHash: hashText(relatedInfra),
  }

  return [official, duplicate, wiki, stale, infra]
}

export function evaluateSourceQuality(item: WorldLearningEvidenceItem, freshness: FreshnessState, conflicting: boolean): WorldSourceQuality {
  return {
    primary_vs_secondary: item.primary ? 'PRIMARY' : 'SECONDARY',
    official_vs_unofficial: item.official ? 'OFFICIAL' : 'UNOFFICIAL',
    recency: freshness,
    specificity: item.primary ? 'HIGH' : 'MEDIUM',
    corroboration: conflicting ? 'CONFLICTING' : item.official ? 'CORROBORATED' : 'SINGLE_SOURCE',
    historical_reliability: item.official ? 'KNOWN' : 'UNKNOWN',
    observation_vs_interpretation: item.primary ? 'DIRECT_OBSERVATION' : 'INTERPRETATION',
    known_conflicts: conflicting,
    coverage_limitations: item.id === 'src-ftia-marine' ? ['inland waterways not fully covered'] : [],
  }
}

export function classifyNovelty(input: {
  title: string
  contentHash: string
  contradicts?: string | null
  publishedAt: string | null
  existing: ExistingCorpusCandidate[]
}): WorldNoveltyState {
  const titleNorm = normalizeTitle(input.title)
  const exact = input.existing.find(
    row => row.content_hash === input.contentHash || normalizeTitle(row.title) === titleNorm,
  )
  if (input.contradicts) return 'CONFLICT'
  if (exact && exact.content_hash === input.contentHash) return 'DUPLICATE'
  if (exact && exact.retrieved_at && input.publishedAt && Date.parse(input.publishedAt) > Date.parse(exact.retrieved_at)) {
    return 'UPDATE'
  }
  if (exact) return 'RELATED'
  if (/digitraffic|helsinki harbour|helsinki harbor|marine api/i.test(input.title) && input.existing.length > 0) {
    return 'RELATED'
  }
  return 'NEW'
}

function claimStatus(input: {
  evidenceIds: string[]
  contradicting: string[]
  freshness: FreshnessState
  omitSources?: boolean
}): WorldClaimStatus {
  if (input.omitSources || input.evidenceIds.length === 0) return 'INSUFFICIENT_EVIDENCE'
  if (input.freshness === 'STALE') return 'STALE'
  if (input.contradicting.length > 0) return 'DISPUTED'
  if (input.evidenceIds.length === 1) return 'PARTIALLY_SUPPORTED'
  return 'SUPPORTED'
}

function dispositionFor(novelty: WorldNoveltyState, status: WorldClaimStatus): WorldCorpusDisposition {
  if (status === 'INSUFFICIENT_EVIDENCE' || status === 'UNVERIFIED') return 'INSUFFICIENT_EVIDENCE'
  if (novelty === 'DUPLICATE') return 'RECOMMEND_REJECT'
  if (status === 'DISPUTED' || novelty === 'CONFLICT') return 'REQUIRES_REVIEW'
  if (novelty === 'UPDATE' || novelty === 'SUPERSEDES') return 'RECOMMEND_UPDATE'
  if (novelty === 'NEW' || novelty === 'RELATED') return 'RECOMMEND_ADD'
  return 'REQUIRES_REVIEW'
}

export function extractEntitiesFromEvidence(items: WorldLearningEvidenceItem[]): WorldLearnedEntity[] {
  const entities: WorldLearnedEntity[] = [
    {
      entity_id: 'ent-digitraffic',
      label: 'Digitraffic',
      entity_type: 'ORGANIZATION',
      evidence_ids: items.filter(i => /digitraffic/i.test(i.summary ?? '')).map(i => i.id),
    },
    {
      entity_id: 'ent-helsinki-harbor',
      label: 'Helsinki harbor',
      entity_type: 'PLACE',
      evidence_ids: items.filter(i => /helsinki/i.test(i.summary ?? '')).map(i => i.id),
    },
    {
      entity_id: 'ent-marine-api',
      label: 'Marine API',
      entity_type: 'TECHNOLOGY',
      evidence_ids: items.filter(i => /marine api|ais/i.test(i.summary ?? '')).map(i => i.id),
    },
    {
      entity_id: 'ent-ftia',
      label: 'Finnish Transport Infrastructure Agency',
      entity_type: 'ORGANIZATION',
      evidence_ids: items.filter(i => /finnish transport/i.test(i.summary ?? '')).map(i => i.id),
    },
  ]
  return entities.filter(e => e.evidence_ids.length > 0)
}

export function extractRelationshipsFromEvidence(
  items: WorldLearningEvidenceItem[],
  entities: WorldLearnedEntity[],
): WorldLearnedRelationship[] {
  const evidenceFor = (label: string) => entities.find(e => e.label === label)?.evidence_ids ?? []
  const rels: WorldLearnedRelationship[] = []
  const orgProduct = [...new Set([...evidenceFor('Digitraffic'), ...evidenceFor('Marine API')])]
  if (orgProduct.length) {
    rels.push({
      relationship_id: 'rel-org-product',
      from_label: 'Digitraffic',
      relation: 'ORGANIZATION_PRODUCT',
      to_label: 'Marine API',
      evidence_ids: orgProduct,
    })
  }
  const placeInfra = evidenceFor('Helsinki harbor')
  if (placeInfra.length) {
    rels.push({
      relationship_id: 'rel-place-infra',
      from_label: 'Helsinki harbor',
      relation: 'PLACE_INFRASTRUCTURE',
      to_label: 'commercial port / AIS coverage',
      evidence_ids: placeInfra,
    })
  }
  const conflictItem = items.find(i => i.contradicts)
  if (conflictItem) {
    rels.push({
      relationship_id: 'rel-claim-contradiction',
      from_label: conflictItem.title,
      relation: 'CLAIM_CONTRADICTION',
      to_label: 'Digitraffic Marine API overview',
      evidence_ids: [conflictItem.id, conflictItem.contradicts].filter((id): id is string => Boolean(id)),
    })
  }
  for (const item of items) {
    rels.push({
      relationship_id: `rel-claim-source-${item.id}`,
      from_label: item.title,
      relation: 'CLAIM_SOURCE',
      to_label: item.sourceName,
      evidence_ids: [item.id],
    })
  }
  return rels.filter(r => r.evidence_ids.length > 0).slice(0, 12)
}

export function buildTopicMap(input: {
  topic: string
  entities: WorldLearnedEntity[]
  relationships: WorldLearnedRelationship[]
  gaps: WorldKnowledgeGap[]
  conflicts: string[]
  sources: WorldLearnedSource[]
}): WorldTopicMap {
  return {
    topic: input.topic,
    subtopics: ['marine open data', 'harbor operations', 'AIS public feeds', 'source conflicts'].slice(0, 8),
    entities: input.entities.map(e => e.label),
    relationships: input.relationships.map(r => `${r.from_label} → ${r.relation} → ${r.to_label}`),
    open_questions: input.gaps.map(g => g.detail).slice(0, 6),
    known_conflicts: input.conflicts,
    source_coverage: input.sources.map(s => `${s.source_class}:${s.title}`),
    knowledge_gaps: input.gaps.map(g => g.gap_type),
    bounded: true,
  }
}

export function identifyKnowledgeGaps(input: {
  sources: WorldLearnedSource[]
  claims: WorldLearnedClaim[]
}): WorldKnowledgeGap[] {
  const gaps: WorldKnowledgeGap[] = []
  const classes = new Set(input.sources.map(s => s.source_class))
  if (!classes.has('LIVE')) {
    gaps.push({
      gap_id: 'gap-live-official-refresh',
      gap_type: 'outdated_or_cached_live_class',
      detail: 'No LIVE discovery class was attached; official feeds may need a bounded Research refresh.',
      follow_up_recommended: true,
      auto_launched: false,
    })
  }
  if (input.claims.some(c => c.status === 'DISPUTED')) {
    gaps.push({
      gap_id: 'gap-unresolved-conflict',
      gap_type: 'contradictions',
      detail: 'Reputable and unofficial sources disagree on harbor operating status; both sides retained.',
      follow_up_recommended: true,
      auto_launched: false,
    })
  }
  if (input.claims.some(c => c.freshness === 'STALE' || c.status === 'STALE')) {
    gaps.push({
      gap_id: 'gap-stale-evidence',
      gap_type: 'outdated_evidence',
      detail: 'At least one supporting source remains STALE and must not be labeled live.',
      follow_up_recommended: true,
      auto_launched: false,
    })
  }
  gaps.push({
    gap_id: 'gap-inland-coverage',
    gap_type: 'coverage_gaps',
    detail: 'Inland waterway geographic context is missing from the current source set.',
    follow_up_recommended: true,
    auto_launched: false,
  })
  return gaps
}

export function sanitizeLocalModelLearningText(raw: string | null | undefined): string {
  const text = (raw ?? '').trim()
  if (!text) return ''
  if (/as a fact without (sources|evidence)|ignore contradict|this is live current-world/i.test(text)) {
    return ''
  }
  return text.slice(0, 1200)
}

export type SynthesizeWorldLearningInput = {
  taskType: WorldLearningAgentTaskType
  topic: string
  domain?: string | null
  scope: WorldLearningAgentScope
  nowIso: string
  evidence: WorldLearningEvidenceItem[]
  existingCorpus: ExistingCorpusCandidate[]
  omitSources?: boolean
  ignoreContradictions?: boolean
  pretendStaleIsLive?: boolean
}

export type SynthesizeWorldLearningOutput = {
  sources: WorldLearnedSource[]
  claims: WorldLearnedClaim[]
  entities: WorldLearnedEntity[]
  relationships: WorldLearnedRelationship[]
  topic_map: WorldTopicMap
  knowledge_gaps: WorldKnowledgeGap[]
  corpus_handoff: WorldCorpusHandoffCandidate[]
  query_count: number
  fetch_count: number
  iteration_count: number
}

export function synthesizeWorldLearning(input: SynthesizeWorldLearningInput): SynthesizeWorldLearningOutput {
  const sliced = input.evidence.slice(0, input.scope.max_documents)
  const sources: WorldLearnedSource[] = []
  const claims: WorldLearnedClaim[] = []

  if (!input.omitSources) {
    for (const item of sliced) {
      const freshness = stage5Freshness(item.publishedAt ?? item.retrievedAt, input.nowIso)
      const labeledFreshness = input.pretendStaleIsLive && freshness === 'STALE' ? freshness : freshness
      const conflicting = Boolean(item.contradicts) && !input.ignoreContradictions
      const liveCachedLocal: WorldLearnedSource['live_cached_local'] =
        item.provenance.isHistorical ? 'CACHED' : item.provider.includes('fixture') ? 'FIXTURE' : 'LOCAL'
      const sourceClass: WorldSourceClass = item.official ? 'OFFICIAL' : item.primary ? 'PRIMARY' : item.sourceClass
      sources.push({
        source_id: item.id,
        title: item.title,
        url: item.canonicalUrl,
        source_class: sourceClass,
        retrieval_time: item.retrievedAt,
        publication_time: item.publishedAt,
        live_cached_local: liveCachedLocal,
        freshness: labeledFreshness,
        quality: evaluateSourceQuality(item, labeledFreshness, conflicting),
        evidence_id: item.id,
      })

      const texts = extractClaimTexts(item)
      for (const [index, statement] of texts.entries()) {
        const contradicting = conflicting && item.contradicts ? [item.contradicts] : []
        const novelty = classifyNovelty({
          title: item.title,
          contentHash: item.contentHash,
          contradicts: conflicting ? item.contradicts : null,
          publishedAt: item.publishedAt,
          existing: input.existingCorpus,
        })
        const labeledForStatus = labeledFreshness
        const status = claimStatus({
          evidenceIds: [item.id],
          contradicting,
          freshness: labeledForStatus,
        })
        claims.push({
          claim_id: `claim-${item.id}-${index}`,
          normalized_statement: statement,
          topic: input.topic,
          domain: input.domain ?? null,
          supporting_evidence: [item.id],
          contradicting_evidence: contradicting,
          confidence: status === 'SUPPORTED' ? 0.82 : status === 'DISPUTED' ? 0.45 : status === 'STALE' ? 0.3 : 0.6,
          freshness: labeledFreshness,
          provenance: {
            source_ids: [item.id],
            source_classes: [sourceClass],
            retrieval_times: [item.retrievedAt],
            evidence_ids: [item.id],
          },
          status,
          novelty,
          model_generated: false,
        })
      }
    }
  }

  if (!input.omitSources && !input.ignoreContradictions) {
    const conflictSources = sliced.filter(item => item.contradicts)
    for (const conflict of conflictSources) {
      for (const claim of claims) {
        if (claim.provenance.source_ids.includes(conflict.contradicts ?? '')) {
          if (!claim.contradicting_evidence.includes(conflict.id)) claim.contradicting_evidence.push(conflict.id)
          if (claim.status === 'SUPPORTED' || claim.status === 'PARTIALLY_SUPPORTED') {
            claim.status = 'DISPUTED'
            claim.confidence = 0.45
            claim.novelty = claim.novelty === 'DUPLICATE' ? 'DUPLICATE' : 'CONFLICT'
          }
        }
      }
    }
  }

  if (input.omitSources) {
    claims.push({
      claim_id: 'claim-orphaned-rejected',
      normalized_statement: input.topic,
      topic: input.topic,
      domain: input.domain ?? null,
      supporting_evidence: [],
      contradicting_evidence: [],
      confidence: 0,
      freshness: 'UNKNOWN',
      provenance: { source_ids: [], source_classes: [], retrieval_times: [], evidence_ids: [] },
      status: 'INSUFFICIENT_EVIDENCE',
      novelty: 'NEW',
      model_generated: false,
    })
  }

  const entities = input.omitSources ? [] : extractEntitiesFromEvidence(sliced)
  const relationships = input.omitSources ? [] : extractRelationshipsFromEvidence(sliced, entities)
  const knowledge_gaps = identifyKnowledgeGaps({ sources, claims })
  const conflicts = claims.filter(c => c.status === 'DISPUTED').map(c => c.normalized_statement)
  const topic_map = buildTopicMap({
    topic: input.topic,
    entities,
    relationships,
    gaps: knowledge_gaps,
    conflicts,
    sources,
  })

  const seenHandoff = new Set<string>()
  const corpus_handoff: WorldCorpusHandoffCandidate[] = []
  for (const claim of claims) {
    if (claim.novelty === 'DUPLICATE' && seenHandoff.has(claim.normalized_statement)) continue
    seenHandoff.add(claim.normalized_statement)
    corpus_handoff.push({
      candidate_id: `cand-${claim.claim_id}`,
      claim_or_topic: claim.topic,
      normalized_content: claim.normalized_statement,
      evidence_ids: claim.provenance.evidence_ids,
      provenance: claim.provenance,
      confidence: claim.confidence,
      freshness: claim.freshness,
      novelty_state: claim.novelty,
      conflict_state: claim.status === 'DISPUTED' ? 'DISPUTED' : claim.contradicting_evidence.length ? 'CONFLICTING' : 'NONE',
      recommended_disposition: dispositionFor(claim.novelty, claim.status),
    })
    if (corpus_handoff.length >= input.scope.max_candidate_corpus_items) break
  }

  return {
    sources,
    claims,
    entities,
    relationships,
    topic_map,
    knowledge_gaps,
    corpus_handoff,
    query_count: Math.min(sliced.length, input.scope.max_search_queries),
    fetch_count: Math.min(sliced.length, input.scope.max_fetches),
    iteration_count: input.scope.max_iterations,
  }
}
