/**
 * Explicit Commander-governed promotion from durable candidates into active WR-CORPUS.
 * Never auto-promotes. Never sets candidate state to TRAINED / WR-CORPUS / PRODUCTION.
 */
import { createHash } from 'node:crypto'
import { CorpusCandidateStore } from '@/lib/ascension/integration/candidateStore'
import { WrCorpusPolicyError, sha256Buffer } from './hashes'
import { rightsForLiveCandidate } from './rights'
import { WrCorpusStore, embedText } from './store'
import { SYSTEM_HISTORICAL_OWNER } from './identity'

export type PromoteCandidateInput = {
  candidateId: string
  ownerUserId: string
  commanderApproval: true
  dataDirOverride?: string | null
  nowIso?: string
}

export async function promoteApprovedCandidate(input: PromoteCandidateInput): Promise<{
  record_id: string
  corpus_version: 'WR-CORPUS-ACTIVE'
  already: boolean
}> {
  if (input.commanderApproval !== true) {
    throw new WrCorpusPolicyError('APPROVAL_REQUIRED', 'Explicit Commander approval is required. Auto-promotion denied.')
  }
  const candidates = new CorpusCandidateStore(input.dataDirOverride)
  const store = new WrCorpusStore(input.dataDirOverride)
  try {
    const candidate = candidates.get(input.candidateId, input.ownerUserId)
    if (!candidate) throw new WrCorpusPolicyError('NOT_FOUND', 'Candidate not found for this owner.')
    if (candidate.review_state !== 'APPROVED_FOR_FUTURE_CORPUS') {
      throw new WrCorpusPolicyError(
        'NOT_APPROVED',
        `Candidate review_state is ${candidate.review_state}. Promote only after APPROVED_FOR_FUTURE_CORPUS.`,
      )
    }

    const contentHash = sha256Buffer(candidate.normalized_content)
    const blocked = store.findTombstoneByHash(contentHash)
    if (blocked?.policy === 'DELETE_AND_BLOCK_RELEARN') {
      throw new WrCorpusPolicyError('TOMBSTONE_BLOCK', 'Deleted content is blocked from relearn.')
    }

    const existingPromo = store.findPromotion(input.candidateId)
    const existingRecord = existingPromo ? store.getRecord(existingPromo.record_id) : null
    if (existingPromo && existingRecord?.active) {
      return { record_id: existingPromo.record_id, corpus_version: 'WR-CORPUS-ACTIVE', already: true }
    }

    const rights = rightsForLiveCandidate({
      license: typeof candidate.provenance.license === 'string' ? candidate.provenance.license : null,
      provenance: candidate.provenance,
    })
    const now = input.nowIso ?? new Date().toISOString()
    const recordId = `wra:${createHash('sha256').update(`${input.candidateId}:${contentHash}`).digest('hex').slice(0, 24)}`
    store.insertRecord(
      {
        record_id: recordId,
        corpus_version: 'WR-CORPUS-ACTIVE',
        owner_user_id: input.ownerUserId,
        title: String(candidate.provenance.world_learning_claim ?? candidate.candidate_id),
        text: candidate.normalized_content,
        source_type: 'durable_candidate',
        split: 'active',
        content_hash: contentHash,
        rights,
        training_eligibility: rights.training_eligibility,
        review_state: 'PROMOTED_EXPLICIT',
        provenance: {
          ...candidate.provenance,
          candidate_id: candidate.candidate_id,
          promoted_at: now,
          pipeline: 'research→world_learning→data_corpus→durable_candidate→commander_approval→wr_corpus',
          owner_user_id: input.ownerUserId,
        },
        historical_path: null,
        canonical_path: store.paths.root,
        created_at: now,
        active: true,
        tombstone_policy: null,
        source_candidate_id: candidate.candidate_id,
      },
      embedText(candidate.normalized_content),
    )
    store.addPromotion(candidate.candidate_id, recordId, input.ownerUserId)

    const existing = store.getVersion('WR-CORPUS-ACTIVE')
    store.upsertVersion({
      canonical_id: 'WR-CORPUS-ACTIVE',
      historical_id: 'WR-CORPUS-ACTIVE',
      historical_version: null,
      physical_layout: 'active_records',
      artifact_relpath: 'sqlite:corpus_records',
      content_hash: existing ? sha256Buffer(`${existing.content_hash}:${contentHash}`) : contentHash,
      record_count: store.countRecords('WR-CORPUS-ACTIVE'),
      created_at: existing?.created_at ?? now,
      migrated_at: now,
      classification: {
        canonical_name: 'WR-CORPUS-ACTIVE',
        real_data: true,
        live_growth: true,
        not_automatically_training_eligible: true,
      },
      rights_summary: { review_gated: true },
      training_eligibility: 'REQUIRES_REVIEW',
      historical_model_lineage: {},
      immutable: false,
      provenance: { owner_scoped: true },
      source_types: ['durable_candidate'],
      quality_status: 'explicit_commander_promotion',
      active: true,
      bytes: existing?.bytes ?? 0,
    })
    return { record_id: recordId, corpus_version: 'WR-CORPUS-ACTIVE', already: false }
  } finally {
    store.close()
    candidates.close()
  }
}

export function denyAutoPromoteAll(count: number): never {
  void count
  throw new WrCorpusPolicyError('AUTO_PROMOTE_DENIED', 'Cannot promote every durable candidate.')
}

export function assertNotSystemOwner(ownerUserId: string): void {
  if (ownerUserId === SYSTEM_HISTORICAL_OWNER) {
    throw new WrCorpusPolicyError('OWNER_REQUIRED', 'Live promotions must be owner-scoped.')
  }
}
