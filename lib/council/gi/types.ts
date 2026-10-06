/**
 * GI-ENG-01 — Divine Council front-door contracts.
 * Extends existing EBC / session / permissions. Not Council2.
 */

export const COMMANDER_TURN_SCHEMA = 'war-room.commander-turn.v1' as const
export const OUTPUT_ENVELOPE_SCHEMA = 'war-room.output-envelope.v1' as const
export const ENGINEERING_HANDOFF_SCHEMA = 'war-room.engineering-handoff.v1' as const
export const RESEARCH_HANDOFF_SCHEMA = 'war-room.research-handoff.v1' as const
export const GI_TURN_TELEMETRY_SCHEMA = 'war-room.gi-turn-telemetry.v1' as const

export const COUNCIL_PATHS = ['SHORT_PATH', 'AGENT_PATH', 'HANDOFF'] as const
export type CouncilPath = (typeof COUNCIL_PATHS)[number]

export const MISSION_CLASS_HINTS = [
  'CHITCHAT',
  'SIMPLE_QA',
  'FORMAT',
  'SOCIAL_CHECKIN',
  'SYSTEM_STATUS',
  'INCIDENT_RESPONSE',
  'DEEP_RESEARCH',
  'ARCHITECTURE_REVIEW',
  'ENGINEERING',
  'MEDIA_PROD',
  'WORLD_QUERY',
  'DOCUMENT_ANALYSIS',
  'CURRENT_INTEL',
  'UNKNOWN',
] as const
export type MissionClassHint = (typeof MISSION_CLASS_HINTS)[number]

export const INTENT_CLASSES = [
  'CASUAL_CONVERSATION',
  'DIRECT_ANSWER',
  'SIMPLE_TOOL_USE',
  'AGENT_REASONING',
  'DEEP_RESEARCH',
  'ENGINEERING_HANDOFF',
  'CURRENT_INTEL',
  'SYSTEM_STATUS',
  'DOCUMENT_ANALYSIS',
  'INCIDENT',
  'ARCHITECTURE_REVIEW',
] as const
export type IntentClass = (typeof INTENT_CLASSES)[number]

export const REASONING_BUDGETS = ['FAST', 'STANDARD', 'DEEP'] as const
export type ReasoningBudget = (typeof REASONING_BUDGETS)[number]

export const TOOL_NEEDS = [
  'NONE',
  'CALCULATOR',
  'SYSTEM_PROBE',
  'BROWSER_SEARCH',
  'VISION',
  'FOUNDRY',
  'DOCUMENT',
] as const
export type ToolNeed = (typeof TOOL_NEEDS)[number]

export const HANDOFF_TARGETS = ['FOUNDRY', 'BROWSER_BROKER', 'TERRA', 'HVS', 'MEDIA'] as const
export type HandoffTarget = (typeof HANDOFF_TARGETS)[number]

export const RISK_CLASSES = ['LOW', 'MED', 'HIGH', 'CRITICAL'] as const
export type RiskClass = (typeof RISK_CLASSES)[number]

export const AUTHORITY_CLASSES = ['OWNABLE', 'REQUIRE_AUTH', 'HOLD', 'REFUSE'] as const
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number]

export const MODEL_PLACEMENTS = ['LOCAL', 'HYBRID', 'CLOUD', 'NONE'] as const
export type ModelPlacement = (typeof MODEL_PLACEMENTS)[number]

export const COMPLETION_STATES = [
  'VERIFIED',
  'PARTIALLY_VERIFIED',
  'UNVERIFIED',
  'CONTRADICTED',
  'TOOL_BLOCKED',
  'STALE',
  'BUDGET_EXHAUSTED',
  'REFUSED',
  'NEEDS_CLARIFICATION',
  'ESCALATED',
  'HANDED_OFF',
] as const
export type GiCompletionState = (typeof COMPLETION_STATES)[number]

/**
 * Honest capture state. Never LISTENING / SEEING / WATCHING.
 * LISTENING chrome is allowed only when capture_truth === CAPTURING and a voice session id is proven.
 */
export const CAPTURE_TRUTH_STATES = [
  'NOT_REQUESTED',
  'AVAILABLE',
  'CAPTURING',
  'CAPTURED',
  'PARTIAL',
  'UNAVAILABLE',
  'FAILED',
  'PERMISSION_DENIED',
  'DEVICE_UNAVAILABLE',
  'MUTED',
  'IDLE',
] as const
export type CaptureTruth = (typeof CAPTURE_TRUTH_STATES)[number]

export const FORBIDDEN_CAPTURE_LABELS = ['LISTENING', 'SEEING', 'WATCHING'] as const

export type PathClassifierResult = {
  path: CouncilPath
  mission_class: MissionClassHint
  intent_class: IntentClass
  confidence: number
  rules_fired: string[]
  tools_needed_est: 0 | 1 | 'many'
  tool_need: ToolNeed
  risk_class: RiskClass
  handoff_target?: HandoffTarget
  seats_recommended: string[]
  ambiguous: boolean
  ambiguities: string[]
  escalation_allowed: boolean
  clarifying_question?: string
  budget: ReasoningBudget
  reason: string
  llm_fallback_used: boolean
}

export type AssetRef = {
  asset_id: string
  content_hash: string
  storage: 'LOCAL' | 'HYBRID' | 'CLOUD_ORIGIN'
  bytes?: number
  mime: string
  name?: string
}

export type TurnPart =
  | { kind: 'text'; content_type: 'text/plain' | 'text/markdown'; text: string }
  | { kind: 'file'; content_type: string; asset_ref: AssetRef; name?: string }
  | { kind: 'image'; content_type: string; asset_ref: AssetRef; alt?: string }
  | { kind: 'audio'; content_type: string; asset_ref: AssetRef; duration_ms?: number }
  | { kind: 'video'; content_type: string; asset_ref: AssetRef; duration_ms?: number }
  | { kind: 'uri'; url: string; fetch_policy: 'LINK_OUT' | 'BROKER_FETCH' | 'REFUSE' }
  | { kind: 'structured'; content_type: 'application/json'; data: Record<string, unknown> }

export type CommanderTurnContext = {
  session_title?: string
  active_topic?: string
  prior_turn_ids?: string[]
  prior_turns?: string[]
  conversation_id?: string
}

export type CommanderTurnV1 = {
  schema_version: typeof COMMANDER_TURN_SCHEMA
  turn_id: string
  room_id: string
  session_id: string
  mission_id?: string
  text?: string
  parts: TurnPart[]
  asset_refs: AssetRef[]
  capture_truth: CaptureTruth
  context: CommanderTurnContext
  created_at: string
  actor?: { kind: 'COMMANDER'; user_id: string }
  authority?: { policy_profile: string; allow_side_effects: boolean }
  voice?: { voice_session_id?: string; capture_truth: CaptureTruth }
  correlation?: { reply_to_turn_id?: string; thread_id?: string }
  intent_hint?: MissionClassHint
}

export type MultimodalEnvelope = CommanderTurnV1

export type EnvelopeValidationIssue = {
  code: string
  message: string
}

export type EnvelopeValidationResult =
  | { ok: true; envelope: CommanderTurnV1 }
  | { ok: false; issues: EnvelopeValidationIssue[] }

export type PublicToolTrace = { step: number; label: string; ok: boolean }

export type AuthorityDecision = {
  tool_id: string
  resource?: string
  decision: 'auto' | 'ask' | 'deny'
  authority_class: AuthorityClass
  actor: 'POLICY' | 'COMMANDER' | 'SYSTEM'
  reason: string
  ts: string
  grant_id?: string
  executed: false | true
  capability_available: boolean
}

export type AuthorityMatrixRow = {
  tool_id: string
  nl_labels: string[]
  owner_module: 'Council' | 'Broker' | 'Foundry' | 'Terra' | 'HVS' | 'Media' | 'Connector'
  risk_class: RiskClass
  authority_class: AuthorityClass
  allowed_paths: CouncilPath[]
  dangerous_kind?: string
  notes: string
}

export type OutputEnvelopeV1 = {
  schema_version: typeof OUTPUT_ENVELOPE_SCHEMA
  output_id: string
  in_reply_to: string
  path: CouncilPath
  path_used: CouncilPath
  completion_state: GiCompletionState
  advisory: true
  body: { summary: string; unknowns: string[]; risks: string[] }
  artifacts: Array<{ id: string; kind: string; label: string }>
  tool_trace_public: PublicToolTrace[]
  seats_used: string[]
  capture_truth?: CaptureTruth
  authority_decisions: AuthorityDecision[]
  next_actions: Array<{ label: string; requires_commander: boolean }>
  placement: ModelPlacement
  handoff?: EngineeringHandoffV1 | ResearchHandoffV1 | ModuleHandoffV1
  escalation?: GiEscalation
  telemetry?: GiTurnTelemetry
}

export type GiEscalation = {
  from: CouncilPath
  to: CouncilPath
  reason: string
  observed: true
  at: string
}

export type EngineeringHandoffV1 = {
  schema_version: typeof ENGINEERING_HANDOFF_SCHEMA
  handoff_id: string
  room_id: string
  session_id: string
  mission_id?: string
  objective: string
  context_refs: string[]
  acceptance: string[]
  authority: AuthorityClass
  non_goals: string[]
  created_at: string
  target: 'FOUNDRY'
  executed: false
}

export type ResearchHandoffV1 = {
  schema_version: typeof RESEARCH_HANDOFF_SCHEMA
  handoff_id: string
  room_id: string
  session_id: string
  mission_id?: string
  objective: string
  context_refs: string[]
  authority: AuthorityClass
  created_at: string
  target: 'BROWSER_BROKER'
  executed: false
}

export type ModuleHandoffV1 = {
  schema_version: 'war-room.module-handoff.v1'
  handoff_id: string
  room_id: string
  session_id: string
  mission_id?: string
  objective: string
  context_refs: string[]
  authority: AuthorityClass
  created_at: string
  target: Exclude<HandoffTarget, 'FOUNDRY' | 'BROWSER_BROKER'>
  executed: false
}

export type GiTurnTelemetry = {
  schema_version: typeof GI_TURN_TELEMETRY_SCHEMA
  turn_id: string
  path: CouncilPath
  classifier_reason: string
  latency_ms: number
  model_placement: ModelPlacement
  tool_count: number
  seats_used: string[]
  handoff_type?: HandoffTarget
  escalation?: GiEscalation
  capture_truth: CaptureTruth
  model_family?: string
  fallback?: string
  ttft_ms?: number | null
}

export type ShortPathRuntimeRequest = {
  envelope: CommanderTurnV1
  path: 'SHORT_PATH'
  allow_tools: boolean
  tool_allowlist: string[]
  model_route: {
    lane: 'classify_or_short'
    placement: ModelPlacement
  }
  budget?: { tokens?: number; wall_ms?: number }
}

export type ShortPathCompletion = {
  text: string
  placement: ModelPlacement
  model_invoked: boolean
  provider_family?: string
  display_name?: string
  latency_ms?: number
  ttft_ms?: number | null
  fallback?: 'none' | 'quality_completer' | 'no_target' | 'flag_off' | 'provider_error'
  failure?: string
  status?: 'ok' | 'error' | 'timeout' | 'not_dispatchable'
}

export type ShortPathCompleter = (input: {
  text: string
  envelope: CommanderTurnV1
  prior_turns?: string[]
}) => Promise<ShortPathCompletion>

export type CommanderFacingResponse = {
  text: string
  path: CouncilPath
  completion_state: GiCompletionState
  capture_truth?: CaptureTruth
  placement: ModelPlacement
  next_actions: Array<{ label: string; requires_commander: boolean }>
  inspector?: {
    seats_used: string[]
    tool_trace_public: PublicToolTrace[]
    authority_decisions: AuthorityDecision[]
    classifier_reason: string
    escalation?: GiEscalation
    handoff?: EngineeringHandoffV1 | ResearchHandoffV1 | ModuleHandoffV1
  }
}
