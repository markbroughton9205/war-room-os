import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import type { ContradictionRecord } from './types'

export type ResearchComparisonLike = {
  subject: string
  agreement: 'corroborated' | 'conflicting' | 'single_source' | 'insufficient_evidence'
  note: string
}

/**
 * Reuses Research Engine's own already-computed agreement signal (ResearchComparison.agreement)
 * rather than building a new contradiction classifier (Phase 16 explicitly permits rule-based/
 * provider-assisted comparison "if clearly labeled" — this is rule-based, labeled `detector:
 * 'research_engine_agreement_signal'`). Only creates a record when the signal is 'conflicting';
 * 'corroborated'/'single_source'/'insufficient_evidence' never produce a contradiction row.
 */
export async function detectContradictionFromComparison(
  comparison: ResearchComparisonLike,
  claimAId: string,
  claimBId: string,
): Promise<ContradictionRecord | null> {
  if (comparison.agreement !== 'conflicting') return null
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null

  const { data, error } = await sup.client
    .from('war_room_contradiction_records')
    .insert({
      claim_a_id: claimAId,
      claim_b_id: claimBId,
      relationship: 'contradicts',
      evidence: [{ subject: comparison.subject, note: comparison.note }],
      confidence: 0.5,
      detector: 'research_engine_agreement_signal',
      verification_status: 'unverified',
    })
    .select('*')
    .single()

  if (error || !data) return null
  return data as ContradictionRecord
}
