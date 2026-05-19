import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export type ProviderSpecializationRole =
  | 'research'
  | 'revenue'
  | 'architecture'
  | 'signals'
  | 'synthesis'
  | 'decomposition'
  | 'risk'
  | 'red_team'
  | 'observer'
  | 'bridge'

export type FamilySpecialization = {
  family: CouncilOrchestrationFamily
  role: ProviderSpecializationRole
  label: string
  taskAffinity: string[]
}

export const FAMILY_SPECIALIZATIONS: FamilySpecialization[] = [
  { family: 'chatgpt', role: 'revenue', label: 'Strategy & revenue', taskAffinity: ['revenue', 'plan', 'synthesis', 'business'] },
  { family: 'claude', role: 'architecture', label: 'Architecture & precision', taskAffinity: ['architecture', 'truth', 'engineering', 'risk'] },
  { family: 'grok', role: 'signals', label: 'Signals & framing', taskAffinity: ['signal', 'contradiction', 'intel', 'market'] },
  { family: 'gemini', role: 'synthesis', label: 'Synthesis & long context', taskAffinity: ['synthesis', 'research', 'compare', 'summary'] },
  { family: 'kimi', role: 'decomposition', label: 'Task decomposition', taskAffinity: ['decompose', 'sequence', 'tasks', 'workflow'] },
  { family: 'red_team', role: 'red_team', label: 'Adversarial review', taskAffinity: ['challenge', 'red_team', 'contradiction', 'risk'] },
  { family: 'bridge_architect', role: 'bridge', label: 'Systems bridge', taskAffinity: ['bridge', 'integration', 'systems'] },
  { family: 'baby', role: 'observer', label: 'Observer', taskAffinity: ['observe', 'learn'] },
]

const byFamily = new Map(FAMILY_SPECIALIZATIONS.map(s => [s.family, s]))

export function specializationForFamily(family: CouncilOrchestrationFamily): FamilySpecialization {
  return byFamily.get(family) ?? { family, role: 'research', label: family, taskAffinity: ['general'] }
}
