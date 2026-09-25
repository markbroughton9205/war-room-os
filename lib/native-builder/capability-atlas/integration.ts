/**
 * Future-system contracts. This mission does not implement Watchtower, Legion, or WRIM training.
 */
export const WRIM_INTEGRATION_BOUNDARY = {
  implemented: false,
  trainingExecuted: false,
  checkpointMutation: false,
  usage: [
    'WRIM may later call Skill Resolver',
    'WRIM may later retrieve Skill Packs',
    'WRIM may later use Foundry tools and Engineering Memory',
    'Atlas metadata may later seed coding curricula — not in this mission',
  ],
} as const

export const WATCHTOWER_INTEGRATION_BOUNDARY = {
  implemented: false,
  usage: [
    'Watchtower may later mark sources potentially stale',
    'Atlas then requires a verification mission',
    'lastVerified updates only after verification',
  ],
} as const

export const LEGION_INTEGRATION_BOUNDARY = {
  implemented: false,
  usage: [
    'Legion specialists may request skills from this same Atlas',
    'Frontend / database / security / testing / release specialists share skill ids',
    'Legion is not implemented in this mission',
  ],
} as const

export type WatchtowerStaleHint = {
  sourceId: string
  reason: string
  detectedAt: string
}

export type LegionSkillRequest = {
  specialist: 'frontend' | 'database' | 'security' | 'testing' | 'release' | string
  mission: string
}

export function wrimTrainingForbidden(): { wrimTraining: false; reason: string } {
  return { wrimTraining: false, reason: 'This mission builds the Atlas foundation only. Do not train WRIM.' }
}
