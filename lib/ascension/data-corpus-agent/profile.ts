/**
 * #22 Phase 8 — DATA_CORPUS_AGENT capability profile.
 * Curation ≠ training. Indexing ≠ model learning. No crawl authority.
 */
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { assertNoSelfApproval, assertChildDoesNotExceedParent } from '@/lib/permissions/noSelfEscalation'

export const DATA_CORPUS_ALLOWED_OPERATIONS = [
  'CORPUS_READ',
  'LOCAL_INDEX_METADATA_READ',
  'STORED_RESEARCH_READ',
  'EVIDENCE_PACKET_READ',
  'PROVENANCE_READ',
  'FRESHNESS_READ',
  'DEDUPE_CLASSIFY',
  'QUALITY_CLASSIFY',
  'NORMALIZE_METADATA',
  'RETRIEVAL_SUITABILITY_CLASSIFY',
  'WR_CORPUS_SUITABILITY_RECOMMEND',
  'BOUNDED_METADATA_ANNOTATE',
  'BOUNDED_INDEX_SUPPORT_ANNOTATE',
  'INTERNAL_AUDIT_WRITE',
] as const

export type DataCorpusAllowedOperation = (typeof DATA_CORPUS_ALLOWED_OPERATIONS)[number]

export const DATA_CORPUS_DENIED_ALIASES = [
  'CRAWL_EXPANSION',
  'SOURCE_APPROVAL',
  'INTERNET_BULK_INGEST',
  'PERSISTENT_RECRAWL',
  'MODEL_TRAINING',
  'TOKENIZER_TRAINING',
  'WEIGHT_UPDATE',
  'WRIM_BUILD',
  'RAEL_TRAINING',
  'GIT_COMMIT',
  'GIT_PUSH',
  'PRODUCTION_DEPLOY',
  'PRODUCTION_RESTART',
  'SHELL_EXECUTE',
  'POWERSHELL_EXECUTE',
  'ARBITRARY_SHELL',
  'ARBITRARY_POWERSHELL',
  'SQL_EXECUTE',
  'SQL_ARBITRARY_EXECUTE',
  'DATABASE_SCHEMA_CHANGE',
  'POLICY_CHANGE',
  'APPROVAL_CHANGE',
  'AGENT_SPAWN',
  'SECRET_CHANGE',
  'MESSAGE_SEND',
  'PHONE_OUTBOUND',
  'FINANCIAL_SPEND',
  'FINANCIAL_TRANSFER',
  'TRADE',
  'WAGER',
  'SETTLEMENT_SUBMIT',
  'AUTO_DELETE',
  'MASS_REINDEX',
  'CHANGE_EMBEDDING_MODEL',
  'CHANGE_SEMANTIC_THRESHOLD',
] as const

const ROLE = 'DATA_CORPUS_AGENT'

export function denyDataCorpusAgentAction(
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
      reason: `DATA_CORPUS_AGENT cannot perform ${actionKindOrAlias}.`,
      httpStatus: 403,
      approvalSatisfied: false,
    }
  }
  return decision
}

export function assertDataCorpusAgentCannotSelfApprove(): PolicyDecision {
  return (
    assertNoSelfApproval('DATA_CORPUS_AGENT', 'DATA_CORPUS_AGENT') ?? {
      outcome: 'DENY',
      reasonCode: 'SELF_ESCALATION_DENIED',
      reason: 'DATA_CORPUS_AGENT cannot approve itself.',
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

export function assertDataCorpusChildDoesNotExceedParent(): PolicyDecision {
  return (
    assertChildDoesNotExceedParent({
      parentReach: 'READ_ONLY',
      childReach: 'FULL_TECHNICAL_REACH',
      parentAuthority: 'READ_ALLOWED',
      childAuthority: 'COMMANDER_ONLY',
    }) ?? {
      outcome: 'DENY',
      reasonCode: 'CHILD_AUTHORITY_EXCEEDS_PARENT',
      reason: 'DATA_CORPUS_AGENT privilege amplification denied.',
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

export function isAllowedDataCorpusOperation(c: string): boolean {
  return (DATA_CORPUS_ALLOWED_OPERATIONS as readonly string[]).includes(c)
}
