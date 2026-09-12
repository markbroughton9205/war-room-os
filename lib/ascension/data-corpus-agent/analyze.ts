/**
 * #22 Phase 8 — Pure corpus curation analysis (fixtures + optional records).
 * Reuses Stage 5 freshness vocabulary (FRESH/DUE/STALE/UNKNOWN). No second corpus system.
 */
import { CHUNKING_VERSION, LOCAL_EMBEDDING_MODEL_ID } from '@/lib/war-room-search/hybrid/types'
import { ROADMAP_23_STATUS } from './identity'
import type { DataCorpusScope } from './scope'
import {
  type CorpusDocumentFinding,
  type CorpusDuplicateGroup,
  type CorpusOwnershipScope,
  type CorpusQualityState,
  type DataCorpusWriteRecord,
  type RetrievalSuitability,
  type WrCorpusSuitability,
} from './result'
import { assertPrivateNotPromotedToShared } from './ownership'

export type CorpusRecordInput = {
  document_id: string
  chunk_ids?: string[]
  content_hash?: string | null
  near_hash?: string | null
  title?: string
  content_preview?: string | null
  source_url?: string | null
  provider?: string | null
  retrieved_at?: string | null
  freshness?: 'FRESH' | 'DUE' | 'STALE' | 'UNKNOWN'
  ownership_scope?: CorpusOwnershipScope
  license_metadata?: string | null
  malformed?: boolean
  conflicting_with?: string | null
  empty_content?: boolean
  from_research_handoff?: boolean
  from_terra_live?: boolean
  validator_flagged?: boolean
  security_flagged?: boolean
  bytes?: number
}

export type AnalyzeCorpusInput = {
  scope: DataCorpusScope
  records?: CorpusRecordInput[]
  useFixtures?: boolean
  promotePrivateToShared?: boolean
  autoDeleteDuplicates?: boolean
  startRoadmap23?: boolean
}

export type AnalyzeCorpusOutput = {
  findings: CorpusDocumentFinding[]
  duplicate_groups: CorpusDuplicateGroup[]
  provenance_gaps: string[]
  license_gaps: string[]
  stale_records: string[]
  conflicts: string[]
  retrieval_suitability: Array<{ document_id: string; suitability: RetrievalSuitability }>
  wr_corpus_candidates: Array<{ document_id: string; suitability: WrCorpusSuitability; recommendation_only: true }>
  wr_corpus_exclusions: string[]
  review_required: string[]
  writes_performed: DataCorpusWriteRecord[]
  limitations: string[]
  unavailable: string[]
  documents_examined: number
  chunks_examined: number
  quality_summary: string
  frozen_chunk_version: typeof CHUNKING_VERSION
  frozen_embedding_model: typeof LOCAL_EMBEDDING_MODEL_ID
  roadmap_23_status: typeof ROADMAP_23_STATUS
}

/** Harmless fixture set for live-safe / deterministic proofs. */
export function makeDataCorpusFixtures(): CorpusRecordInput[] {
  return [
    {
      document_id: 'doc-clean-1',
      chunk_ids: ['doc-clean-1#0', 'doc-clean-1#1'],
      content_hash: 'hash-clean-aaa',
      title: 'Digitraffic Marine API overview',
      content_preview: 'Public AIS documentation for Digitraffic Marine.',
      source_url: 'https://www.digitraffic.fi/en/marine-traffic/',
      provider: 'sovereign_corpus_fixture',
      retrieved_at: new Date().toISOString(),
      freshness: 'FRESH',
      ownership_scope: 'PUBLIC_SOURCE',
      license_metadata: 'public documentation; review for reuse',
      bytes: 1200,
    },
    {
      document_id: 'doc-dup-exact-a',
      chunk_ids: ['doc-dup-exact-a#0'],
      content_hash: 'hash-exact-dup',
      title: 'Exact duplicate A',
      content_preview: 'Identical body text for exact duplicate proof.',
      source_url: 'https://example.com/a',
      provider: 'fixture',
      retrieved_at: new Date().toISOString(),
      freshness: 'FRESH',
      ownership_scope: 'PUBLIC_SOURCE',
      license_metadata: 'example',
      bytes: 400,
    },
    {
      document_id: 'doc-dup-exact-b',
      chunk_ids: ['doc-dup-exact-b#0'],
      content_hash: 'hash-exact-dup',
      title: 'Exact duplicate B',
      content_preview: 'Identical body text for exact duplicate proof.',
      source_url: 'https://example.com/b',
      provider: 'fixture',
      retrieved_at: new Date().toISOString(),
      freshness: 'FRESH',
      ownership_scope: 'PUBLIC_SOURCE',
      license_metadata: 'example',
      bytes: 400,
    },
    {
      document_id: 'doc-near-1',
      chunk_ids: ['doc-near-1#0'],
      content_hash: 'hash-near-1',
      near_hash: 'near-family-x',
      title: 'Near duplicate one',
      content_preview: 'Vessel observed near Helsinki harbor using AIS.',
      source_url: 'https://example.com/near-1',
      provider: 'fixture',
      freshness: 'FRESH',
      ownership_scope: 'PUBLIC_SOURCE',
      license_metadata: 'example',
      bytes: 380,
    },
    {
      document_id: 'doc-near-2',
      chunk_ids: ['doc-near-2#0'],
      content_hash: 'hash-near-2',
      near_hash: 'near-family-x',
      title: 'Near duplicate two',
      content_preview: 'Vessel observed near Helsinki harbour using AIS feed.',
      source_url: 'https://example.com/near-2',
      provider: 'fixture',
      freshness: 'FRESH',
      ownership_scope: 'PUBLIC_SOURCE',
      license_metadata: 'example',
      bytes: 390,
    },
    {
      document_id: 'doc-stale-1',
      chunk_ids: ['doc-stale-1#0'],
      content_hash: 'hash-stale',
      title: 'Stale crawl capture',
      content_preview: 'Older crawl body.',
      source_url: 'https://example.com/stale',
      provider: 'fixture',
      freshness: 'STALE',
      ownership_scope: 'PUBLIC_SOURCE',
      license_metadata: 'example',
      bytes: 300,
    },
    {
      document_id: 'doc-no-prov',
      chunk_ids: ['doc-no-prov#0'],
      content_hash: 'hash-noprov',
      title: 'Missing provenance',
      content_preview: 'Body without source url/provider.',
      source_url: null,
      provider: null,
      freshness: 'UNKNOWN',
      ownership_scope: 'UNKNOWN_SCOPE',
      license_metadata: null,
      bytes: 200,
    },
    {
      document_id: 'doc-malformed',
      chunk_ids: [],
      content_hash: null,
      title: 'Malformed',
      content_preview: null,
      empty_content: true,
      malformed: true,
      freshness: 'UNKNOWN',
      ownership_scope: 'SYSTEM_INTERNAL',
      bytes: 0,
    },
    {
      document_id: 'doc-conflict-a',
      chunk_ids: ['doc-conflict-a#0'],
      content_hash: 'hash-conflict-a',
      title: 'Conflicting A',
      content_preview: 'Heading north.',
      source_url: 'https://example.com/c-a',
      provider: 'fixture-a',
      freshness: 'FRESH',
      ownership_scope: 'PUBLIC_SOURCE',
      license_metadata: 'example',
      conflicting_with: 'doc-conflict-b',
      bytes: 250,
    },
    {
      document_id: 'doc-conflict-b',
      chunk_ids: ['doc-conflict-b#0'],
      content_hash: 'hash-conflict-b',
      title: 'Conflicting B',
      content_preview: 'Heading south.',
      source_url: 'https://example.com/c-b',
      provider: 'fixture-b',
      freshness: 'FRESH',
      ownership_scope: 'PUBLIC_SOURCE',
      license_metadata: 'example',
      conflicting_with: 'doc-conflict-a',
      bytes: 250,
    },
    {
      document_id: 'doc-private-cmd',
      chunk_ids: ['doc-private-cmd#0'],
      content_hash: 'hash-private',
      title: 'Commander private note',
      content_preview: 'Private session excerpt.',
      source_url: null,
      provider: 'session',
      freshness: 'FRESH',
      ownership_scope: 'COMMANDER_PRIVATE',
      license_metadata: null,
      bytes: 180,
    },
    {
      document_id: 'doc-research-cand',
      chunk_ids: ['doc-research-cand#0'],
      content_hash: 'hash-research',
      title: 'Research handoff candidate',
      content_preview: 'Research Agent evidence packet summary.',
      source_url: 'https://example.com/research',
      provider: 'research_agent',
      freshness: 'FRESH',
      ownership_scope: 'PUBLIC_SOURCE',
      license_metadata: 'review',
      from_research_handoff: true,
      bytes: 500,
    },
    {
      document_id: 'doc-terra-live',
      chunk_ids: ['doc-terra-live#0'],
      content_hash: 'hash-terra-live',
      title: 'Terra live observation',
      content_preview: 'Ephemeral AIS observation.',
      source_url: 'https://meri.digitraffic.fi/',
      provider: 'digitraffic_marine',
      freshness: 'FRESH',
      ownership_scope: 'PUBLIC_SOURCE',
      license_metadata: 'open data',
      from_terra_live: true,
      bytes: 220,
    },
  ]
}

function classifyRetrieval(rec: CorpusRecordInput, qualities: CorpusQualityState[]): RetrievalSuitability {
  if (rec.malformed || rec.empty_content || !rec.content_preview) return 'NOT_RETRIEVAL_READY'
  if (qualities.includes('MISSING_PROVENANCE') || qualities.includes('STALE') || qualities.includes('DUPLICATE')) {
    return 'RETRIEVAL_LIMITED'
  }
  return 'RETRIEVAL_READY'
}

function classifyWrCorpus(rec: CorpusRecordInput, qualities: CorpusQualityState[]): WrCorpusSuitability {
  if (rec.ownership_scope === 'COMMANDER_PRIVATE' || rec.ownership_scope === 'USER_PRIVATE') {
    return 'WR_CORPUS_EXCLUDE'
  }
  if (rec.from_terra_live) return 'WR_CORPUS_REVIEW_REQUIRED'
  if (rec.from_research_handoff) return 'WR_CORPUS_REVIEW_REQUIRED'
  if (
    qualities.includes('MISSING_PROVENANCE') ||
    qualities.includes('MISSING_LICENSE_METADATA') ||
    qualities.includes('MALFORMED') ||
    qualities.includes('STALE') ||
    qualities.includes('CONFLICTING')
  ) {
    return 'WR_CORPUS_REVIEW_REQUIRED'
  }
  if (qualities.includes('HIGH_QUALITY') || qualities.includes('ACCEPTABLE')) return 'WR_CORPUS_CANDIDATE'
  return 'UNKNOWN'
}

export function analyzeCorpus(input: AnalyzeCorpusInput): AnalyzeCorpusOutput {
  const limitations: string[] = [
    'Search Stage 4 ranking/thresholds unchanged.',
    `Embedding model frozen: ${LOCAL_EMBEDDING_MODEL_ID}`,
    `Chunk version frozen: ${CHUNKING_VERSION}`,
    'No new crawler / corpus system created.',
    '#23 WR-CORPUS ACTIVE — WR-CORPUS suitability is recommendation only; promotion is Commander-governed.',
    'Deduplication finding != deletion authorization.',
  ]
  const unavailable: string[] = []
  const provenance_gaps: string[] = []
  const license_gaps: string[] = []
  const stale_records: string[] = []
  const conflicts: string[] = []
  const review_required: string[] = []
  const wr_corpus_exclusions: string[] = []
  const writes_performed: DataCorpusWriteRecord[] = []

  if (input.startRoadmap23) {
    limitations.push('Attempt to start tokenizer/WRIM/Ra\'el via this agent denied — WR-CORPUS already implemented; those lanes remain NOT_STARTED.')
  }

  const records = (input.records?.length
    ? input.records
    : input.useFixtures !== false
      ? makeDataCorpusFixtures()
      : []
  ).slice(0, input.scope.max_documents)

  let byteBudget = 0
  const filtered: CorpusRecordInput[] = []
  for (const r of records) {
    const b = r.bytes ?? 0
    if (byteBudget + b > input.scope.max_bytes) break
    byteBudget += b
    filtered.push(r)
  }

  // Exact + near duplicate groups via content_hash / near_hash
  const byHash = new Map<string, string[]>()
  const byNear = new Map<string, string[]>()
  for (const r of filtered) {
    if (r.content_hash) {
      const list = byHash.get(r.content_hash) ?? []
      list.push(r.document_id)
      byHash.set(r.content_hash, list)
    }
    if (r.near_hash) {
      const list = byNear.get(r.near_hash) ?? []
      list.push(r.document_id)
      byNear.set(r.near_hash, list)
    }
  }

  const duplicate_groups: CorpusDuplicateGroup[] = []
  for (const [hash, ids] of byHash) {
    if (ids.length >= 2) {
      duplicate_groups.push({
        group_id: `exact:${hash}`,
        dedupe_state: 'EXACT_DUPLICATE',
        document_ids: ids,
        content_hash: hash,
        auto_deleted: false,
      })
    }
  }
  for (const [near, ids] of byNear) {
    if (ids.length >= 2) {
      duplicate_groups.push({
        group_id: `near:${near}`,
        dedupe_state: 'NEAR_DUPLICATE',
        document_ids: ids,
        content_hash: null,
        auto_deleted: false,
      })
    }
  }
  if (input.autoDeleteDuplicates) {
    limitations.push('Auto-delete duplicates denied — findings only; auto_deleted=false.')
  }
  const duplicate_groups_capped = duplicate_groups.slice(0, input.scope.max_duplicate_groups)

  const exactDupIds = new Set(
    duplicate_groups_capped.filter(g => g.dedupe_state === 'EXACT_DUPLICATE').flatMap(g => g.document_ids),
  )
  const nearDupIds = new Set(
    duplicate_groups_capped.filter(g => g.dedupe_state === 'NEAR_DUPLICATE').flatMap(g => g.document_ids),
  )

  const findings: CorpusDocumentFinding[] = []
  let chunks = 0

  for (const rec of filtered) {
    chunks += (rec.chunk_ids ?? []).length
    const qualities: CorpusQualityState[] = []
    const notes: string[] = []
    const ownership = rec.ownership_scope ?? 'UNKNOWN_SCOPE'
    const provenance_present = Boolean(rec.source_url || rec.provider)
    const license_metadata_present = Boolean(rec.license_metadata)

    if (rec.malformed || rec.empty_content) {
      qualities.push('MALFORMED')
      notes.push('Malformed or empty content.')
    }
    if (!provenance_present) {
      qualities.push('MISSING_PROVENANCE')
      provenance_gaps.push(rec.document_id)
      notes.push('Missing provenance.')
    }
    if (!license_metadata_present) {
      qualities.push('MISSING_LICENSE_METADATA')
      license_gaps.push(rec.document_id)
      notes.push('Missing license metadata.')
    }
    if (rec.freshness === 'STALE') {
      qualities.push('STALE')
      stale_records.push(rec.document_id)
    }
    if (exactDupIds.has(rec.document_id)) qualities.push('DUPLICATE')
    if (nearDupIds.has(rec.document_id)) qualities.push('NEAR_DUPLICATE')
    if (rec.conflicting_with) {
      qualities.push('CONFLICTING')
      conflicts.push(`${rec.document_id} conflicts with ${rec.conflicting_with}`)
    }
    if (rec.validator_flagged || rec.security_flagged) {
      qualities.push('REVIEW_REQUIRED')
      review_required.push(rec.document_id)
      notes.push(
        rec.validator_flagged
          ? 'Council Validator finding consumed for review — does not authorize deletion.'
          : 'Security finding consumed for review — does not authorize deletion.',
      )
    }
    if (rec.from_research_handoff) {
      notes.push('Research handoff is candidate/review only — not auto-ingested.')
      review_required.push(rec.document_id)
    }
    if (rec.from_terra_live) {
      notes.push('TERRA LIVE OBSERVATION != TRAINING DATA APPROVED.')
      review_required.push(rec.document_id)
    }

    if (input.promotePrivateToShared) {
      const promo = assertPrivateNotPromotedToShared(ownership)
      if (!promo.ok) {
        qualities.push('OUT_OF_SCOPE')
        notes.push(promo.reason)
        wr_corpus_exclusions.push(rec.document_id)
      }
    } else if (ownership === 'COMMANDER_PRIVATE' || ownership === 'USER_PRIVATE') {
      qualities.push('OUT_OF_SCOPE')
      notes.push('Private owner material excluded from shared corpus promotion.')
      wr_corpus_exclusions.push(rec.document_id)
    }

    if (qualities.length === 0) {
      qualities.push('HIGH_QUALITY')
    } else if (
      !qualities.includes('MALFORMED') &&
      !qualities.includes('MISSING_PROVENANCE') &&
      !qualities.includes('DUPLICATE') &&
      !qualities.includes('OUT_OF_SCOPE')
    ) {
      const mildOnly = qualities.every(
        (q): boolean =>
          q === 'MISSING_LICENSE_METADATA' ||
          q === 'NEAR_DUPLICATE' ||
          q === 'STALE' ||
          q === 'REVIEW_REQUIRED',
      )
      if (mildOnly) {
        qualities.push('ACCEPTABLE')
      } else if (qualities.includes('CONFLICTING') && !qualities.includes('LOW_QUALITY')) {
        qualities.push('LOW_QUALITY')
      }
    }

    const retrieval = classifyRetrieval(rec, qualities)
    const wr = classifyWrCorpus(rec, qualities)
    if (wr === 'WR_CORPUS_EXCLUDE') wr_corpus_exclusions.push(rec.document_id)
    if (wr === 'WR_CORPUS_REVIEW_REQUIRED') review_required.push(rec.document_id)

    findings.push({
      document_id: rec.document_id,
      quality: [...new Set(qualities)],
      freshness: rec.freshness ?? 'UNKNOWN',
      ownership_scope: ownership,
      retrieval_suitability: retrieval,
      wr_corpus_suitability: wr,
      provenance_present,
      license_metadata_present,
      content_hash: rec.content_hash ?? null,
      notes,
    })

    // Bounded annotation writes — in-memory only, never production corpus mutation
    if (input.scope.allow_metadata_write && writes_performed.length < input.scope.max_writes) {
      writes_performed.push({
        kind: 'METADATA_ANNOTATION',
        document_id: rec.document_id,
        label: qualities[0] ?? 'UNVERIFIED',
        persisted_to_production_corpus: false,
      })
    }
    if (
      input.scope.allow_index_support_write &&
      writes_performed.length < input.scope.max_writes &&
      retrieval === 'RETRIEVAL_READY'
    ) {
      writes_performed.push({
        kind: 'INDEX_SUPPORT_ANNOTATION',
        document_id: rec.document_id,
        label: 'INDEX_SUPPORT_OK',
        persisted_to_production_corpus: false,
      })
    }
  }

  if (!input.scope.allow_metadata_write && !input.scope.allow_index_support_write) {
    limitations.push('Write path not enabled — READ_ONLY / annotation skipped.')
  } else {
    limitations.push('Annotation writes are in-memory session labels only — not production corpus mutation.')
  }

  const retrieval_suitability = findings.map(f => ({
    document_id: f.document_id,
    suitability: f.retrieval_suitability,
  }))
  const wr_corpus_candidates = findings
    .filter(f => f.wr_corpus_suitability === 'WR_CORPUS_CANDIDATE' || f.wr_corpus_suitability === 'WR_CORPUS_REVIEW_REQUIRED')
    .map(f => ({
      document_id: f.document_id,
      suitability: f.wr_corpus_suitability,
      recommendation_only: true as const,
    }))

  const quality_summary = [
    `docs=${findings.length}`,
    `high=${findings.filter(f => f.quality.includes('HIGH_QUALITY')).length}`,
    `dup_groups=${duplicate_groups_capped.length}`,
    `prov_gaps=${provenance_gaps.length}`,
    `stale=${stale_records.length}`,
    `writes=${writes_performed.length}`,
  ].join('; ')

  return {
    findings,
    duplicate_groups: duplicate_groups_capped,
    provenance_gaps: [...new Set(provenance_gaps)],
    license_gaps: [...new Set(license_gaps)],
    stale_records: [...new Set(stale_records)],
    conflicts: [...new Set(conflicts)],
    retrieval_suitability,
    wr_corpus_candidates,
    wr_corpus_exclusions: [...new Set(wr_corpus_exclusions)],
    review_required: [...new Set(review_required)],
    writes_performed: writes_performed.slice(0, input.scope.max_annotations),
    limitations,
    unavailable,
    documents_examined: findings.length,
    chunks_examined: Math.min(chunks, input.scope.max_chunks),
    quality_summary,
    frozen_chunk_version: CHUNKING_VERSION,
    frozen_embedding_model: LOCAL_EMBEDDING_MODEL_ID,
    roadmap_23_status: ROADMAP_23_STATUS,
  }
}
