/**
 * Roadmap #21 — War Room Agent Capability Matrix (evaluation / governance).
 *
 * Core principle: CAPABILITY != AUTHORITY.
 * Technical reach and policy authority are always separate fields.
 * This module is definition + validation only. It does not grant new powers.
 */

/** Capability domains for matrix rows. */
export const CAPABILITY_DOMAINS = [
  'TERRA_ORACLE',
  'SOVEREIGN_SEARCH',
  'WEB_INTERNET',
  'CRAWLER',
  'WAR_ROOM_FILES',
  'LOCAL_FILESYSTEM',
  'REPOSITORY',
  'GIT',
  'GITHUB',
  'WINDOWS_NEBULA',
  'SHELL_POWERSHELL',
  'SUPABASE',
  'DATABASE',
  'SQL',
  'MEMORY',
  'COUNCIL_SESSION_INTELLIGENCE',
  'ASTRA',
  'BROWSER',
  'EXTERNAL_APIS',
  'EMAIL_COMMUNICATIONS',
  'PHONE_TWILIO',
  'LOCAL_MODELS_OLLAMA',
  'MODEL_PROVIDERS',
  'PRODUCTION_RUNTIME',
  'DEPLOYMENT',
  'WATCHDOG',
  'CLOUD_HOSTING',
  'FINANCIAL_SYSTEMS',
  'SECURITY_DESTRUCTIVE',
] as const
export type CapabilityDomain = (typeof CAPABILITY_DOMAINS)[number]

/** Action types tested per domain. */
export const CAPABILITY_ACTIONS = [
  'DISCOVER',
  'READ',
  'QUERY',
  'ANALYZE',
  'WRITE',
  'MODIFY',
  'CREATE',
  'EXECUTE',
  'DELETE',
  'COMMIT',
  'PUSH',
  'DEPLOY',
  'SEND',
  'PURCHASE_SPEND',
  'TRANSFER',
  'TRADE_WAGER',
  'APPROVE',
  'SCHEDULE',
  'CRAWL',
  'RESTART',
  'STOP_PROCESS',
  'ALTER_DATABASE',
] as const
export type CapabilityAction = (typeof CAPABILITY_ACTIONS)[number]

/** Technical reach — never vague words like "some" / "maybe". */
export const TECHNICAL_REACH_LEVELS = [
  'NO_REACH',
  'DISCOVER_ONLY',
  'READ_ONLY',
  'WRITE_BOUNDED',
  'EXECUTE_SANDBOXED',
  'EXECUTE_CONTROLLED',
  'FULL_TECHNICAL_REACH',
  'UNKNOWN',
] as const
export type TechnicalReachLevel = (typeof TECHNICAL_REACH_LEVELS)[number]

/** Policy authority — independent of technical reach. */
export const POLICY_AUTHORITY_LEVELS = [
  'DENIED',
  'READ_ALLOWED',
  'BOUNDED_ALLOWED',
  'APPROVAL_REQUIRED',
  'COMMANDER_ONLY',
  'SYSTEM_INTERNAL',
  'NOT_APPLICABLE',
] as const
export type PolicyAuthorityLevel = (typeof POLICY_AUTHORITY_LEVELS)[number]

/** Impact / risk tiers. */
export const RISK_TIERS = [
  'TIER_0_READ_OBSERVE',
  'TIER_1_REVERSIBLE_LOCAL_SANDBOX',
  'TIER_2_PERSISTENT_INTERNAL_MUTATION',
  'TIER_3_EXTERNAL_REMOTE_MUTATION',
  'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
] as const
export type RiskTier = (typeof RISK_TIERS)[number]

/** Approval types (minimum set for #21 / input to #22). */
export const APPROVAL_TYPES = [
  'NO_APPROVAL',
  'POLICY_AUTO_ALLOWED',
  'SESSION_APPROVAL',
  'ONE_ACTION_APPROVAL',
  'COMMANDER_EXPLICIT_APPROVAL',
] as const
export type ApprovalType = (typeof APPROVAL_TYPES)[number]

/** Truthful denial states — do not conflate policy with technical failure. */
export const DENIAL_STATES = [
  'NO_TECHNICAL_REACH',
  'POLICY_DENIED',
  'APPROVAL_REQUIRED',
  'APPROVAL_EXPIRED',
  'TARGET_OUT_OF_SCOPE',
  'UNAVAILABLE',
  'NOT_IMPLEMENTED',
  'DEGRADED',
] as const
export type DenialState = (typeof DENIAL_STATES)[number]

/** Actor classification — name ≠ agent. */
export const ACTOR_CLASSES = [
  'HUMAN',
  'REASONER',
  'ORCHESTRATOR',
  'EXECUTOR',
  'TOOL',
  'DATA_SOURCE',
  'WORLD_STATE_SOURCE',
  'OBSERVER',
  'OTHER',
] as const
export type ActorClass = (typeof ACTOR_CLASSES)[number]

export const RUNTIME_STATUSES = [
  'IMPLEMENTED',
  'IMPLEMENTED_BOUNDED',
  'REGISTERED_ONLY',
  'PLANNED',
  'DEFERRED',
  'NOT_IMPLEMENTED',
  'STRUCTURALLY_FORBIDDEN',
] as const
export type RuntimeStatus = (typeof RUNTIME_STATUSES)[number]

export const CURRENT_VS_TARGET = ['CURRENT_RUNTIME', 'TARGET_ASCENSION'] as const
export type CurrentVsTarget = (typeof CURRENT_VS_TARGET)[number]

/** Proposed Ascension / matrix agent roles (#21 definitions only — not live agents). */
export const MATRIX_AGENT_ROLES = [
  'COMMANDER',
  'COUNCIL_SEAT',
  'ASTRA_ORCHESTRATOR',
  'RESEARCH_AGENT',
  'ENGINEERING_AGENT',
  'TERRA_INTELLIGENCE_AGENT',
  'OPERATIONS_AGENT',
  'SECURITY_RED_TEAM_AGENT',
  'COUNCIL_VALIDATOR',
  'DATA_CORPUS_AGENT',
  'NAVIGATION_AGENT',
  'FUTURE_NAVIGATION_AGENT',
  'WORLD_LEARNING_AGENT',
  'FUTURE_WORLD_LEARNING_AGENT',
  'BABY_OBSERVER',
  'NATIVE_BUILDER',
  'BACKGROUND_WORKER',
] as const
export type MatrixAgentRole = (typeof MATRIX_AGENT_ROLES)[number]

export type CapabilityMatrixEntry = {
  id: string
  agentRole: MatrixAgentRole
  domain: CapabilityDomain
  action: CapabilityAction
  technicalReach: TechnicalReachLevel
  policyAuthority: PolicyAuthorityLevel
  riskTier: RiskTier
  approvalRequirement: ApprovalType
  runtimeStatus: RuntimeStatus
  currentVsTarget: CurrentVsTarget
  evidence: string
}

/** Conceptual runtime authorization envelope (evaluation only — not enforced yet). */
export type ToolAuthorityEnvelope = {
  actor: string
  agentRole: MatrixAgentRole
  tool: string
  capability: CapabilityAction
  target: string
  technicalReach: TechnicalReachLevel
  policyAuthority: PolicyAuthorityLevel
  riskTier: RiskTier
  requiresApproval: boolean
  approvalType: ApprovalType
  scope: string
  expiration: string | null
  reason: string
  auditId: string | null
}

/** Terra Oracle evidence contract (Phase 4) — contract only, no redesign. */
export type TerraOracleEvidenceContract = {
  type: string
  category: string
  objectOrEventId: string
  location: {
    latitude: number | null
    longitude: number | null
    region: string | null
    jurisdiction: string | null
    country: string | null
  }
  geometry: unknown | null
  observedAt: string | null
  retrievedAt: string
  source: string
  provider: string
  freshness: string
  confidence: number | null
  provenance: Record<string, unknown>
  truthStatus: string
  humanReadableMeaning: string
  nearbyWorldContext: unknown | null
  coverageState: 'live' | 'cached' | 'stale' | 'no_coverage' | 'degraded' | 'not_implemented'
  councilReviewState: 'not_submitted' | 'submitted' | 'under_review' | 'interpreted' | 'rejected'
}
