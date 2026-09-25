/**
 * FOUNDRY APPLICATION BUILDER — types for the new-project capability lane.
 * War Room remains the operating system. Customer applications live in isolated project roots.
 */

export const FOUNDRY_APPLICATION_BUILDER_LANE = 'APPLICATION_BUILDER' as const
export type FoundryCapabilityLane = 'WAR_ROOM_ENGINEERING' | 'APPLICATION_BUILDER'

export const APPLICATION_BUILDER_GOVERNANCE = {
  COMMIT: 'NO',
  PUSH: 'NO',
  LIVE_DEPLOY: 'NO',
  SPENDING: 'NO',
  PURCHASE: 'NO',
  PRODUCTION_DB_MUTATION: 'NO',
  SECRET_DISCLOSURE: 'NO',
} as const

export const APPLICATION_BUILDER_DEFAULT_PORT = 18780
export const APPLICATION_BUILDER_CRM_PORT = 18810
export const APPLICATION_BUILDER_DATA_APP_PORT = 18820

export type FoundryProjectType =
  | 'static_website'
  | 'frontend_web_app'
  | 'backend_api'
  | 'full_stack_web_app'
  | 'database_backed_app'
  | 'internal_business_tool'
  | 'desktop_later'
  | 'mobile_later'

export type FoundryNewProjectRecord = {
  projectId: string
  projectName: string
  projectRoot: string
  missionId: string
  projectType: FoundryProjectType
  createdAt: string
  stack: FoundryStackDecision | null
  requirements: FoundryProductRequirements | null
  researchSources: FoundryResearchRecord[]
  acceptanceCriteria: string[]
  status: FoundryApplicationProjectStatus
  lastOpenedAt?: string
  lastSuccessAt?: string
  previewPort?: number
  archived?: boolean
  archivedAt?: string
  archivedReason?: string
  supersededBy?: string | null
}

export type FoundryApplicationProjectStatus =
  | 'NEW_PROJECT'
  | 'RESEARCHING'
  | 'SPECIFYING'
  | 'ARCHITECTING'
  | 'INITIALIZING'
  | 'ENGINEERING'
  | 'VERIFYING'
  | 'REPAIRING'
  | 'PROJECT_READY'
  | 'WAITING_COMMANDER'
  | 'FAILED'

export type FoundryClaimKind = 'RESEARCHED_FACT' | 'OBSERVATION' | 'FOUNDRY_DESIGN_DECISION'
export type FoundryResearchSourceType = 'official_docs' | 'standards' | 'industry_example' | 'search_index' | 'technical_docs'

export type FoundryResearchRecord = {
  id: string
  source: string
  title: string
  retrievedAt: string
  claim: string
  relevance: string
  confidence: 'low' | 'medium' | 'high'
  usedFor: string
  kind: FoundryClaimKind
  freshness: 'current' | 'stale_unknown' | 'needs_research'
  query?: string
  sourceType?: FoundryResearchSourceType
  provider?: string
}

export type FoundryResearchProviderDiscovery = {
  available: string[]
  configured: string[]
  selected: string | null
  fallback: string | null
}

export type FoundryUnknownBusinessFact = {
  field: string
  reason: string
  commanderPrompt: string
}

export type FoundryAssetRequest = {
  id: string
  kind: 'logo' | 'icon' | 'illustration' | 'photo' | 'placeholder'
  purpose: string
  whyUnavailable: string
}

export type FoundryProductRequirements = {
  goal: string
  userType: string[]
  coreWorkflows: string[]
  functionalRequirements: string[]
  nonfunctionalRequirements: string[]
  dataRequirements: string[]
  integrations: string[]
  uiRequirements: string[]
  securityRequirements: string[]
  acceptanceCriteria: string[]
  unknownBusinessFacts: FoundryUnknownBusinessFact[]
  researchTrace: Array<{ requirement: string; researchIds: string[] }>
}

export type FoundryStackDecision = {
  stack: string
  alternativesConsidered: string[]
  reason: string
  decidedAt: string
}

export type FoundryApplicationPreview = {
  status: 'PROJECT_READY' | 'NOT_READY'
  projectName: string
  projectRoot?: string
  whatWasBuilt: string
  localPreview: string
  majorFeatures: string[]
  testStatus: string
  knownLimitations: string[]
  researchUsed: string[]
  researchSummary?: string
  sourceCount?: number
  stack?: string
  factsAwaitingCommander?: string[]
  assetRequests?: string[]
  viewportStatus?: string
  deploymentReadiness: string
}

export type FoundryApplicationMemory = {
  projectId: string
  commanderOutcome?: string
  architecture: string[]
  stackDecisions: FoundryStackDecision[]
  importantFiles: string[]
  routes?: string[]
  apiContracts: string[]
  databaseSchema: string[]
  knownLimitations: string[]
  deploymentDecisions: string[]
  requirements?: FoundryProductRequirements | null
  researchProvenance?: Array<{ id: string; source: string; kind: FoundryClaimKind; query?: string }>
  factsAwaitingCommander?: FoundryUnknownBusinessFact[]
  assetRequests?: FoundryAssetRequest[]
  testStrategy?: string
  continuationHistory?: Array<{ at: string; request: string; filesChanged: string[] }>
  reusedResearch?: string[]
  refreshedResearch?: string[]
  updatedAt: string
}

export type FoundryViewportResult = {
  name: 'desktop' | 'tablet' | 'mobile'
  width: number
  height: number
  ok: boolean
  detail: string
  overflow: boolean
  blankScreen: boolean
  missingContent: boolean
}

export type FoundryApplicationRepair = {
  at: string
  failureClass: 'dependency' | 'typescript' | 'runtime' | 'route' | 'layout' | 'test' | 'api' | 'other'
  evidence: string
  owner: string
  action: string
  retested: boolean
}

export type FoundryApplicationBuilderState = {
  lane: typeof FOUNDRY_APPLICATION_BUILDER_LANE
  project: FoundryNewProjectRecord | null
  research: FoundryResearchRecord[]
  researchQueries: string[]
  researchProviders?: FoundryResearchProviderDiscovery
  selectedResearchProvider?: string | null
  fallbackResearchProvider?: string | null
  reusedResearch?: string[]
  refreshedResearch?: string[]
  requirements: FoundryProductRequirements | null
  stack: FoundryStackDecision | null
  assetRequests: FoundryAssetRequest[]
  preview: FoundryApplicationPreview | null
  memory: FoundryApplicationMemory | null
  viewportResults: FoundryViewportResult[]
  routesChecked: string[]
  repairs: FoundryApplicationRepair[]
  continuationOf: string | null
  deploymentAuthorized: boolean
  spendAuthorized: boolean
  evidence: Record<string, string | number | boolean | string[]>
}

export function emptyApplicationBuilderState(): FoundryApplicationBuilderState {
  return {
    lane: FOUNDRY_APPLICATION_BUILDER_LANE,
    project: null,
    research: [],
    researchQueries: [],
    researchProviders: undefined,
    selectedResearchProvider: null,
    fallbackResearchProvider: 'duckduckgo_html',
    reusedResearch: [],
    refreshedResearch: [],
    requirements: null,
    stack: null,
    assetRequests: [],
    preview: null,
    memory: null,
    viewportResults: [],
    routesChecked: [],
    repairs: [],
    continuationOf: null,
    deploymentAuthorized: false,
    spendAuthorized: false,
    evidence: {},
  }
}
