/**
 * Roadmap #21 — governance invariants (no-self-escalation, inheritance, boundaries).
 * Evaluation definitions only — not a new parallel approval runtime.
 */

export const NO_SELF_ESCALATION_INVARIANTS = Object.freeze([
  'An agent must NEVER grant itself new capabilities.',
  'An agent must NEVER change its own policy tier.',
  'An agent must NEVER approve its own approval request.',
  'An agent must NEVER modify the Commander approval requirement.',
  'An agent must NEVER spawn a more privileged agent as a bypass.',
  'An agent must NEVER route an action through another agent to evade policy.',
] as const)

export const CHILD_AGENT_INHERITANCE_RULES = Object.freeze({
  default: 'child capability <= parent capability; child authority <= parent authority',
  scope: 'mission-scoped',
  timeBound: 'time-bounded',
  amplification: 'No privilege amplification.',
  constellationNote: 'CURRENT: constellation workers are plan-only (spawned:false). TARGET must inherit these caps.',
})

export const COUNCIL_AUTHORITY_BOUNDARY = Object.freeze({
  may: ['reason', 'challenge', 'synthesize', 'recommend', 'interpret Terra', 'interpret Search', 'interpret Memory'],
  mustNot: ['automatically inherit executor authority', 'treat recommendation as authorization', 'authorize itself'],
  knownViolationCandidates: [
    {
      path: 'app/api/chat/execute.ts → runLiveResearchRouter',
      issue: 'Council research intents may auto-run live retrieval without a separate ExplicitExecutionApproval ticket.',
      honesty: 'This is server-driven retrieval, not free tool-calling. Still a boundary tension for #22: auto-research vs tool authority envelope.',
    },
    {
      path: 'ASTRA execute → executeCouncilChatRequest',
      issue: 'One Commander execute can trigger scout swarm + live research.',
      honesty: 'Create ≠ execute; session gate exists; ExplicitExecutionApproval not wired on ASTRA path.',
    },
  ],
})

export const ASTRA_AUTHORITY_BOUNDARY = Object.freeze({
  mayCreate: 'planned missions with optional terraSeed (Commander session)',
  mayClaim: 'running lock from planned only',
  mayExecute: 'Council deliberation via executeCouncilChatRequest',
  mayDelegate: 'plan constellation / scout seats (plan-only today)',
  requiresApproval: 'Commander session for create+execute; no silent Terra→mission',
  onlySimulatedOrDeferred: 'constellation worker spawn; substantive ASTRA answers',
  runtimeTruth: [
    'PLANNED != RUNNING',
    'REGISTERED != IMPLEMENTED',
    'MISSION CREATED != ACTION AUTHORIZED',
    'SPAWN REQUEST != WORKER SPAWNED',
  ],
})

export const OWNERSHIP_MEMORY_BOUNDARY = Object.freeze({
  model: '#19 conversation ownership + memory write gates',
  rules: [
    'Service-role technical DB reach does not imply policy permission to cross user ownership.',
    'requireOwnedConversation must remain fail-closed on UUID-accepting routes.',
    'Commander-only data stays Commander-only.',
    'Session intelligence is conversation-scoped.',
    'Baby is separated from conversation ownership migration and must not bypass it.',
    'Memory proposals are not approved writes; ExplicitExecutionApproval cannot authorize memory writes.',
  ],
  evidencePaths: [
    'lib/war-room/conversationOwnership.ts',
    'lib/council/memory-write-gate/MemoryApprovalVerifier.ts',
    'lib/baby-ai/model.ts',
  ],
})

export const APPROVAL_MODEL = Object.freeze({
  principle: 'Reuse existing approval/audit models; do not create a parallel system unless necessary.',
  existingMechanisms: [
    'assertAutoOrApproval + approval_granted (lib/permissions/policy.ts)',
    'ExplicitExecutionApproval (single provider call)',
    'ExplicitMemoryWriteApproval',
    'CrawlApproval',
    'SovereignTokenizerExecutionApproval',
    'war_room_actions.approval_granted queue',
    'requireCommanderSession',
    'commanderConfirmed on destructive patches',
  ],
  proposedMinimumTypes: [
    'NO_APPROVAL',
    'POLICY_AUTO_ALLOWED',
    'SESSION_APPROVAL',
    'ONE_ACTION_APPROVAL',
    'COMMANDER_EXPLICIT_APPROVAL',
  ],
  tier4Rule: 'Never use blanket permanent authorization for Tier 4 actions by default.',
  gap: 'Several DANGEROUS_ACTION_KINDS exist in policy but are not wired as actionKind on all routes (payments use a parallel gate).',
})

export const AUDIT_MODEL = Object.freeze({
  existing: 'lib/war-room/auditLog.ts → war_room_audit_logs; ASTRA mission audit events; auto-mode ledger',
  desiredRecord: [
    'who',
    'what agent',
    'which tool',
    'which target',
    'what capability',
    'technical result',
    'policy decision',
    'approval decision',
    'timestamp',
    'evidence/provenance',
    'result',
    'failure',
    'rollback/reversal if applicable',
  ],
  recommendation: 'Extend metadata on insertWarRoomAuditLog for agent/tool/capability fields rather than a second audit table.',
})

export const DENIAL_BEHAVIOR = Object.freeze({
  states: [
    'NO_TECHNICAL_REACH',
    'POLICY_DENIED',
    'APPROVAL_REQUIRED',
    'APPROVAL_EXPIRED',
    'TARGET_OUT_OF_SCOPE',
    'UNAVAILABLE',
    'NOT_IMPLEMENTED',
    'DEGRADED',
  ],
  rules: [
    'Do not report a policy denial as a technical failure.',
    'Do not report missing implementation as permission denial.',
  ],
})

export const UI_RECOMMENDATION = Object.freeze({
  buildNow: false,
  reason: '#21 is evaluation/governance; UI not required for closeout.',
  futureSurface: 'AGENT CAPABILITY MATRIX',
  columns: [
    'Agent',
    'Domain',
    'Capability',
    'Technical Reach',
    'Authority',
    'Risk',
    'Approval',
    'Runtime Status',
  ],
  filters: ['agent', 'domain', 'risk', 'approval-required', 'live capability', 'unimplemented'],
  actions: ['inspect', 'request temporary approval', 'revoke approval', 'view audit'],
})

export const RED_TEAM_FINDINGS = Object.freeze([
  {
    id: 'service_role_bypass',
    severity: 'HIGH',
    finding: 'Service-role admin client bypasses RLS; any new UUID route without ownership checks reopens IDOR.',
    mitigation: 'Keep requireOwnedConversation fail-closed; treat service role as SYSTEM_INTERNAL technical reach, not policy allow.',
  },
  {
    id: 'council_auto_research',
    severity: 'MEDIUM',
    finding: 'Council research intents auto-invoke live research without ExplicitExecutionApproval.',
    mitigation: 'Document as bounded server retrieval; #22 should decide whether this maps to POLICY_AUTO_ALLOWED or SESSION_APPROVAL.',
  },
  {
    id: 'astra_execute_breadth',
    severity: 'MEDIUM',
    finding: 'ASTRA execute can fan out into scout swarm + live research; create≠execute but one click is broad.',
    mitigation: 'Preserve planned vs running; consider ONE_ACTION_APPROVAL envelope for swarm/live-research side effects.',
  },
  {
    id: 'dangerous_kinds_unwired',
    severity: 'MEDIUM',
    finding: 'financial/payment/deploy/commit/shell_mutating exist in DANGEROUS_ACTION_KINDS but are not all wired via assertAutoOrApproval.',
    mitigation: 'Do not treat catalog presence as enforcement; close wiring gaps before granting Ascension agents reach.',
  },
  {
    id: 'kernel_deploy_capability_label',
    severity: 'LOW',
    finding: 'Kernel routes deploy capability to codex_local with autonomousExecutionAllowed:false — label can be misread as deploy power.',
    mitigation: 'Runtime truth: status-only deploy tools; Commander-only for real deploy.',
  },
  {
    id: 'constellation_privilege_laundering',
    severity: 'LOW_CURRENT_HIGH_TARGET',
    finding: 'If #22 spawns workers without inheritance caps, agents could launder authority via children.',
    mitigation: 'child <= parent; no privilege amplification; no self-spawn of higher privilege.',
  },
  {
    id: 'recommendation_to_execution',
    severity: 'MEDIUM',
    finding: 'Memory proposal insertion from model text is a DB write of pending rows — not approved memory, but still mutation.',
    mitigation: 'Keep pending-only; never auto-approve; audit proposals.',
  },
  {
    id: 'absent_surfaces',
    severity: 'INFO',
    finding: 'No agent browser, Twilio, general email send, git commit/push, production deploy CLI, wager/trade, free-form SQL.',
    mitigation: 'Keep as NO_REACH / NOT_IMPLEMENTED — do not invent reach for Ascension.',
  },
])
