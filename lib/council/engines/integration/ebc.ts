import { runResearchDiscoveryEngine } from '../research-discovery/engine'
import { assessSourceAuthority } from '../source-authority/engine'
import { bindClaimEvidence } from '../evidence-binding/engine'
import { calibrateUncertainty } from '../calibration/engine'
import { pulsarConsumeAssessments } from './pulsar'
import { orionConsumeEnginePacket } from './orion'
import { phoenixTargetsFromEngines } from './phoenix'
import { auroraConsumeEngines } from './aurora'
import { ENGINE_01_VERSION } from '../types'
import type { MissionEvidenceBoard, LumenVerification, AuroraSynthesisV1, EbcMissionClass } from '@/lib/council/evidence-board/types'
import type { EngineReceipt } from '../types'
import type { ResearchDiscoveryPlan } from '../research-discovery/types'
import type { SourceAssessment } from '../source-authority/types'
import type { ClaimEvidenceBinding, ClaimEvidenceGraph, EvidenceConflict } from '../evidence-binding/types'
import type { CalibrationResult } from '../calibration/types'

export type CouncilEnginePublic = {
  schema: typeof ENGINE_01_VERSION
  ebc_canonical: true
  discovery_plan?: ResearchDiscoveryPlan
  source_assessments: Array<Pick<SourceAssessment, 'candidate_id' | 'url' | 'decision' | 'source_class' | 'freshness_state' | 'independence_state' | 'relevance_score'>>
  claim_evidence_links: Array<Pick<ClaimEvidenceBinding, 'claim_id' | 'evidence_refs' | 'source_refs' | 'support_type' | 'verification_state'>>
  conflicts: Array<Pick<EvidenceConflict, 'conflict_id' | 'claim_ids' | 'conflict_type' | 'resolution_state' | 'reason'>>
  calibration: { state: CalibrationResult['state']; commander_facing: string; reasons: string[] }
  graph?: Pick<ClaimEvidenceGraph, 'ebc_canonical' | 'support_edges' | 'contradiction_edges'>
  aurora_facing?: string[]
  orion_missing_evidence?: string[]
  phoenix_targets?: Array<{ claim_id: string; challenge_type: string }>
  receipts: EngineReceipt[]
}

export function attachCouncilEnginePublic(input: {
  board: MissionEvidenceBoard
  lumen: readonly LumenVerification[]
  aurora: AuroraSynthesisV1
  mission_class?: EbcMissionClass
}): CouncilEnginePublic {
  const question = input.board.mission.question
  const mission_id = input.board.mission.mission_id
  const mission_class = input.mission_class ?? input.board.mission.mission_class
  const discovery = runResearchDiscoveryEngine({ mission_id, question })
  const urls = input.board.evidence
    .map(row => ({ url: String(row.final_url || row.url || ''), title: row.title || undefined, text: row.summary, extraction_ok: row.ok, retrieved_at: row.retrieved_at }))
    .filter(row => /^https?:\/\//i.test(row.url))
  const pulsar = pulsarConsumeAssessments(
    { plan: discovery.plan, candidates: discovery.candidates, assessments: [], accepted: [] },
    urls.map(row => ({
      url: row.url,
      title: row.title,
      text: row.text,
      extraction_ok: row.extraction_ok,
      retrieved_at: row.retrieved_at,
    })),
    question,
    mission_id,
  )
  const binding = bindClaimEvidence({
    mission_id,
    mission_class,
    claims: input.board.claims,
    evidence: input.board.evidence,
    conflicts: input.board.conflicts,
    lumen_verdicts: input.lumen,
  })
  const calibration = calibrateUncertainty({
    mission_id,
    prompt: question,
    assessments: pulsar.assessments,
    bindings: binding.bindings,
    conflicts: binding.conflicts,
    tool_failures: input.board.evidence.filter(row => row.ok === false).length,
  })
  const orion = orionConsumeEnginePacket({
    question,
    plan: discovery.plan,
    assessments: pulsar.assessments,
    graph: binding.graph,
    conflicts: binding.conflicts,
  })
  const phoenix = phoenixTargetsFromEngines({
    bindings: binding.bindings,
    assessments: pulsar.assessments,
    conflicts: binding.conflicts,
    calibration,
  })
  const aurora = auroraConsumeEngines({
    aurora: input.aurora,
    calibration,
    bindings: binding.bindings,
  })
  return {
    schema: ENGINE_01_VERSION,
    ebc_canonical: true,
    discovery_plan: discovery.plan,
    source_assessments: pulsar.assessments.map(row => ({
      candidate_id: row.candidate_id,
      url: row.url,
      decision: row.decision,
      source_class: row.source_class,
      freshness_state: row.freshness_state,
      independence_state: row.independence_state,
      relevance_score: row.relevance_score,
    })),
    claim_evidence_links: binding.bindings.map(row => ({
      claim_id: row.claim_id,
      evidence_refs: row.evidence_refs,
      source_refs: row.source_refs,
      support_type: row.support_type,
      verification_state: row.verification_state,
    })),
    conflicts: binding.conflicts.map(row => ({
      conflict_id: row.conflict_id,
      claim_ids: row.claim_ids,
      conflict_type: row.conflict_type,
      resolution_state: row.resolution_state,
      reason: row.reason,
    })),
    calibration: {
      state: calibration.state,
      commander_facing: calibration.commander_facing,
      reasons: calibration.reasons,
    },
    graph: {
      ebc_canonical: true,
      support_edges: binding.graph.support_edges,
      contradiction_edges: binding.graph.contradiction_edges,
    },
    aurora_facing: aurora.commander_facing,
    orion_missing_evidence: orion.missing_evidence,
    phoenix_targets: phoenix.map(row => ({ claim_id: row.claim_id, challenge_type: row.challenge_type })),
    receipts: [discovery.receipt, binding.receipt, calibration.receipt],
  }
}
