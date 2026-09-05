import type { NebulaAgentId } from '@/lib/council/nebula/identity'

/**
 * ASCENSION — War Room agent-development system (Phase 1: data model / foundation only).
 *
 * IDENTITY survives backend/model changes. Growth is evidence-attributed, never a fake XP counter.
 * Autonomous self-modification, weight training, and production edits are structurally disabled.
 */

export type EvolutionEvidenceKind =
  | 'mission_outcome'
  | 'evaluation_result'
  | 'commander_feedback'
  | 'council_peer_review'
  | 'research_quality'
  | 'tool_success'
  | 'tool_failure'
  | 'source_quality'
  | 'task_completion_quality'

export type EvolutionEvidence = {
  evidenceId: string
  kind: EvolutionEvidenceKind
  summary: string
  sourceRef: string | null
  validated: boolean
  recordedAt: string
}

export type AgentSkillRecord = {
  skillId: string
  label: string
  /** Ordinal competency 0–5 derived from validated evidence, not an XP counter. */
  level: number
  evidenceIds: string[]
}

export type PromotionRecord = {
  promotionId: string
  fromStatus: string
  toStatus: string
  reason: string
  evidenceIds: string[]
  approvedByCommander: boolean
  recordedAt: string
}

export type AgentEvolutionProfile = {
  agentId: NebulaAgentId
  skills: AgentSkillRecord[]
  skillLevels: Readonly<Record<string, number>>
  missionHistory: string[]
  evaluationHistory: string[]
  strengths: string[]
  weaknesses: string[]
  learnedMethods: string[]
  toolProficiency: Readonly<Record<string, number>>
  learningGoals: string[]
  promotionHistory: PromotionRecord[]
  evidence: EvolutionEvidence[]
  lastUpdated: string
}

export type AscensionLoopStage =
  | 'mission'
  | 'performance'
  | 'evaluation'
  | 'experience'
  | 'validated_lesson'
  | 'skill_method_growth'
  | 'better_future_performance'

export const ASCENSION_LOOP: readonly AscensionLoopStage[] = [
  'mission',
  'performance',
  'evaluation',
  'experience',
  'validated_lesson',
  'skill_method_growth',
  'better_future_performance',
]

/**
 * Production behavior change path. Experience may accumulate automatically;
 * behavior changes only through this promotion pipeline.
 */
export const ASCENSION_PROMOTION_PIPELINE = [
  'mission',
  'execution',
  'evaluation',
  'experience',
  'lesson_candidate',
  'validation',
  'comparison',
  'shadow',
  'canary',
  'promote_or_reject',
] as const

export type AscensionPromotionStage = (typeof ASCENSION_PROMOTION_PIPELINE)[number]

export type LessonPromotionStatus =
  | 'candidate'
  | 'validating'
  | 'comparing'
  | 'shadow'
  | 'canary'
  | 'promoted'
  | 'rejected'
  | 'rolled_back'
  | 'superseded'
  | 'expired'

export const LESSON_TERMINAL_STATES: readonly LessonPromotionStatus[] = [
  'rejected',
  'rolled_back',
  'superseded',
  'expired',
]

export type LessonCandidateType =
  | 'method'
  | 'heuristic'
  | 'stopping_rule'
  | 'evidence_discipline'
  | 'output_contract_refinement'

export type LessonCandidate = {
  lessonId: string
  agentId: NebulaAgentId
  type: LessonCandidateType
  trigger: string
  proposedMethod: string
  sourceEpisodeIds: string[]
  expectedBenefit: string
  knownRisks: string[]
  evaluationIds: string[]
  promotionStatus: LessonPromotionStatus
}

export type ExperienceRecord = {
  experienceId: string
  agentId: NebulaAgentId
  kind:
    | 'mission_history'
    | 'execution_trace'
    | 'tool_result'
    | 'failure'
    | 'success'
    | 'commander_feedback'
    | 'peer_feedback'
    | 'weakness'
    | 'candidate_lesson'
    | 'candidate_method'
  summary: string
  sourceRef: string | null
  recordedAt: string
  changesProductionBehavior: false
}

export type PromotionGateId =
  | 'provenance'
  | 'target_improvement'
  | 'regression'
  | 'role_adherence'
  | 'cost'
  | 'latency'
  | 'safety'
  | 'human_review'

export type PromotionGateResult = {
  gate: PromotionGateId
  passed: boolean
  detail: string
}

export type CommanderApprovalRequiredChange =
  | 'permanent_identity'
  | 'authority'
  | 'role_boundary'
  | 'memory_access_scope'
  | 'tool_permissions'
  | 'core_temperament_ranges'

export type AscensionAutonomyGuard = {
  selfModificationEnabled: false
  weightTrainingEnabled: false
  productionEditEnabled: false
  unvalidatedPromotionEnabled: false
}

export const ASCENSION_AUTONOMY_GUARD: AscensionAutonomyGuard = Object.freeze({
  selfModificationEnabled: false,
  weightTrainingEnabled: false,
  productionEditEnabled: false,
  unvalidatedPromotionEnabled: false,
})

export type AscensionFoundation = {
  system: 'ASCENSION'
  profiles: Readonly<Record<NebulaAgentId, AgentEvolutionProfile>>
  loop: readonly AscensionLoopStage[]
  promotionPipeline: readonly AscensionPromotionStage[]
  experienceSeparatedFromPromotion: true
  autonomy: AscensionAutonomyGuard
  persistsAcrossBackendChange: true
}
