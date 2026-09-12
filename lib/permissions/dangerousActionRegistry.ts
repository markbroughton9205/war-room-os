/**
 * #22 Phase 1 — Canonical dangerous-action registry.
 * Extends existing DANGEROUS_ACTION_KINDS; does not invent a parallel policy system.
 * CAPABILITY != AUTHORITY: technical reach is recorded separately from default authority.
 */
import {
  DANGEROUS_ACTION_KINDS,
  isDangerousAction,
  type EffectiveStandingPolicy,
  getEffectivePolicy,
} from '@/lib/permissions/policy'
import type { StandingPermissionMode } from '@/lib/permissions/standingPermissions'
import type { PolicyAuthorityLevel, RiskTier, TechnicalReachLevel } from '@/lib/agent-capability-matrix/types'

/** Additional dangerous kinds required by #22 Phase 1 (aliases map to these). */
export const PHASE1_ADDITIONAL_DANGEROUS_KINDS = [
  'push',
  'policy_change',
  'trade',
  'wager',
  'settlement_submit',
  'agent_spawn',
] as const

export type Phase1AdditionalDangerousKind = (typeof PHASE1_ADDITIONAL_DANGEROUS_KINDS)[number]

export type CanonicalDangerousKind =
  | (typeof DANGEROUS_ACTION_KINDS)[number]
  | Phase1AdditionalDangerousKind

export const ALL_CANONICAL_DANGEROUS_KINDS: readonly CanonicalDangerousKind[] = Object.freeze([
  ...DANGEROUS_ACTION_KINDS,
  ...PHASE1_ADDITIONAL_DANGEROUS_KINDS,
])

const EXTRA_DANGEROUS = new Set<string>(PHASE1_ADDITIONAL_DANGEROUS_KINDS)

export function isCanonicalDangerousKind(actionKind: string): boolean {
  return isDangerousAction(actionKind) || EXTRA_DANGEROUS.has(actionKind)
}

/** Human / alias vocabulary → canonical kind (no duplicate concepts). */
export const DANGEROUS_KIND_ALIASES: Readonly<Record<string, CanonicalDangerousKind>> = Object.freeze({
  GIT_COMMIT: 'commit',
  GIT_PUSH: 'push',
  GIT_FORCE_PUSH: 'push',
  GIT_REBASE: 'shell_mutating',
  GIT_RESET_HARD: 'shell_mutating',
  GIT_CLEAN: 'shell_mutating',
  PRODUCTION_DEPLOY: 'deploy',
  PRODUCTION_RESTART: 'deploy',
  PROCESS_TERMINATE: 'shell_mutating',
  ARBITRARY_SHELL: 'shell_mutating',
  ARBITRARY_POWERSHELL: 'shell_mutating',
  SHELL_EXECUTE: 'shell_mutating',
  POWERSHELL_EXECUTE: 'shell_mutating',
  FILESYSTEM_DELETE: 'delete_data',
  FILESYSTEM_WRITE_SENSITIVE: 'file_modification',
  DATABASE_WRITE: 'delete_data',
  DATABASE_ARBITRARY_WRITE: 'delete_data',
  DATABASE_SCHEMA_CHANGE: 'delete_data',
  SQL_EXECUTE: 'delete_data',
  EXTERNAL_MUTATION: 'external_account',
  MESSAGE_SEND: 'email_send',
  PHONE_OUTBOUND: 'email_send',
  CRAWL_EXPANSION: 'external_account',
  FINANCIAL_SPEND: 'financial',
  FINANCIAL_TRANSFER: 'financial',
  TRADE: 'trade',
  WAGER: 'wager',
  SETTLEMENT_SUBMIT: 'settlement_submit',
  AGENT_SPAWN: 'agent_spawn',
  POLICY_CHANGE: 'policy_change',
  APPROVAL_CHANGE: 'policy_change',
  SECRET_CHANGE: 'secrets_change',
  ENVIRONMENT_CHANGE: 'secrets_change',
  ENV_CHANGE: 'secrets_change',
  CREDENTIAL_EXFILTRATION: 'secrets_change',
  SQL_MUTATION: 'delete_data',
  DATABASE_DESTRUCTIVE_WRITE: 'delete_data',
  SCHEMA_CHANGE: 'delete_data',
  MALWARE_PERSISTENCE: 'shell_mutating',
  HOST_PRIVILEGE_ESCALATION: 'shell_mutating',
  EXTERNAL_EXPLOITATION: 'external_account',
  PROCESS_RESTART: 'shell_mutating',
  SERVICE_STOP: 'shell_mutating',
  SERVICE_START: 'shell_mutating',
  SERVICE_RESTART: 'shell_mutating',
  PRODUCTION_ROLLBACK: 'deploy',
  DEV_RESTART: 'shell_mutating',
  WATCHDOG_CHANGE: 'shell_mutating',
  TASK_SCHEDULER_CHANGE: 'shell_mutating',
  CLOUDFLARE_CHANGE: 'deploy',
  DNS_CHANGE: 'deploy',
  OLLAMA_CONFIG_CHANGE: 'shell_mutating',
  FILESYSTEM_DESTRUCTIVE_WRITE: 'delete_data',
  FINANCIAL_ACTION: 'financial',
  AUTHORIZE_ACTION: 'policy_change',
  CREATE_GOVERNED_APPROVAL: 'policy_change',
  SOURCE_APPROVAL: 'policy_change',
  DEVICE_CONTROL: 'shell_mutating',
  NAVIGATION_CONTROL: 'shell_mutating',
  VEHICLE_CONTROL: 'shell_mutating',
  MISSION_EXECUTION: 'agent_spawn',
})

export function resolveCanonicalDangerousKind(kindOrAlias: string): CanonicalDangerousKind | null {
  if (isCanonicalDangerousKind(kindOrAlias)) return kindOrAlias as CanonicalDangerousKind
  const upper = kindOrAlias.toUpperCase()
  if (upper in DANGEROUS_KIND_ALIASES) return DANGEROUS_KIND_ALIASES[upper]!
  return null
}

export type DangerousActionRule = {
  kind: CanonicalDangerousKind
  riskTier: RiskTier
  defaultAuthority: PolicyAuthorityLevel
  /** Always true for Tier 4 / dangerous kinds. */
  requiresApproval: true
  requiresAudit: true
  /** Commander-only for Tier 4 governed actions. */
  commanderOnly: boolean
  /** How this kind is enforced today. */
  enforcement:
    | 'ASSERT_AUTO_OR_APPROVAL'
    | 'PARALLEL_GATE_DOCUMENTED'
    | 'STRUCTURAL_NO_REACH'
    | 'COMMANDER_SESSION_PLUS_DANGEROUS'
    | 'NOT_IMPLEMENTED_FAIL_CLOSED'
  evidence: string
  technicalReachToday: TechnicalReachLevel
}

export const DANGEROUS_ACTION_RULES: Readonly<Record<CanonicalDangerousKind, DangerousActionRule>> = Object.freeze({
  file_modification: {
    kind: 'file_modification',
    riskTier: 'TIER_2_PERSISTENT_INTERNAL_MUTATION',
    defaultAuthority: 'APPROVAL_REQUIRED',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: false,
    enforcement: 'ASSERT_AUTO_OR_APPROVAL',
    evidence: 'native-builder / mission-runtime approve routes',
    technicalReachToday: 'WRITE_BOUNDED',
  },
  shell_mutating: {
    kind: 'shell_mutating',
    riskTier: 'TIER_3_EXTERNAL_REMOTE_MUTATION',
    defaultAuthority: 'DENIED',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'STRUCTURAL_NO_REACH',
    evidence: 'validationRunner fixed argv only; free-form shell forbidden',
    technicalReachToday: 'EXECUTE_SANDBOXED',
  },
  commit: {
    kind: 'commit',
    riskTier: 'TIER_3_EXTERNAL_REMOTE_MUTATION',
    defaultAuthority: 'COMMANDER_ONLY',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'STRUCTURAL_NO_REACH',
    evidence: 'commitPreparation plans only; git_commit not registered',
    technicalReachToday: 'DISCOVER_ONLY',
  },
  push: {
    kind: 'push',
    riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
    defaultAuthority: 'COMMANDER_ONLY',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'STRUCTURAL_NO_REACH',
    evidence: 'git_push not a registered operation; Commander/human only',
    technicalReachToday: 'DISCOVER_ONLY',
  },
  deploy: {
    kind: 'deploy',
    riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
    defaultAuthority: 'COMMANDER_ONLY',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'STRUCTURAL_NO_REACH',
    evidence: 'deploy status-only APIs; no agent deploy executor',
    technicalReachToday: 'DISCOVER_ONLY',
  },
  rollback: {
    kind: 'rollback',
    riskTier: 'TIER_2_PERSISTENT_INTERNAL_MUTATION',
    defaultAuthority: 'APPROVAL_REQUIRED',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: false,
    enforcement: 'ASSERT_AUTO_OR_APPROVAL',
    evidence: 'native-builder / mission-runtime rollback routes',
    technicalReachToday: 'WRITE_BOUNDED',
  },
  delete_data: {
    kind: 'delete_data',
    riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
    defaultAuthority: 'COMMANDER_ONLY',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'STRUCTURAL_NO_REACH',
    evidence: 'No free-form SQL/delete API; patch deletes require commanderConfirmed under file_modification',
    technicalReachToday: 'NO_REACH',
  },
  email_send: {
    kind: 'email_send',
    riskTier: 'TIER_3_EXTERNAL_REMOTE_MUTATION',
    defaultAuthority: 'DENIED',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'PARALLEL_GATE_DOCUMENTED',
    evidence: 'Auth confirmation / signup invite only; general email send NOT_IMPLEMENTED',
    technicalReachToday: 'NO_REACH',
  },
  financial: {
    kind: 'financial',
    riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
    defaultAuthority: 'COMMANDER_ONLY',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'PARALLEL_GATE_DOCUMENTED',
    evidence: 'Deposit ledger visibility; outbound spend structurally absent; parallel live+action gates',
    technicalReachToday: 'NO_REACH',
  },
  payment: {
    kind: 'payment',
    riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
    defaultAuthority: 'COMMANDER_ONLY',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'PARALLEL_GATE_DOCUMENTED',
    evidence: 'app/api/payments/* uses assertLiveActionsAllowed + assertActionRouteAuthorized',
    technicalReachToday: 'WRITE_BOUNDED',
  },
  subscription: {
    kind: 'subscription',
    riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
    defaultAuthority: 'COMMANDER_ONLY',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'NOT_IMPLEMENTED_FAIL_CLOSED',
    evidence: 'No subscription mutation agent route',
    technicalReachToday: 'NO_REACH',
  },
  secrets_change: {
    kind: 'secrets_change',
    riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
    defaultAuthority: 'COMMANDER_ONLY',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'COMMANDER_SESSION_PLUS_DANGEROUS',
    evidence: 'No .env writer; permissions/update gated as policy_change',
    technicalReachToday: 'NO_REACH',
  },
  external_account: {
    kind: 'external_account',
    riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
    defaultAuthority: 'COMMANDER_ONLY',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'NOT_IMPLEMENTED_FAIL_CLOSED',
    evidence: 'No external account mutation tool',
    technicalReachToday: 'NO_REACH',
  },
  policy_change: {
    kind: 'policy_change',
    riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
    defaultAuthority: 'COMMANDER_ONLY',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'COMMANDER_SESSION_PLUS_DANGEROUS',
    evidence: 'POST /api/permissions/update',
    technicalReachToday: 'WRITE_BOUNDED',
  },
  trade: {
    kind: 'trade',
    riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
    defaultAuthority: 'DENIED',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'NOT_IMPLEMENTED_FAIL_CLOSED',
    evidence: 'No trade route',
    technicalReachToday: 'NO_REACH',
  },
  wager: {
    kind: 'wager',
    riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
    defaultAuthority: 'DENIED',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'NOT_IMPLEMENTED_FAIL_CLOSED',
    evidence: 'No wager route',
    technicalReachToday: 'NO_REACH',
  },
  settlement_submit: {
    kind: 'settlement_submit',
    riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
    defaultAuthority: 'COMMANDER_ONLY',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'NOT_IMPLEMENTED_FAIL_CLOSED',
    evidence: 'Settlement intelligence is analysis-only',
    technicalReachToday: 'NO_REACH',
  },
  agent_spawn: {
    kind: 'agent_spawn',
    riskTier: 'TIER_3_EXTERNAL_REMOTE_MUTATION',
    defaultAuthority: 'DENIED',
    requiresApproval: true,
    requiresAudit: true,
    commanderOnly: true,
    enforcement: 'STRUCTURAL_NO_REACH',
    evidence: 'constellationSpawned:false; Ascension autonomy OFF',
    technicalReachToday: 'DISCOVER_ONLY',
  },
})

export function getDangerousActionRule(kindOrAlias: string): DangerousActionRule | null {
  const kind = resolveCanonicalDangerousKind(kindOrAlias)
  if (!kind) return null
  return DANGEROUS_ACTION_RULES[kind]
}

/** Dangerous kinds never auto-allow, including Phase 1 additions. */
export function getEffectiveDangerousPolicy(
  mode: StandingPermissionMode,
  actionKind: string,
): EffectiveStandingPolicy {
  if (isCanonicalDangerousKind(actionKind)) {
    return {
      autoAllowed: false,
      requiresApproval: true,
      reason: 'Dangerous actions are never auto-allowed and always require explicit human approval.',
    }
  }
  return getEffectivePolicy(mode, actionKind)
}

export function everyDangerousKindHasRule(): boolean {
  return ALL_CANONICAL_DANGEROUS_KINDS.every(kind => Boolean(DANGEROUS_ACTION_RULES[kind]))
}

export function everyTier4RequiresCommander(): boolean {
  return ALL_CANONICAL_DANGEROUS_KINDS
    .map(kind => DANGEROUS_ACTION_RULES[kind])
    .filter(rule => rule.riskTier === 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL')
    .every(rule => rule.commanderOnly && rule.requiresApproval)
}
