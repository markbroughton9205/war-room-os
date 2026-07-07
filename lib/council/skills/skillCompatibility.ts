import type { CouncilSkillId, CouncilSpecialtyAlias } from './types'

const normalizeSpecialty = (specialty: string) => specialty.trim().toLowerCase()

export const COUNCIL_SPECIALTY_TO_SKILL: Record<CouncilSpecialtyAlias, CouncilSkillId> = {
  architecture: 'system_architecture',
  'engineering review': 'engineering_review',
  'systems reasoning': 'system_architecture',
  'long reasoning': 'long_reasoning_decomposition',
  feasibility: 'feasibility_analysis',
  strategy: 'business_strategy',
  planning: 'planning',
  synthesis: 'synthesis',
  writing: 'writing',
  communication: 'synthesis',
  knowledge: 'knowledge_organization',
  research: 'research_review',
  'pattern recognition': 'pattern_recognition',
  'cross reference': 'cross_reference',
  'large context': 'knowledge_organization',
  'current events': 'current_signal_detection',
  'internet awareness': 'internet_awareness',
  signals: 'current_signal_detection',
  'market intelligence': 'market_intelligence',
  'realtime radar': 'realtime_context_framing',
  'implementation planning': 'implementation_planning',
  'task sequencing': 'task_sequencing',
  'technical execution': 'technical_execution_planning',
  decomposition: 'long_reasoning_decomposition',
  operations: 'operations_mapping',
  'challenge assumptions': 'assumption_challenge',
  'find flaws': 'risk_analysis',
  'risk analysis': 'risk_analysis',
  'contradiction checking': 'contradiction_checking',
  'stress test': 'stress_testing',
}

export function specialtyToSkillId(specialty: string): CouncilSkillId | null {
  const normalized = normalizeSpecialty(specialty)
  return COUNCIL_SPECIALTY_TO_SKILL[normalized as CouncilSpecialtyAlias] ?? null
}

export function specialtiesToSkillIds(specialties: string[]): CouncilSkillId[] {
  return Array.from(
    new Set(
      specialties
        .map(specialtyToSkillId)
        .filter((skillId): skillId is CouncilSkillId => skillId !== null),
    ),
  )
}

export function specialtySupportsSkill(specialty: string, skillId: CouncilSkillId): boolean {
  return specialtyToSkillId(specialty) === skillId
}
