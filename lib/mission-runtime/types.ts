/**
 * War Room Mission Runtime — shared domain types (Phase 1: Engineering Mission only).
 *
 * Naming note: this repo already has two unrelated concepts named "Mission" —
 * `lib/missions/types.ts` (a static OKR/scoreboard record) and
 * `lib/opportunity-mission-bridge/types.ts` (a per-opportunity gig state machine). Neither models
 * an executable unit of Commander-directed work with providers/tools/approvals/completion, and
 * this module does not touch, rename, or merge either. Every exported type here is prefixed
 * `RuntimeMission*` specifically so it cannot be confused with `Mission` or `MissionRecord`
 * elsewhere in the codebase — see the Phase 0 audit (`claude/unified-mission-runtime-phase0-audit.md`
 * in the project) for the full reasoning.
 *
 * Architectural stance (Phase 1, reduced scope per Commander authorization):
 * - This module introduces ZERO new persistence. A RuntimeMission is a computed projection over
 *   lib/native-builder's own NativeIssueRecord/NativeRepairRecord (missionId === repairId) — the
 *   execution engine already persists everything a mission needs (state, history, proposals,
 *   validation results, diff evidence, rollback snapshots) via lib/native-builder/storage.ts.
 *   Introducing a second, parallel mission record (in Supabase or anywhere else) would create
 *   exactly the "duplicate truth" this project's engineering standard forbids. See
 *   engineeringStrategy.ts for the reasoning trail on why persistence-reuse-before-migration
 *   concluded "reuse fully, migrate nothing" rather than "migrate additively."
 * - ZERO new approval engine. Mission-level approval reuses lib/permissions/policy.ts's
 *   assertAutoOrApproval exactly as lib/native-builder's own API routes already do — the same
 *   dangerous-action gate, not a second one.
 * - ZERO new audit sink. Every native-builder state transition already writes to
 *   war_room_audit_logs under category 'repo' via lib/war-room/repoAudit.ts — a mission's audit
 *   trail is that repair's audit trail; this module adds no new writes.
 * - Council is untouched. Nothing here imports from app/page.tsx, components/council/*, or any
 *   lib/council/* Council-dispatch module. The one Council-adjacent import (see
 *   engineeringStrategy.ts) is lib/council/providerDirectCall.ts's per-vendor call functions,
 *   used only as a plain provider adapter — not the Council orchestration path.
 */

import type {
  NativeIssueRecord,
  NativeRepairRecord,
  NativeRepairState,
  NativeDiffEvidence,
  NativeValidationResult,
  NativeVerificationResult,
  NativeCouncilAssistComposition,
  NativeCouncilAssistSession,
} from '@/lib/native-builder/types'

// ---------------------------------------------------------------------------
// Mission Definition
// ---------------------------------------------------------------------------

/** Only one kind exists in Phase 1. The union is written this way (not a bare string literal) so
 * a second mission kind is additive later, not a breaking rename. */
export const RUNTIME_MISSION_KINDS = ['engineering'] as const
export type RuntimeMissionKind = (typeof RUNTIME_MISSION_KINDS)[number]

/** What the Commander actually asks for. Deliberately small — this is the minimal Mission
 * Definition the brief calls for, not a general task-description schema. */
export type EngineeringMissionRequest = {
  title: string
  description: string
  /** Repo-relative subsystem label or path — same shape native-builder's issueFromCommanderReport
   * already expects (see lib/native-builder/issueIngest.ts). */
  subsystem: string
  severity?: 'low' | 'medium' | 'high'
  /** Repo-relative files to inspect first. Passed straight through to native-builder's
   * planRepair({ targetFiles }) — no new inspection logic is introduced here. */
  targetFiles?: string[]
  /** Single-agent provider capability (Phase 1 proves exactly one provider family, never a
   * Council multi-family deliberation — that distinction IS the "single agent" execution
   * strategy). Defaults to disabled; the deterministic/local-model proposal path works without it. */
  singleAgentProvider?: {
    enabled: boolean
    family?: 'chatgpt' | 'claude' | 'grok' | 'gemini' | 'kimi'
  }
  /** Hosted-model coder proposal source (General-Purpose Coder Proposal Generation phase) — a
   * distinct concept from singleAgentProvider above: that one produces a short advisory opinion
   * BEFORE planning even starts and never becomes a patch; this one is the actual novel
   * structured-patch proposal source planRepair() selects from when no deterministic template
   * matches. Defaults to disabled; the deterministic/local-model proposal path works without it. */
  coderProvider?: {
    enabled: boolean
    family?: 'chatgpt' | 'claude' | 'grok' | 'gemini' | 'kimi'
  }
}

// ---------------------------------------------------------------------------
// Mission Policy — a thin, named binding to the existing permissions system, not new enforcement.
// ---------------------------------------------------------------------------

export type RuntimeMissionPolicy = {
  /** The single dangerous-action kind this mission's apply step is gated by. Reuses
   * lib/permissions/policy.ts's DANGEROUS_ACTION_KINDS verbatim — 'file_modification' is already
   * registered there and is exactly what native-builder's own /approve route gates on. */
  applyActionKind: 'file_modification'
  /** rollback is likewise an existing DANGEROUS_ACTION_KINDS entry, reused as-is. */
  rollbackActionKind: 'rollback'
  /** Explicit, permanent invariant carried forward from lib/native-builder — restated here so a
   * RuntimeMission consumer never has to go re-derive it. No code path in this module (or in
   * native-builder) ever calls git commit/push/merge/reset/rebase/checkout/clean. */
  commitCapable: false
}

export const ENGINEERING_MISSION_POLICY: RuntimeMissionPolicy = {
  applyActionKind: 'file_modification',
  rollbackActionKind: 'rollback',
  commitCapable: false,
}

// ---------------------------------------------------------------------------
// Capability declaration
// ---------------------------------------------------------------------------

export const RUNTIME_MISSION_CAPABILITIES = [
  'files_read',
  'search_read',
  'repo_status_read',
  'repo_diff_read',
  'provider_single_agent',
  'provider_coder_proposal',
  'council_assist',
  'patch_apply_gated',
  'validation_run',
  'rollback_gated',
] as const
export type RuntimeMissionCapability = (typeof RUNTIME_MISSION_CAPABILITIES)[number]

/** Declared once, per mission kind — a static fact about what the Engineering strategy can do,
 * not a permission grant (the actual gate is RuntimeMissionPolicy + assertAutoOrApproval). */
export const ENGINEERING_MISSION_CAPABILITIES: readonly RuntimeMissionCapability[] = [
  'files_read',
  'search_read',
  'repo_status_read',
  'repo_diff_read',
  'provider_single_agent',
  'provider_coder_proposal',
  'council_assist',
  'patch_apply_gated',
  'validation_run',
  'rollback_gated',
]

// ---------------------------------------------------------------------------
// Execution Strategy interface
// ---------------------------------------------------------------------------

/** Every mutating method mirrors an existing lib/native-builder/runtime.ts entrypoint 1:1 — this
 * interface exists so a future second execution strategy (e.g. wrapping Council) can be added
 * without changing any caller, not to add behavior native-builder doesn't already have. */
export interface MissionExecutionStrategy<TRequest> {
  readonly kind: RuntimeMissionKind
  readonly policy: RuntimeMissionPolicy
  readonly capabilities: readonly RuntimeMissionCapability[]
  create(request: TRequest): Promise<RuntimeMission>
  get(missionId: string): Promise<RuntimeMission | null>
  /** Applies the previously-planned patch. Callers MUST have already passed
   * lib/permissions/policy.ts's assertAutoOrApproval with policy.applyActionKind before calling
   * this — same discipline as lib/native-builder's own /approve route. This function itself also
   * requires approvalGranted, mirroring approveAndApply's own defense-in-depth check. */
  approve(missionId: string, approvalGranted: boolean): Promise<RuntimeMission>
  /** Commander's final accept/reject. Reject triggers rollback internally (same as
   * commanderResolve). */
  decide(missionId: string, accepted: boolean): Promise<RuntimeMission>
  /** Explicit rollback outside the accept/reject flow. Callers MUST have already passed
   * assertAutoOrApproval with policy.rollbackActionKind. */
  rollback(missionId: string): Promise<RuntimeMission>
  /** Optional — added in Phase D (War Room Engineering Mission UI) to back an "active missions"
   * list, the one capability neither Foundation Hardening nor Phase A needed. Optional so any
   * future strategy that genuinely cannot support listing (unlikely, but not this module's call to
   * foreclose) remains a valid implementer without a breaking interface change. Read-only, same
   * zero-new-persistence projection as get() — reuses storage.ts:listRepairs(), nothing new. */
  list?(): Promise<RuntimeMission[]>
  /** Optional — Phase E (Council Assist). Advisory-only; never mutates the repository, never
   * calls the apply path. See lib/native-builder/councilAssist.ts for the full reasoning. */
  councilAssist?(missionId: string, composition: NativeCouncilAssistComposition): Promise<RuntimeMission>
}

// ---------------------------------------------------------------------------
// Completion / result shape
// ---------------------------------------------------------------------------

export type RuntimeMissionStatus =
  | 'created'
  | 'inspecting'
  | 'proposed'
  | 'awaiting_approval'
  | 'applying'
  | 'validating'
  | 'awaiting_commander_decision'
  | 'completed'
  | 'rolled_back'
  | 'blocked'
  | 'cancelled'

/** One native-builder state maps to exactly one mission status — this is a pure lookup, never a
 * second source of truth for "what state is this in." */
export function missionStatusFromRepairState(state: NativeRepairState): RuntimeMissionStatus {
  switch (state) {
    case 'detected':
    case 'collecting_evidence':
      return 'created'
    case 'inspecting_repository':
    case 'planning':
      return 'inspecting'
    case 'awaiting_local_execution_approval':
      return 'awaiting_approval'
    case 'applying_patch':
      return 'applying'
    case 'validating':
      return 'validating'
    case 'verification_failed':
      return 'blocked'
    case 'partially_verified':
    case 'awaiting_commander_review':
      return 'awaiting_commander_decision'
    case 'resolved':
      return 'completed'
    case 'rolled_back':
      return 'rolled_back'
    case 'blocked':
      return 'blocked'
    case 'escalation_recommended':
      return 'blocked'
    case 'cancelled':
      return 'cancelled'
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

export type RuntimeMissionProviderOpinion = {
  family: string
  ok: boolean
  text: string
  error?: string
}

/** The read-only projection a caller actually gets back. Every field below is derived from the
 * underlying NativeIssueRecord/NativeRepairRecord at read time — nothing here is independently
 * persisted. */
export type RuntimeMission = {
  id: string
  kind: RuntimeMissionKind
  status: RuntimeMissionStatus
  title: string
  description: string
  policy: RuntimeMissionPolicy
  capabilities: readonly RuntimeMissionCapability[]
  createdAt: string
  updatedAt: string
  /** Native-builder identifiers this mission is a projection of — always present, always equal to
   * `id`/the underlying issue id, never a separately-generated mission id. Kept explicit so a
   * caller can cross-reference /api/native-builder/repairs/{repairId} directly if needed. */
  nativeBuilder: {
    issueId: string
    repairId: string
  }
  proposalSummary: {
    hasProposal: boolean
    sourceKind?: string
    diagnosis?: string
    relevantFiles?: string[]
  }
  providerOpinions: RuntimeMissionProviderOpinion[]
  /** Phase E — advisory-only Council Assist sessions attached to this mission. Never a source for
   * an executable patch; see lib/native-builder/councilAssist.ts. */
  councilAssistSessions: NativeCouncilAssistSession[]
  validationResults: NativeValidationResult[]
  verification?: NativeVerificationResult
  diff?: NativeDiffEvidence
  /** True once verification/commander-review land here — never true from a mere apply. */
  auditable: true
  raw: {
    issue: NativeIssueRecord
    repair: NativeRepairRecord
  }
}
