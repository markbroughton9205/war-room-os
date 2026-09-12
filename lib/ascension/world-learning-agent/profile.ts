/**
 * #22 Phase 13 — WORLD_LEARNING_AGENT capability profile.
 * Bounded world-knowledge acquisition. Discovery remains RESEARCH_AGENT.
 * Curation remains DATA_CORPUS_AGENT. No training / #23 / execution.
 */
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { assertNoSelfApproval, assertChildDoesNotExceedParent } from '@/lib/permissions/noSelfEscalation'

export const WORLD_LEARNING_AGENT_ALLOWED_OPERATIONS = [
  'LEARN_TOPIC',
  'COMPARE_SOURCES',
  'UPDATE_KNOWLEDGE',
  'VERIFY_CLAIM',
  'BUILD_TOPIC_MAP',
  'EXTRACT_ENTITIES',
  'EXTRACT_RELATIONSHIPS',
  'IDENTIFY_CONFLICTS',
  'IDENTIFY_KNOWLEDGE_GAPS',
  'EVALUATE_SOURCE',
  'RECOMMEND_CORPUS_ENTRY',
  'INVOKE_RESEARCH_AGENT',
  'CONSUME_SEARCH_EVIDENCE',
  'CONSUME_TERRA_CONTEXT',
  'HANDOFF_DATA_CORPUS',
  'INVOKE_COUNCIL_VALIDATOR',
  'LOCAL_MODEL_SYNTHESIZE',
  'INTERNAL_AUDIT_WRITE',
] as const

export type WorldLearningAgentAllowedOperation = (typeof WORLD_LEARNING_AGENT_ALLOWED_OPERATIONS)[number]

export const WORLD_LEARNING_AGENT_TASK_TYPES = [
  'LEARN_TOPIC',
  'COMPARE_SOURCES',
  'UPDATE_KNOWLEDGE',
  'VERIFY_CLAIM',
  'BUILD_TOPIC_MAP',
  'EXTRACT_ENTITIES',
  'EXTRACT_RELATIONSHIPS',
  'IDENTIFY_CONFLICTS',
  'IDENTIFY_KNOWLEDGE_GAPS',
  'EVALUATE_SOURCE',
  'RECOMMEND_CORPUS_ENTRY',
] as const

export type WorldLearningAgentTaskType = (typeof WORLD_LEARNING_AGENT_TASK_TYPES)[number]

export const WORLD_LEARNING_AGENT_DENIED_ALIASES = [
  'GIT_COMMIT',
  'GIT_PUSH',
  'PRODUCTION_DEPLOY',
  'PRODUCTION_RESTART',
  'PROCESS_TERMINATE',
  'SHELL_EXECUTE',
  'POWERSHELL_EXECUTE',
  'SQL_EXECUTE',
  'DATABASE_SCHEMA_CHANGE',
  'DATABASE_ARBITRARY_WRITE',
  'POLICY_CHANGE',
  'APPROVAL_CHANGE',
  'AGENT_SPAWN',
  'SECRET_CHANGE',
  'FILESYSTEM_DELETE',
  'FILESYSTEM_SENSITIVE_WRITE',
  'EXTERNAL_MUTATION',
  'MESSAGE_SEND',
  'PHONE_OUTBOUND',
  'FINANCIAL_SPEND',
  'FINANCIAL_TRANSFER',
  'TRADE',
  'WAGER',
  'SETTLEMENT_SUBMIT',
  'CRAWL_EXPANSION',
  'INTERNET_BULK_INGEST',
  'UNAUTHORIZED_DATASET',
  'MODEL_TRAINING',
  'TOKENIZER_TRAINING',
  'WEIGHT_MUTATION',
  'WR_CORPUS_START',
  'WR_TOKENIZER_START',
  'WRIM_TRAIN',
  'RAEL_CREATE',
  'ROADMAP_23_START',
  'PRODUCTION_CORPUS_PERSIST',
  'APPLY_CORPUS_WITHOUT_REVIEW',
  'PROMOTE_PRIVATE_TO_WORLD',
  'INGEST_CREDENTIALS',
  'MARK_MODEL_AS_EVIDENCE',
  'MARK_STALE_AS_LIVE',
  'IGNORE_CONTRADICTIONS',
  'EXECUTE_FRAUD',
  'DEPLOY_MALWARE',
  'BUILD_WEAPON',
  'OPERATIONAL_EXECUTION',
  'RECURSIVE_MISSION',
  'UNLIMITED_FOLLOW_UP',
  'PHONE_APP_BUILD',
  'MISSION_EXECUTION',
] as const

const ROLE = 'WORLD_LEARNING_AGENT'

export function denyWorldLearningAgentAction(
  actionKindOrAlias: string,
  requestingActorId = ROLE,
): PolicyDecision {
  const decision = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: true,
    actionKind: actionKindOrAlias,
    body: {},
    commanderSessionOk: false,
    requestingActorId,
    approvingActorId: requestingActorId,
  })
  if (decision.outcome === 'ALLOW') {
    return {
      ...decision,
      outcome: 'DENY',
      reasonCode: 'POLICY_DENIED',
      reason: `WORLD_LEARNING_AGENT cannot perform ${actionKindOrAlias}.`,
      httpStatus: 403,
      approvalSatisfied: false,
    }
  }
  return decision
}

export function assertWorldLearningAgentCannotSelfApprove(): PolicyDecision {
  return (
    assertNoSelfApproval('WORLD_LEARNING_AGENT', 'WORLD_LEARNING_AGENT') ?? {
      outcome: 'DENY',
      reasonCode: 'SELF_ESCALATION_DENIED',
      reason: 'WORLD_LEARNING_AGENT cannot approve itself.',
      actionKind: 'approval',
      canonicalKind: null,
      riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
      technicalReach: 'DISCOVER_ONLY',
      policyAuthority: 'DENIED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  )
}

export function assertWorldLearningAgentChildDoesNotExceedParent(): PolicyDecision {
  return (
    assertChildDoesNotExceedParent({
      parentReach: 'READ_ONLY',
      childReach: 'FULL_TECHNICAL_REACH',
      parentAuthority: 'READ_ALLOWED',
      childAuthority: 'COMMANDER_ONLY',
    }) ?? {
      outcome: 'DENY',
      reasonCode: 'CHILD_AUTHORITY_EXCEEDS_PARENT',
      reason: 'WORLD_LEARNING_AGENT privilege amplification denied.',
      actionKind: 'agent_spawn',
      canonicalKind: 'agent_spawn',
      riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
      technicalReach: 'DISCOVER_ONLY',
      policyAuthority: 'DENIED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  )
}

export function isAllowedWorldLearningAgentOperation(c: string): boolean {
  return (WORLD_LEARNING_AGENT_ALLOWED_OPERATIONS as readonly string[]).includes(c)
}

export function isAllowedWorldLearningAgentTaskType(c: string): c is WorldLearningAgentTaskType {
  return (WORLD_LEARNING_AGENT_TASK_TYPES as readonly string[]).includes(c)
}
