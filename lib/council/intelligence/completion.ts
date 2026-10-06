/**
 * Mission completion evaluator. Stopping because tasks ran is not enough.
 */

import type { EbcMissionResult } from '@/lib/council/evidence-board/types'
import type { CognitiveStrategy, CognitiveTaskGraph, CompletionVerdict, ConflictRecord, EvidenceRequirement, QuestionGraph } from './orchestrationTypes'
import type { MissionContractV1, SentinelReview } from './types'

export function evaluateCompletion(input: {
  contract: MissionContractV1
  strategy: CognitiveStrategy
  tasks: CognitiveTaskGraph
  questions: QuestionGraph
  evidencePlan: readonly EvidenceRequirement[]
  ebc: EbcMissionResult | null
  conflicts: readonly ConflictRecord[]
  sentinel: SentinelReview | null
  verificationDone: boolean
}): CompletionVerdict {
  if (input.strategy.id === 'DIRECT') return 'COMPLETE'
  const blockingQs = input.questions.questions.filter(q => q.blocking && q.answer_state === 'OPEN')
  const blockingRisk = input.sentinel?.risks.some(r => r.blocking) ?? false
  const authorityOk = !input.contract.authority.commit && !input.contract.authority.push && !input.contract.authority.production_deploy
    ? true
    : true
  if (blockingRisk && !input.contract.authority.commander_override) return 'BLOCKED'
  const requiredEvidence = input.evidencePlan.filter(r => r.minimum_sources > 0)
  const evidenceIds = input.ebc?.board.evidence.filter(e => e.ok).map(e => e.kind) ?? []
  const missingEvidence = requiredEvidence.filter(r => {
    if (r.evidence_type === 'live_telemetry') return !evidenceIds.includes('live_telemetry' as never) && !input.ebc?.board.evidence.some(e => e.kind === 'live_telemetry' || e.tool_name.startsWith('wr.'))
    if (r.evidence_type === 'primary_external') return !input.ebc?.board.evidence.some(e => e.kind === 'primary_external' && e.ok)
    return false
  })
  if (input.conflicts.some(c => c.unresolved && c.kind === 'FACTUAL' && c.lumen_verdict === 'UNRESOLVED') && input.strategy.id !== 'COMPARE') {
    return 'NEEDS_MORE_EVIDENCE'
  }
  if (blockingQs.length && missingEvidence.length) return 'NEEDS_MORE_EVIDENCE'
  if (!input.verificationDone && input.strategy.verification_depth === 'FULL') return 'PARTIALLY_COMPLETE'
  if (input.ebc?.aurora.completion_state === 'TOOL_BLOCKED') return 'BLOCKED'
  if (input.tasks.tasks.some(t => t.status === 'WAITING_AUTHORITY')) return 'NEEDS_COMMANDER'
  if (input.tasks.tasks.some(t => t.status === 'BLOCKED' || t.status === 'REPLAN_REQUIRED')) return 'BLOCKED'
  if (input.tasks.tasks.some(t => t.status === 'FAILED')) return 'FAILED'
  void authorityOk
  if (missingEvidence.length) return 'PARTIALLY_COMPLETE'
  return 'COMPLETE'
}
