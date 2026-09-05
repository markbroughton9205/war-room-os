import { NEBULA_AGENT_IDS, type NebulaAgentId } from '@/lib/council/nebula/identity'
import {
  ASCENSION_AUTONOMY_GUARD,
  ASCENSION_LOOP,
  ASCENSION_PROMOTION_PIPELINE,
  type AgentEvolutionProfile,
  type AgentSkillRecord,
  type AscensionFoundation,
  type EvolutionEvidence,
} from './types'

const GENESIS = '2026-09-05T00:00:00.000Z'

const SEED_SKILLS: Readonly<Record<NebulaAgentId, AgentSkillRecord[]>> = {
  aurora: [
    { skillId: 'final_synthesis', label: 'Final synthesis', level: 1, evidenceIds: [] },
    { skillId: 'cross_agent_reconciliation', label: 'Cross-agent reconciliation', level: 1, evidenceIds: [] },
    { skillId: 'calibrated_integration', label: 'Calibrated integration', level: 1, evidenceIds: [] },
  ],
  nova: [
    { skillId: 'task_decomposition', label: 'Task decomposition', level: 1, evidenceIds: [] },
    { skillId: 'execution_sequencing', label: 'Execution sequencing', level: 1, evidenceIds: [] },
  ],
  pulsar: [
    { skillId: 'signal_detection', label: 'Signal detection', level: 1, evidenceIds: [] },
    { skillId: 'evidence_research', label: 'Evidence research', level: 1, evidenceIds: [] },
  ],
  phoenix: [
    { skillId: 'adversarial_review', label: 'Adversarial review', level: 1, evidenceIds: [] },
    { skillId: 'failure_mode_analysis', label: 'Failure-mode analysis', level: 1, evidenceIds: [] },
  ],
  orion: [
    { skillId: 'systems_architecture', label: 'Systems architecture', level: 1, evidenceIds: [] },
    { skillId: 'software_engineering', label: 'Software engineering', level: 1, evidenceIds: [] },
  ],
  lumen: [
    { skillId: 'claim_verification', label: 'Claim verification', level: 1, evidenceIds: [] },
    { skillId: 'provenance_tracking', label: 'Provenance tracking', level: 1, evidenceIds: [] },
  ],
  solara: [
    { skillId: 'human_impact_assessment', label: 'Human impact assessment', level: 1, evidenceIds: [] },
  ],
  astra: [
    { skillId: 'constellation_planning', label: 'Constellation planning', level: 1, evidenceIds: [] },
    { skillId: 'mission_decomposition', label: 'Mission decomposition', level: 1, evidenceIds: [] },
  ],
}

function emptyProfile(agentId: NebulaAgentId): AgentEvolutionProfile {
  const skills = SEED_SKILLS[agentId]
  return {
    agentId,
    skills,
    skillLevels: Object.freeze(Object.fromEntries(skills.map(skill => [skill.skillId, skill.level]))),
    missionHistory: [],
    evaluationHistory: [],
    strengths: [],
    weaknesses: [],
    learnedMethods: [],
    toolProficiency: Object.freeze({}),
    learningGoals: [],
    promotionHistory: [],
    evidence: [],
    lastUpdated: GENESIS,
  }
}

export const NEBULA_EVOLUTION_PROFILES: Readonly<Record<NebulaAgentId, AgentEvolutionProfile>> = Object.freeze(
  Object.fromEntries(NEBULA_AGENT_IDS.map(id => [id, emptyProfile(id)])) as Record<NebulaAgentId, AgentEvolutionProfile>,
)

export const ASCENSION_FOUNDATION: AscensionFoundation = Object.freeze({
  system: 'ASCENSION',
  profiles: NEBULA_EVOLUTION_PROFILES,
  loop: ASCENSION_LOOP,
  promotionPipeline: ASCENSION_PROMOTION_PIPELINE,
  experienceSeparatedFromPromotion: true,
  autonomy: ASCENSION_AUTONOMY_GUARD,
  persistsAcrossBackendChange: true,
})

/** Skill growth requires at least one validated evidence record. Never a fake XP increment. */
export function canApplySkillGrowth(evidence: EvolutionEvidence[]): boolean {
  return evidence.some(item => item.validated && Boolean(item.summary.trim()) && Boolean(item.kind))
}

export function proposeSkillGrowth(params: {
  profile: AgentEvolutionProfile
  skillId: string
  evidence: EvolutionEvidence[]
}): { applied: false; reason: string } | { applied: true; nextLevel: number } {
  if (ASCENSION_AUTONOMY_GUARD.selfModificationEnabled) {
    return { applied: false, reason: 'autonomy_guard_blocked_unexpected_self_modification' }
  }
  if (!canApplySkillGrowth(params.evidence)) {
    return { applied: false, reason: 'skill_growth_requires_validated_evidence' }
  }
  const current = params.profile.skillLevels[params.skillId] ?? 0
  return { applied: true, nextLevel: Math.min(5, current + 1) }
}
