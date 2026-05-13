import type { MemoryIntent } from './types'

export const MEMORY_CATEGORIES: MemoryIntent[] = [
  'temporary',
  'session',
  'operational',
  'strategic',
  'permanent',
  'archived',
]

export const MEMORY_POLICY = {
  autoSaveAllowed: false,
  saveRequiresRaelApproval: true,
  councilCanRecommendMemory: true,
  babyLearnsOnlyFromApprovedMemory: true,
  categories: MEMORY_CATEGORIES,
  rules: [
    'No auto-save clutter.',
    "Save only by Ra'el approval or council recommendation.",
    'Categorize memory before persistence.',
    'Baby AI learns only from approved memory.',
  ],
} as const

export function canPersistMemory(input: { approvedByRael: boolean; recommendedByCouncil: boolean }) {
  return input.approvedByRael || input.recommendedByCouncil
}
