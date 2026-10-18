/**
 * Foundry Coding Capability Atlas — normalized schemas.
 * A registered skill is not mastery. Status is derived from evidence.
 */

export const CAPABILITY_STATUSES = [
  'DISCOVERED',
  'SOURCE_BACKED',
  'LEARNABLE',
  'AVAILABLE',
  'EVALUATION_PENDING',
  'EVALUATED',
  'PROVEN',
  'PRODUCTION_PROVEN',
  'STALE',
  'FAILED',
  'UNSUPPORTED',
] as const

export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number]

export const MATURE_STATUSES: readonly CapabilityStatus[] = [
  'DISCOVERED',
  'SOURCE_BACKED',
  'LEARNABLE',
  'AVAILABLE',
  'EVALUATION_PENDING',
  'EVALUATED',
  'PROVEN',
  'PRODUCTION_PROVEN',
]

export const EVALUATION_LEVELS = [
  'KNOWLEDGE_EVAL',
  'CODE_EVAL',
  'DEBUG_EVAL',
  'INTEGRATION_EVAL',
  'PRODUCTION_EVAL',
] as const

export type EvaluationLevel = (typeof EVALUATION_LEVELS)[number]

export const SOURCE_AUTHORITY_CLASSES = [
  'PRIMARY',
  'OFFICIAL',
  'STANDARD',
  'REFERENCE_IMPLEMENTATION',
  'ACADEMIC',
  'MAJOR_COMMUNITY',
  'SECONDARY',
] as const

export type SourceAuthorityClass = (typeof SOURCE_AUTHORITY_CLASSES)[number]

export const SOURCE_PRIORITY: readonly SourceAuthorityClass[] = [
  'PRIMARY',
  'OFFICIAL',
  'STANDARD',
  'REFERENCE_IMPLEMENTATION',
  'ACADEMIC',
  'MAJOR_COMMUNITY',
  'SECONDARY',
]

export const SOURCE_TYPES = [
  'official_specification',
  'official_documentation',
  'primary_repository',
  'reference_implementation',
  'recognized_standard',
  'academic',
  'package_registry',
  'bug_tracker',
  'security_advisory',
  'release_notes',
  'kernel_documentation',
  'operating_system_documentation',
  'vendor_documentation',
  'major_community',
  'secondary',
] as const

export type SourceType = (typeof SOURCE_TYPES)[number]

export const RELATIONSHIP_KINDS = [
  'REQUIRES',
  'RELATED_TO',
  'SPECIALIZES',
  'SUPERSEDES',
  'USES_TOOL',
  'VALIDATED_BY',
  'APPLIES_TO_PLATFORM',
] as const

export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number]

export const SKILL_LIFECYCLES = ['CURRENT', 'DEPRECATED', 'SUPERSEDED', 'LEGACY'] as const
export type SkillLifecycle = (typeof SKILL_LIFECYCLES)[number]

export const MODEL_ROUTING_POLICIES = [
  'LOCAL_MODEL_OK',
  'FRONTIER_RECOMMENDED',
  'SPECIALIST_TOOL_REQUIRED',
  'FOUNDRY_NATIVE_PROVEN',
] as const

export type ModelRoutingPolicy = (typeof MODEL_ROUTING_POLICIES)[number]

export const CONFIDENCE_LEVELS = ['none', 'low', 'medium', 'high'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

export type TaxonomyNode = {
  id: string
  name: string
  parentId: string | null
  depth: number
  aliases: string[]
  keywords: string[]
  description: string
  extensible: true
}

export type SourceRecord = {
  sourceId: string
  sourceUrl: string
  sourceType: SourceType
  organization: string
  license: string
  version: string | null
  lastVerified: string | null
  retrievedAt: string | null
  authorityClass: SourceAuthorityClass
  contentHash: string | null
  title: string
  skillIds: string[]
  stale: boolean
  staleReason: string | null
  notes: string
}

export type SourceHistoryEntry = {
  sourceId: string
  at: string
  action: 'REGISTERED' | 'UPDATED' | 'MARKED_STALE' | 'REVERIFIED'
  snapshot: Pick<SourceRecord, 'sourceUrl' | 'version' | 'lastVerified' | 'contentHash' | 'authorityClass' | 'stale'>
}

export type SkillEvidence = {
  implementationFiles: string[]
  brokerTools: string[]
  validators: string[]
  proofFiles: string[]
  notes: string
}

export type SkillRecord = {
  skillId: string
  name: string
  domain: string
  subdomain: string | null
  description: string
  capabilityClass: string
  languages: string[]
  frameworks: string[]
  platforms: string[]
  operatingSystems: string[]
  tools: string[]
  officialSources: string[]
  openSourceSources: string[]
  referenceImplementations: string[]
  prerequisiteSkills: string[]
  relatedSkills: string[]
  requiredContext: string[]
  supportedToolBrokerTools: string[]
  validationMethods: string[]
  knownFailureModes: string[]
  securityConsiderations: string[]
  governanceRequirements: string[]
  localModelCompatibility: 'unknown' | 'ok' | 'limited' | 'not_recommended'
  frontierModelCompatibility: 'unknown' | 'ok' | 'recommended' | 'required'
  selfHostable: boolean | null
  lastSourceVerified: string | null
  lastCapabilityEvaluated: string | null
  capabilityStatus: CapabilityStatus
  confidence: ConfidenceLevel
  productionProofMissions: string[]
  engineeringMemoryLinks: string[]
  version: number
  lifecycle: SkillLifecycle
  modelRouting: ModelRoutingPolicy[]
  evidence: SkillEvidence
  unsupportedReason: string | null
}

export type SkillRelationship = {
  id: string
  from: string
  kind: RelationshipKind
  to: string
  note: string
}

export type EvaluationOutcome = 'PASS' | 'FAIL' | 'PARTIAL' | 'NOT_RUN'

export type EvaluationRecord = {
  evaluationId: string
  skillId: string
  level: EvaluationLevel
  title: string
  requiredSteps: string[]
  evidencePaths: string[]
  missionId: string | null
  outcome: EvaluationOutcome
  evaluatedAt: string | null
  notes: string
  production: boolean
  command: string | null
  resultSummary: string
  environment: string | null
  limitations: string
  confidence: ConfidenceLevel
}

export type SkillGap = {
  kind: 'SKILL_GAP'
  skillId: string
  requiredForMission: string
  currentStatus: CapabilityStatus | 'UNREGISTERED'
  availableSources: string[]
  researchRequired: boolean
  evaluationRequired: boolean
  why: string
}

export type SkillResolution = {
  mission: string
  primarySkills: string[]
  secondarySkills: string[]
  optionalSkills: string[]
  missingSkills: SkillGap[]
  confidence: ConfidenceLevel
  why: string[]
}

export const CAPABILITY_RECOMMENDATIONS = [
  'CAPABILITY_READY',
  'CAPABILITY_READY_WITH_VALIDATION',
  'CAPABILITY_GAP',
  'CAPABILITY_RESEARCH_REQUIRED',
  'CAPABILITY_UNSUPPORTED',
] as const

export type CapabilityRecommendation = (typeof CAPABILITY_RECOMMENDATIONS)[number]

export const CAPABILITY_GATE_AUTHORITY = {
  canApproveTools: false,
  canApproveProduction: false,
  canApproveDeploy: false,
  canGrantShell: false,
  canGrantBrowser: false,
  canGrantComputerUse: false,
  canGrantSpending: false,
  canBypassCommanderAuthorization: false,
  bypassesToolBroker: false,
  isAuthorityLayer: false,
  isCommanderPermissionWhitelist: false,
  blocksCommanderProjects: false,
} as const

export type CapabilityAssessment = {
  requiredSkills: string[]
  optionalSkills: string[]
  secondarySkills: string[]
  missingSkills: SkillGap[]
  provenSkills: string[]
  evaluatedSkills: string[]
  productionProofMissing: string[]
  confidence: ConfidenceLevel
  recommendation: CapabilityRecommendation
  why: string[]
  productionProofRequired: boolean
  acquisitionPlans: SkillAcquisitionPlan[]
  selectedPackSkillIds: string[]
  repoTruthNotes: string[]
  resolverConfidence: ConfidenceLevel
  autoTrustResearch: false
  wrimTraining: false
  terraMutation: false
  globalResearchStarted: false
  grantsAuthority: false
  loadedPackCount: number
}

export type SkillPack = {
  packId: string
  skillId: string
  version: number
  metadata: {
    name: string
    domain: string
    status: CapabilityStatus
    confidence: ConfidenceLevel
    modelRouting: ModelRoutingPolicy[]
  }
  officialSources: Array<{ sourceId: string; url: string; authorityClass: SourceAuthorityClass }>
  knownToolCommands: string[]
  commonFailurePatterns: string[]
  validationMethods: string[]
  relevantRepoOwnershipMemory: string[]
  relatedTests: string[]
  briefProceduralGuidance: string
  compact: true
}

export type CapabilityScoreboard = {
  skillsRegistered: number
  sourceBacked: number
  evaluated: number
  proven: number
  productionProven: number
  stale: number
  failed: number
  unknown: number
  unsupported: number
  available: number
  discovered: number
  learnable: number
  evaluationPending: number
  languagesCovered: number
  domainsCovered: number
  lastUpdated: string
}

export type SkillAcquisitionPlan = {
  skillId: string
  requiredForMission: string | null
  steps: string[]
  autoTrustResearch: false
  wrimTraining: false
  terraMutation: false
  commit: false
  push: false
  sandboxEvaluationRequired: true
}

export type AtlasIndex = {
  version: number
  updatedAt: string
  skillIds: string[]
  sourceIds: string[]
  evaluationIds: string[]
  relationshipIds: string[]
  domainIds: string[]
}
