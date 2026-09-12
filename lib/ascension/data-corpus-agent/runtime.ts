/**
 * #22 Phase 8 — Bounded DATA_CORPUS_AGENT runtime.
 * Corpus curation only. No crawl / training / #23. Ascension autonomy OFF.
 */
import { randomUUID } from 'node:crypto'
import { buildGovernedAuditMetadata, insertGovernedAuditLog } from '@/lib/war-room/governedAudit'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import {
  createDataCorpusAgentIdentity,
  isDataCorpusAgentRuntimeAvailable,
  DATA_CORPUS_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  ROADMAP_23_STATUS,
} from './identity'
import { assertDataCorpusAgentCannotSelfApprove, denyDataCorpusAgentAction } from './profile'
import {
  createDataCorpusScope,
  isDataCorpusScopeExpired,
  type DataCorpusScope,
} from './scope'
import {
  DATA_CORPUS_BOUNDARY_NOTES,
  type DataCorpusDenial,
  type DataCorpusResult,
  type CorpusDocumentFinding,
  type CorpusDuplicateGroup,
  type DataCorpusWriteRecord,
  type RetrievalSuitability,
  type WrCorpusSuitability,
} from './result'
import { assertBabyDataCorpusDenied, assertDataCorpusOwnerScopeMatch } from './ownership'
import { analyzeCorpus, type CorpusRecordInput } from './analyze'
import { ascensionAutonomyIsOff } from '@/lib/ascension/operationalRegistry'

export type RunBoundedDataCorpusInput = {
  corpusQuestion: string
  ownerUserId: string
  requestedBy: string
  invokedBy: 'commander' | 'council' | 'astra'
  datasetScope?: string
  sourceScope?: string[] | null
  documentIds?: string[] | null
  records?: CorpusRecordInput[]
  useFixtures?: boolean
  allowMetadataWrite?: boolean
  allowIndexSupportWrite?: boolean
  missionId?: string | null
  conversationId?: string | null
  conversationOwnerUserId?: string | null
  enforceOwnership?: boolean
  babyContextAttempt?: boolean
  attemptedAction?: string | null
  promotePrivateToShared?: boolean
  autoDeleteDuplicates?: boolean
  startRoadmap23?: boolean
  researchHandoff?: { summary?: string } | null
  terraLiveHandoff?: { summary?: string } | null
  validatorFinding?: { summary?: string } | null
  securityFinding?: { summary?: string } | null
  operationsHandoff?: { summary?: string } | null
  recommendEngineering?: boolean
  changeEmbeddingModel?: boolean
  changeSemanticThreshold?: boolean
  massReindex?: boolean
  supabase?: WarRoomSupabase | null
  nowIso?: string
}

export async function runBoundedDataCorpusAgent(
  input: RunBoundedDataCorpusInput,
): Promise<DataCorpusResult> {
  const startedAt = input.nowIso ?? new Date().toISOString()
  const requestId = randomUUID()
  const denials: DataCorpusDenial[] = []
  const limitations: string[] = []
  const unavailable: string[] = []
  let auditId: string | null = null
  let findings: CorpusDocumentFinding[] = []
  let duplicate_groups: CorpusDuplicateGroup[] = []
  let provenance_gaps: string[] = []
  let license_gaps: string[] = []
  let stale_records: string[] = []
  let conflicts: string[] = []
  let retrieval_suitability: Array<{ document_id: string; suitability: RetrievalSuitability }> = []
  let wr_corpus_candidates: Array<{
    document_id: string
    suitability: WrCorpusSuitability
    recommendation_only: true
  }> = []
  let wr_corpus_exclusions: string[] = []
  let review_required: string[] = []
  let writes_performed: DataCorpusWriteRecord[] = []
  let documents_examined = 0
  let chunks_examined = 0
  let quality_summary = ''

  const emptyScope = (): DataCorpusScope =>
    createDataCorpusScope({
      corpusQuestion: input.corpusQuestion || '(none)',
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      datasetScope: input.datasetScope ?? 'fixture_bounded',
      nowIso: startedAt,
    })

  const finish = async (
    status: DataCorpusResult['status'],
    scope: DataCorpusScope,
    summary: string,
  ): Promise<DataCorpusResult> => {
    const identity = createDataCorpusAgentIdentity({
      requestId,
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      allowedOperations: scope.allowed_operations,
      datasetScope: scope.dataset_scope,
      sourceScope: scope.source_scope,
      missionId: input.missionId,
      conversationId: input.conversationId,
      expiresAt: scope.expires_at,
      nowIso: startedAt,
    })

    const result: DataCorpusResult = {
      agent_id: identity.agent_id,
      agent_role: 'DATA_CORPUS_AGENT',
      status,
      corpus_question: scope.corpus_question,
      scope,
      documents_examined,
      chunks_examined,
      quality_summary: quality_summary || summary,
      duplicate_groups,
      provenance_gaps,
      license_gaps,
      stale_records,
      conflicts,
      retrieval_suitability,
      wr_corpus_candidates,
      wr_corpus_exclusions,
      review_required,
      writes_performed,
      denials,
      limitations: [
        ...limitations,
        'NO CRAWL AUTHORITY',
        'NO TRAINING AUTHORITY',
        'INVOCATION_DRIVEN',
        'CORPUS_CURATION only',
        `roadmap_23=${ROADMAP_23_STATUS}`,
      ],
      unavailable_capabilities: unavailable,
      audit_id: auditId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      owner_scope: input.ownerUserId,
      mission_id: input.missionId ?? null,
      conversation_id: input.conversationId ?? null,
      identity,
      boundary_notes: DATA_CORPUS_BOUNDARY_NOTES,
      plan_summary: 'READ → INSPECT → CLASSIFY → DEDUPE → RECOMMEND (NO CRAWL / NO TRAIN / NO DELETE)',
      document_findings: findings,
      search_stage4_unchanged: true,
      embedding_model_unchanged: true,
      chunk_version_unchanged: true,
      roadmap_23_status: ROADMAP_23_STATUS,
      crawl_authority: 'DENIED',
      training_authority: 'DENIED',
    }

    try {
      const decision: PolicyDecision =
        status === 'DENIED'
          ? {
              outcome: 'DENY',
              reasonCode: 'POLICY_DENIED',
              reason: denials[0]?.reason ?? 'Data corpus agent denied.',
              actionKind: 'corpus_curation',
              canonicalKind: null,
              riskTier: 'TIER_0_READ_OBSERVE',
              technicalReach: 'READ_ONLY',
              policyAuthority: 'READ_ALLOWED',
              requiresApproval: false,
              approvalSatisfied: true,
              httpStatus: 403,
            }
          : {
              outcome: 'ALLOW',
              reasonCode: 'ALLOWED_BOUNDED_READ',
              reason: 'Bounded corpus curation analysis.',
              actionKind: 'corpus_curation',
              canonicalKind: null,
              riskTier: 'TIER_0_READ_OBSERVE',
              technicalReach: 'READ_ONLY',
              policyAuthority: 'READ_ALLOWED',
              requiresApproval: false,
              approvalSatisfied: true,
              httpStatus: 200,
            }

      const meta = buildGovernedAuditMetadata({
        decision,
        requestedBy: input.requestedBy,
        actorAgent: 'DATA_CORPUS_AGENT',
        missionId: input.missionId ?? null,
        tool: 'ascension.data_corpus_agent.runBoundedDataCorpusAgent',
        target: scope.corpus_question.slice(0, 200),
        ownerUserId: input.ownerUserId,
        evidenceRefs: findings.map(f => f.document_id).slice(0, 20),
        executionResult:
          status === 'DENIED' ? 'denied' : status === 'FAILED' ? 'failed' : 'executed',
      })

      await insertGovernedAuditLog(input.supabase ?? null, {
        actor: input.invokedBy === 'commander' ? 'user' : 'system',
        category: 'runtime',
        message: `DATA_CORPUS_AGENT ${status}: ${scope.corpus_question.slice(0, 200)}`,
        actionId: requestId,
        metadata: meta,
        extra: {
          invocation: input.invokedBy,
          status,
          dataset_scope: scope.dataset_scope,
          source_scope: scope.source_scope,
          documents_examined,
          chunks_examined,
          writes_performed,
          provenance_gaps,
          license_gaps,
          duplicate_groups: duplicate_groups.map(g => ({
            group_id: g.group_id,
            dedupe_state: g.dedupe_state,
            auto_deleted: false,
          })),
          ownership_classifications: findings.map(f => ({
            document_id: f.document_id,
            ownership_scope: f.ownership_scope,
          })),
          policy_decisions: denials,
          roadmap_23_status: ROADMAP_23_STATUS,
          chain_of_thought: undefined,
          secrets: undefined,
        },
      })
      auditId = requestId
      result.audit_id = auditId
    } catch {
      limitations.push('Audit persistence unavailable.')
      if (status === 'COMPLETE') result.status = 'PARTIAL'
    }

    return result
  }

  if (!isDataCorpusAgentRuntimeAvailable()) {
    denials.push({
      capability_or_action: 'RUNTIME',
      reason_code: 'UNAVAILABLE',
      reason: 'DATA_CORPUS_AGENT disabled via ASCENSION_DATA_CORPUS_AGENT_ENABLED=false.',
    })
    return finish('DENIED', emptyScope(), 'Runtime disabled.')
  }

  if (!ascensionAutonomyIsOff() || DATA_CORPUS_AGENT_AUTONOMOUS_EXECUTION_ENABLED) {
    denials.push({
      capability_or_action: 'ASCENSION_AUTONOMY',
      reason_code: 'POLICY_DENIED',
      reason: 'Ascension autonomy must remain OFF.',
    })
    return finish('DENIED', emptyScope(), 'Autonomy guard failed.')
  }

  if (!input.corpusQuestion?.trim()) {
    denials.push({
      capability_or_action: 'SCOPE',
      reason_code: 'TARGET_OUT_OF_SCOPE',
      reason: 'corpus_question is required — no unbounded forever scan.',
    })
    return finish('DENIED', emptyScope(), 'Missing corpus_question.')
  }

  if (input.attemptedAction) {
    const d = denyDataCorpusAgentAction(input.attemptedAction)
    denials.push({
      capability_or_action: input.attemptedAction,
      reason_code: d.reasonCode,
      reason: d.reason,
    })
  }

  const self = assertDataCorpusAgentCannotSelfApprove()
  if (input.attemptedAction === 'self_approve' || input.attemptedAction === 'APPROVAL_CHANGE') {
    denials.push({
      capability_or_action: 'APPROVAL_CHANGE',
      reason_code: self.reasonCode,
      reason: self.reason,
    })
  }

  if (input.babyContextAttempt) {
    const baby = assertBabyDataCorpusDenied()
    denials.push({
      capability_or_action: 'BABY_CORPUS_CONTEXT',
      reason_code: 'POLICY_DENIED',
      reason: baby.reason,
    })
  }

  if (input.changeEmbeddingModel) {
    denials.push({
      capability_or_action: 'CHANGE_EMBEDDING_MODEL',
      reason_code: 'POLICY_DENIED',
      reason: 'Embedding model is frozen — Search Stage 4 unchanged.',
    })
  }
  if (input.changeSemanticThreshold) {
    denials.push({
      capability_or_action: 'CHANGE_SEMANTIC_THRESHOLD',
      reason_code: 'POLICY_DENIED',
      reason: 'Semantic threshold is frozen — Search Stage 4 unchanged.',
    })
  }
  if (input.massReindex) {
    denials.push({
      capability_or_action: 'MASS_REINDEX',
      reason_code: 'POLICY_DENIED',
      reason: 'Mass reindex / background corpus daemon denied.',
    })
  }
  if (input.startRoadmap23) {
    denials.push({
      capability_or_action: 'ROADMAP_23',
      reason_code: 'POLICY_DENIED',
      reason: '#23 WR-CORPUS is ACTIVE. Candidate classification remains recommendation only; promotion is Commander-governed. Tokenizer/WRIM/Ra\'el remain not started.',
    })
  }

  if (input.researchHandoff?.summary) {
    limitations.push(`Research handoff advisory: ${input.researchHandoff.summary.slice(0, 120)}`)
    limitations.push('Research handoff does not auto-ingest into corpus.')
  }
  if (input.terraLiveHandoff?.summary) {
    limitations.push(`Terra live handoff: ${input.terraLiveHandoff.summary.slice(0, 120)}`)
    limitations.push('Terra live observation does not auto-become training data.')
  }
  if (input.validatorFinding?.summary) {
    limitations.push(`Council Validator finding: ${input.validatorFinding.summary.slice(0, 120)}`)
    limitations.push('Validator finding does not authorize deletion.')
  }
  if (input.securityFinding?.summary) {
    limitations.push(`Security finding: ${input.securityFinding.summary.slice(0, 120)}`)
    limitations.push('Security finding does not authorize deletion.')
  }
  if (input.operationsHandoff?.summary) {
    limitations.push(`Operations handoff: ${input.operationsHandoff.summary.slice(0, 120)}`)
    limitations.push('Operations (runtime health) does not change corpus quality.')
  }
  if (input.recommendEngineering) {
    limitations.push('ENGINEERING_REVIEW_REQUIRED recommended only — Engineering Agent not auto-invoked.')
  }

  const serviceRole = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: true,
    actionKind: 'MISSION_EXECUTION',
    body: {},
    commanderSessionOk: false,
    requestingActorId: 'service_role',
    approvingActorId: 'service_role',
  })
  denials.push({
    capability_or_action: 'SERVICE_ROLE_PROBE',
    reason_code: serviceRole.reasonCode,
    reason: 'SERVICE_ROLE_TECHNICAL_REACH != POLICY_PERMISSION / ownership authority.',
  })

  if (
    input.conversationId &&
    input.conversationOwnerUserId &&
    input.conversationOwnerUserId !== input.ownerUserId
  ) {
    denials.push({
      capability_or_action: 'OWNER_SCOPE',
      reason_code: 'OWNER_SCOPE_DENIED',
      reason: 'Cross-user corpus/session context denied.',
    })
    return finish('DENIED', emptyScope(), 'Owner scope denied.')
  }

  if (input.enforceOwnership && input.conversationOwnerUserId) {
    const match = assertDataCorpusOwnerScopeMatch(input.ownerUserId, input.conversationOwnerUserId)
    if (!match.ok) {
      denials.push({
        capability_or_action: 'OWNER_SCOPE',
        reason_code: 'OWNER_SCOPE_DENIED',
        reason: match.reason,
      })
      return finish('DENIED', emptyScope(), 'Owner scope denied.')
    }
  }

  const scope = createDataCorpusScope({
    corpusQuestion: input.corpusQuestion,
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    datasetScope: input.datasetScope ?? 'fixture_bounded',
    conversationId: input.conversationId,
    missionId: input.missionId,
    sourceScope: input.sourceScope,
    documentIds: input.documentIds,
    allowMetadataWrite: input.allowMetadataWrite === true,
    allowIndexSupportWrite: input.allowIndexSupportWrite === true,
    nowIso: startedAt,
  })

  if (isDataCorpusScopeExpired(scope)) {
    denials.push({
      capability_or_action: 'SCOPE',
      reason_code: 'APPROVAL_EXPIRED',
      reason: 'Data corpus scope expired.',
    })
    return finish('DENIED', scope, 'Scope expired.')
  }

  const analyzed = analyzeCorpus({
    scope,
    records: input.records,
    useFixtures: input.useFixtures !== false,
    promotePrivateToShared: input.promotePrivateToShared === true,
    autoDeleteDuplicates: input.autoDeleteDuplicates === true,
    startRoadmap23: input.startRoadmap23 === true,
  })

  findings = analyzed.findings
  duplicate_groups = analyzed.duplicate_groups
  provenance_gaps = analyzed.provenance_gaps
  license_gaps = analyzed.license_gaps
  stale_records = analyzed.stale_records
  conflicts = analyzed.conflicts
  retrieval_suitability = analyzed.retrieval_suitability
  wr_corpus_candidates = analyzed.wr_corpus_candidates
  wr_corpus_exclusions = analyzed.wr_corpus_exclusions
  review_required = analyzed.review_required
  writes_performed = analyzed.writes_performed
  documents_examined = analyzed.documents_examined
  chunks_examined = analyzed.chunks_examined
  quality_summary = analyzed.quality_summary
  limitations.push(...analyzed.limitations)
  unavailable.push(...analyzed.unavailable)

  let status: DataCorpusResult['status'] = 'COMPLETE'
  if (documents_examined === 0) status = 'FAILED'
  else if (!scope.allow_metadata_write && provenance_gaps.length > 0) status = 'PARTIAL'
  else if (conflicts.length > 0 || stale_records.length > 0) status = 'PARTIAL'

  return finish(
    status,
    scope,
    `Corpus curation ${status}: docs=${documents_examined}; dups=${duplicate_groups.length}; writes=${writes_performed.length}`,
  )
}

export function dataCorpusResultForCouncil(result: DataCorpusResult) {
  return {
    agent_role: result.agent_role,
    status: result.status,
    quality_summary: result.quality_summary,
    duplicate_groups: result.duplicate_groups,
    provenance_gaps: result.provenance_gaps,
    review_required: result.review_required,
    wr_corpus_candidates: result.wr_corpus_candidates,
    limitations: result.limitations,
    boundary_notes: result.boundary_notes,
    crawl_authority: 'DENIED' as const,
    training_authority: 'DENIED' as const,
    roadmap_23_status: result.roadmap_23_status,
  }
}
