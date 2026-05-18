import type { BabyAgentKey } from '@/lib/baby-ai/model'

export type FeatureBuilderStatus =
  | 'idea'
  | 'reviewed'
  | 'approved'
  | 'sent_to_cursor'
  | 'building'
  | 'validated'
  | 'shipped'

export type FeatureBuilderApprovalStatus = 'proposal_only' | 'awaiting_commander_approval' | 'approved' | 'rejected'

export type FeatureBuilderValidationCommand =
  | 'pnpm exec tsc --noEmit'
  | 'pnpm exec eslint app components lib --max-warnings=0'
  | 'pnpm run build'

export type FeatureBuilderRequestInput = {
  idea: string
  targetAppModule?: string | null
  commanderContext?: string | null
}

export type FeatureBuilderRequest = {
  id: string
  requestId: string
  idea: string
  targetAppModule: string
  commanderContext: string | null
  status: FeatureBuilderStatus
  approvalStatus: FeatureBuilderApprovalStatus
  createdAt: string
  updatedAt: string | null
}

export type FeatureFamilyContribution = {
  agentKey: BabyAgentKey
  agentName: string
  lane: string
  contribution: string
  confidence: number
  sourceAttribution: string
  approvalRequired: true
  canExecute: false
}

export type FeatureBuildPacket = {
  id: string
  requestId: string
  title: string
  objective: string
  userStory: string
  targetAppModule: string
  requiredFilesToInspect: string[]
  technicalApproach: string[]
  databaseChanges: string[]
  apiRoutes: string[]
  uiComponents: string[]
  validationCommands: FeatureBuilderValidationCommand[]
  risks: string[]
  rollbackNotes: string[]
  approvalStatus: FeatureBuilderApprovalStatus
  status: FeatureBuilderStatus
  monetizationAngle: string
  cursorReadyImplementationPrompt: string
  familyContributions: FeatureFamilyContribution[]
  liveCouncil: {
    babyContributionsEnabled: true
    executionAllowed: false
    cursorHandoffAllowed: 'manual_copy_only'
    providerDependency: 'cloud_only'
  }
  createdAt: string
}

export type FeatureBuilderReview = {
  id: string
  packetId: string
  agentKey: BabyAgentKey
  agentName: string
  reviewType: 'synthesis' | 'architecture' | 'decomposition' | 'risk' | 'market' | 'monetization' | 'integration' | 'trend'
  summary: string
  confidence: number
  approvalRequired: true
  canExecute: false
  createdAt: string
}

export type FeatureBuilderOutcome = {
  id: string
  packetId: string
  status: FeatureBuilderStatus
  summary: string
  validated: boolean
  createdAt: string
}

export type FeatureBuilderSnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  persistenceNote: string
  requests: FeatureBuilderRequest[]
  packets: FeatureBuildPacket[]
  reviews: FeatureBuilderReview[]
  outcomes: FeatureBuilderOutcome[]
  guardrails: {
    hiddenCodeExecution: false
    autoDeployment: false
    warRoomFileMutation: false
    cursorExecution: 'manual_approved_only'
    localConnectors: false
    cloudOnly: true
  }
}

export const FEATURE_BUILDER_VALIDATION_COMMANDS: FeatureBuilderValidationCommand[] = [
  'pnpm exec tsc --noEmit',
  'pnpm exec eslint app components lib --max-warnings=0',
  'pnpm run build',
]

