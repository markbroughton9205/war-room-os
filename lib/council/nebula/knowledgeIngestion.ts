/**
 * Future knowledge absorption for ASTRA + Nebula agents.
 *
 * Phase 1: interfaces and documented flow only. Do NOT mass-ingest research markdown,
 * Kimi Waves, Terra findings, or Council findings in this phase.
 *
 * Desired later flow:
 *   research → structured knowledge → retrieval → agent use → evaluated experience
 *   → ASCENSION → future training candidates
 *
 * Provenance of every absorbed item must be preserved (source path, wave id, agent, timestamp).
 */

export type KnowledgeSourceKind =
  | 'war_room_research_md'
  | 'kimi_wave'
  | 'terra_finding'
  | 'council_finding'
  | 'validated_agent_experience'

export type KnowledgeSourceRef = {
  kind: KnowledgeSourceKind
  /** Repo-relative path, wave identifier, or finding id — never a secret. */
  locator: string
  title: string
  recordedAt: string | null
}

export type StructuredKnowledgeRecord = {
  knowledgeId: string
  source: KnowledgeSourceRef
  summary: string
  claims: string[]
  retrievalKeys: string[]
  provenancePreserved: true
  ingested: false
}

export type KnowledgeAbsorptionPlan = {
  enabled: false
  massIngest: false
  flow: readonly [
    'research',
    'structured_knowledge',
    'retrieval',
    'agent_use',
    'evaluated_experience',
    'ASCENSION',
    'future_training_candidates',
  ]
  knownSourceKinds: readonly KnowledgeSourceKind[]
  notes: readonly string[]
}

export const NEBULA_KNOWLEDGE_ABSORPTION_PLAN: KnowledgeAbsorptionPlan = Object.freeze({
  enabled: false,
  massIngest: false,
  flow: [
    'research',
    'structured_knowledge',
    'retrieval',
    'agent_use',
    'evaluated_experience',
    'ASCENSION',
    'future_training_candidates',
  ] as const,
  knownSourceKinds: [
    'war_room_research_md',
    'kimi_wave',
    'terra_finding',
    'council_finding',
    'validated_agent_experience',
  ] as const,
  notes: [
    'Inspect docs/research, Kimi Waves artifacts, Terra findings, and Council findings later.',
    'Do not ingest in Phase 1 or Phase 1B.',
    'Every future record must keep source provenance.',
    'Validated experiences feed ASCENSION; they do not auto-retrain model weights.',
    'An agent conclusion must not automatically become global War Room truth — see GLOBAL_KNOWLEDGE_PROMOTION_FLOW.',
  ],
})

/**
 * Global knowledge promotion gate.
 * Agent output is never global truth by itself. Mass ingest remains off.
 */
export const GLOBAL_KNOWLEDGE_PROMOTION_FLOW = [
  'agent_output',
  'mission_finding',
  'claim_extraction',
  'provenance',
  'verification',
  'optional_promotion',
  'global_war_room_knowledge',
] as const

export type GlobalKnowledgePromotionStage = (typeof GLOBAL_KNOWLEDGE_PROMOTION_FLOW)[number]

export type KnowledgePromotionCandidate = {
  candidateId: string
  stage: GlobalKnowledgePromotionStage
  agentOutputId: string
  missionFindingId: string | null
  claimIds: string[]
  provenanceComplete: boolean
  verified: boolean
  commanderApproved: boolean
  promotedToGlobal: boolean
}

export type KnowledgePromotionDecision = {
  allowed: boolean
  nextStage: GlobalKnowledgePromotionStage
  reason: string
}

export function evaluateGlobalKnowledgePromotion(candidate: KnowledgePromotionCandidate): KnowledgePromotionDecision {
  if (candidate.promotedToGlobal) {
    return { allowed: true, nextStage: 'global_war_room_knowledge', reason: 'already_promoted' }
  }
  if (!candidate.agentOutputId) {
    return { allowed: false, nextStage: 'agent_output', reason: 'missing_agent_output' }
  }
  if (!candidate.missionFindingId) {
    return { allowed: false, nextStage: 'mission_finding', reason: 'agent_output_is_not_automatically_a_mission_finding' }
  }
  if (candidate.claimIds.length === 0) {
    return { allowed: false, nextStage: 'claim_extraction', reason: 'claims_not_extracted' }
  }
  if (!candidate.provenanceComplete) {
    return { allowed: false, nextStage: 'provenance', reason: 'provenance_incomplete' }
  }
  if (!candidate.verified) {
    return { allowed: false, nextStage: 'verification', reason: 'verification_required' }
  }
  if (!candidate.commanderApproved) {
    return { allowed: false, nextStage: 'optional_promotion', reason: 'commander_approval_required_for_global_promotion' }
  }
  return { allowed: true, nextStage: 'global_war_room_knowledge', reason: 'promotion_gate_passed' }
}

export function agentConclusionIsAutomaticGlobalTruth(): false {
  return false
}
