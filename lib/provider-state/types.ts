import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export type ProviderFamilyConversationState = {
  family: CouncilOrchestrationFamily
  recentContext: string
  topicFocus: string
  unresolvedQuestions: string[]
  contradictions: string[]
  pendingInvestigations: string[]
  lastUpdatedAt: string
  focusLabel: 'active' | 'watching' | 'idle'
}
