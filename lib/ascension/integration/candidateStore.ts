/**
 * #22 Phase 14 — Durable corpus-candidate handoff store (local SQLite).
 * Candidate-handoff durability only. NOT production corpus. NOT WR-CORPUS. NOT training.
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import {
  ensureLocalAppDataDirs,
  resolveLocalAppDataPaths,
  tightenFileMode,
} from '@/lib/sovereign-runtime/local-ownership/paths'
import { detectCredentialMaterial } from '@/lib/ascension/world-learning-agent/learn'
import {
  CORPUS_CANDIDATE_REVIEW_STATES,
  FORBIDDEN_CANDIDATE_STATES,
  type CorpusCandidateReviewState,
} from './types'
import { integrationFailure, type IntegrationFailure } from './failures'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS corpus_candidate_handoffs (
  candidate_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  scope_class TEXT NOT NULL,
  source_agent TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  normalized_content TEXT NOT NULL,
  content_reference TEXT,
  confidence REAL NOT NULL,
  freshness TEXT NOT NULL,
  novelty_classification TEXT NOT NULL,
  conflict_state TEXT NOT NULL,
  recommended_disposition TEXT NOT NULL,
  review_state TEXT NOT NULL,
  mission_id TEXT,
  handoff_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS corpus_candidate_owner_idx
  ON corpus_candidate_handoffs (owner_user_id, updated_at DESC);
`

export type DurableCorpusCandidate = {
  candidate_id: string
  owner_user_id: string
  scope_class: 'LOCAL' | 'REMOTE' | 'HYBRID'
  source_agent: string
  evidence_ids: string[]
  provenance: Record<string, unknown>
  normalized_content: string
  content_reference: string | null
  confidence: number
  freshness: string
  novelty_classification: string
  conflict_state: string
  recommended_disposition: string
  review_state: CorpusCandidateReviewState
  mission_id: string | null
  handoff_id: string | null
  created_at: string
  updated_at: string
  expires_at: string | null
}

function nowIso(): string {
  return new Date().toISOString()
}

function isReviewState(value: string): value is CorpusCandidateReviewState {
  return (CORPUS_CANDIDATE_REVIEW_STATES as readonly string[]).includes(value)
}

export class CorpusCandidateStore {
  readonly dbPath: string
  private readonly db: DatabaseSync
  private closed = false

  constructor(dataDirOverride?: string | null) {
    const paths = resolveLocalAppDataPaths(dataDirOverride)
    ensureLocalAppDataDirs(paths)
    this.dbPath = path.join(paths.data, 'corpus-candidate-handoffs.sqlite')
    this.db = new DatabaseSync(this.dbPath)
    this.db.exec(SCHEMA)
    tightenFileMode(this.dbPath)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  upsert(candidate: Omit<DurableCorpusCandidate, 'created_at' | 'updated_at'> & {
    created_at?: string
    updated_at?: string
  }): { ok: true; candidate: DurableCorpusCandidate } | { ok: false; failure: IntegrationFailure } {
    if (!candidate.owner_user_id?.trim()) {
      return { ok: false, failure: integrationFailure('OWNER_REQUIRED', 'Candidate owner is required.') }
    }
    if (!isReviewState(candidate.review_state)) {
      return { ok: false, failure: integrationFailure('FORBIDDEN_ACTION', 'Unknown candidate review state.') }
    }
    if ((FORBIDDEN_CANDIDATE_STATES as readonly string[]).includes(candidate.review_state)) {
      return { ok: false, failure: integrationFailure('FORBIDDEN_ACTION', 'TRAINED / WR-CORPUS candidate states are denied.') }
    }
    const blob = `${candidate.normalized_content}\n${JSON.stringify(candidate.provenance)}`
    if (detectCredentialMaterial(blob)) {
      return { ok: false, failure: integrationFailure('FORBIDDEN_ACTION', 'Credentials and secret material cannot be persisted.') }
    }
    if (/chain[_-]?of[_-]?thought|hidden[_-]?cot/i.test(blob)) {
      return { ok: false, failure: integrationFailure('FORBIDDEN_ACTION', 'Hidden chain-of-thought cannot be persisted.') }
    }

    const existing = this.get(candidate.candidate_id, candidate.owner_user_id)
    const created = existing?.created_at ?? candidate.created_at ?? nowIso()
    const updated = candidate.updated_at ?? nowIso()
    const row: DurableCorpusCandidate = {
      ...candidate,
      created_at: created,
      updated_at: updated,
    }
    this.db
      .prepare(
        `INSERT INTO corpus_candidate_handoffs (
          candidate_id, owner_user_id, scope_class, source_agent, evidence_ids_json, provenance_json,
          normalized_content, content_reference, confidence, freshness, novelty_classification,
          conflict_state, recommended_disposition, review_state, mission_id, handoff_id,
          created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(candidate_id) DO UPDATE SET
          owner_user_id=excluded.owner_user_id,
          scope_class=excluded.scope_class,
          source_agent=excluded.source_agent,
          evidence_ids_json=excluded.evidence_ids_json,
          provenance_json=excluded.provenance_json,
          normalized_content=excluded.normalized_content,
          content_reference=excluded.content_reference,
          confidence=excluded.confidence,
          freshness=excluded.freshness,
          novelty_classification=excluded.novelty_classification,
          conflict_state=excluded.conflict_state,
          recommended_disposition=excluded.recommended_disposition,
          review_state=excluded.review_state,
          mission_id=excluded.mission_id,
          handoff_id=excluded.handoff_id,
          updated_at=excluded.updated_at,
          expires_at=excluded.expires_at
        `,
      )
      .run(
        row.candidate_id,
        row.owner_user_id,
        row.scope_class,
        row.source_agent,
        JSON.stringify(row.evidence_ids),
        JSON.stringify(row.provenance),
        row.normalized_content,
        row.content_reference,
        row.confidence,
        row.freshness,
        row.novelty_classification,
        row.conflict_state,
        row.recommended_disposition,
        row.review_state,
        row.mission_id,
        row.handoff_id,
        row.created_at,
        row.updated_at,
        row.expires_at,
      )
    return { ok: true, candidate: row }
  }

  get(candidateId: string, ownerUserId: string): DurableCorpusCandidate | null {
    const row = this.db
      .prepare('SELECT * FROM corpus_candidate_handoffs WHERE candidate_id = ? AND owner_user_id = ?')
      .get(candidateId, ownerUserId) as Record<string, unknown> | undefined
    if (!row) return null
    return hydrate(row)
  }

  listByOwner(ownerUserId: string, limit = 40): DurableCorpusCandidate[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM corpus_candidate_handoffs WHERE owner_user_id = ? ORDER BY updated_at DESC LIMIT ?',
      )
      .all(ownerUserId, limit) as Record<string, unknown>[]
    return rows.map(hydrate)
  }

  setReviewState(input: {
    candidateId: string
    ownerUserId: string
    reviewState: string
  }): { ok: true; candidate: DurableCorpusCandidate } | { ok: false; failure: IntegrationFailure } {
    if ((FORBIDDEN_CANDIDATE_STATES as readonly string[]).includes(input.reviewState)) {
      return { ok: false, failure: integrationFailure('FORBIDDEN_ACTION', 'Cannot mark a candidate TRAINED or WR-CORPUS.') }
    }
    if (!isReviewState(input.reviewState)) {
      return { ok: false, failure: integrationFailure('FORBIDDEN_ACTION', 'Unknown candidate review state.') }
    }
    const existing = this.get(input.candidateId, input.ownerUserId)
    if (!existing) {
      return { ok: false, failure: integrationFailure('OWNER_MISMATCH', 'Candidate not found for this owner.') }
    }
    return this.upsert({ ...existing, review_state: input.reviewState })
  }
}

function hydrate(row: Record<string, unknown>): DurableCorpusCandidate {
  return {
    candidate_id: String(row.candidate_id),
    owner_user_id: String(row.owner_user_id),
    scope_class: (row.scope_class as DurableCorpusCandidate['scope_class']) ?? 'LOCAL',
    source_agent: String(row.source_agent),
    evidence_ids: JSON.parse(String(row.evidence_ids_json || '[]')) as string[],
    provenance: JSON.parse(String(row.provenance_json || '{}')) as Record<string, unknown>,
    normalized_content: String(row.normalized_content),
    content_reference: row.content_reference == null ? null : String(row.content_reference),
    confidence: Number(row.confidence),
    freshness: String(row.freshness),
    novelty_classification: String(row.novelty_classification),
    conflict_state: String(row.conflict_state),
    recommended_disposition: String(row.recommended_disposition),
    review_state: row.review_state as CorpusCandidateReviewState,
    mission_id: row.mission_id == null ? null : String(row.mission_id),
    handoff_id: row.handoff_id == null ? null : String(row.handoff_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    expires_at: row.expires_at == null ? null : String(row.expires_at),
  }
}

export function dispositionToReviewState(disposition: string): CorpusCandidateReviewState {
  if (disposition === 'RECOMMEND_REJECT') return 'REJECTED'
  if (disposition === 'REQUIRES_REVIEW' || disposition === 'INSUFFICIENT_EVIDENCE') return 'REQUIRES_REVIEW'
  if (disposition === 'RECOMMEND_UPDATE') return 'CURATED'
  return 'PROPOSED'
}
