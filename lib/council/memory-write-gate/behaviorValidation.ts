import {
  ExplicitExecutionApprovalFactory,
  type ExplicitExecutionApproval,
} from '../approved-call'
import { FakeMemoryStore } from './FakeMemoryStore'
import {
  createExplicitMemoryWriteApproval,
} from './MemoryApprovalVerifier'
import { MemoryIntegrityChecker } from './MemoryIntegrityChecker'
import { MemoryWriteCommitter } from './MemoryWriteCommitter'
import { MemoryWriteProposalBuilder } from './MemoryWriteProposalBuilder'
import { MemoryWriteStager } from './MemoryWriteStager'
import type {
  MemoryEvidence,
  MemoryRollbackResult,
  MemoryScope,
  MemoryType,
  MemoryWriteCommitStatus,
  MemoryWriteProposal,
  MemoryWriteValidationResult,
  StagedMemoryWrite,
} from './types'

const NOW = '2026-07-07T12:00:00.000Z'
const FUTURE = '2026-07-07T12:10:00.000Z'
const PAST = '2026-07-07T11:59:00.000Z'

type NegativeCase = {
  caseId: string
  description: string
  setup: () => {
    proposal: MemoryWriteProposal
    stagedWrite: StagedMemoryWrite
    approval: unknown
    store: FakeMemoryStore
    autoModeEnabled?: boolean
  }
  expectedStatus: MemoryWriteCommitStatus
  expectedStoreChanged: boolean
  expectedMemoryCount: number
  expectedApprovalConsumed: boolean
}

export function runMemoryWriteGateBehaviorValidation(): MemoryWriteValidationResult[] {
  const negativeResults = buildNegativeCases().map(runNegativeCase)
  const realisticResults = buildRealisticProposalCases().map(runRealisticCase)

  return [...negativeResults, ...realisticResults]
}

function buildNegativeCases(): NegativeCase[] {
  return [
    {
      caseId: 'case_01_no_approval',
      description: 'No approval keeps staged write pending and fake store unchanged.',
      setup: () => createCommitFixture({ approvalMode: 'none' }),
      expectedStatus: 'approval_missing',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_02_wrong_approval_kind',
      description: '46G/46H ExplicitExecutionApproval cannot authorize memory writing.',
      setup: () => createCommitFixture({ approvalMode: 'execution_approval' }),
      expectedStatus: 'approval_invalid',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_03_wrong_approval_text',
      description: 'Wrong memory approval text is rejected.',
      setup: () => createCommitFixture({ approvalOverride: { approvalText: 'I approve memory' } }),
      expectedStatus: 'approval_invalid',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_04_expired_approval',
      description: 'Expired memory approval is rejected.',
      setup: () => createCommitFixture({ approvalOverride: { expiresAt: PAST } }),
      expectedStatus: 'approval_expired',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_05_consumed_approval',
      description: 'Consumed memory approval is rejected.',
      setup: () => createCommitFixture({ approvalOverride: { consumed: true } }),
      expectedStatus: 'approval_consumed',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_06_mismatched_proposal',
      description: 'Mismatched proposalId is rejected.',
      setup: () => createCommitFixture({ approvalOverride: { proposalId: 'proposal_other' } }),
      expectedStatus: 'approval_invalid',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_07_mismatched_staged_write',
      description: 'Mismatched stagedWriteId is rejected.',
      setup: () => createCommitFixture({ approvalOverride: { stagedWriteId: 'staged_other' } }),
      expectedStatus: 'approval_invalid',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_08_wrong_memory_scope',
      description: 'Wrong memory scope is rejected.',
      setup: () => createCommitFixture({ approvalOverride: { memoryScope: 'operator' } }),
      expectedStatus: 'approval_invalid',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_09_wrong_target_entity',
      description: 'Wrong target entity is rejected.',
      setup: () => createCommitFixture({ targetEntityId: 'architect', approvalOverride: { targetEntityId: 'strategist' } }),
      expectedStatus: 'approval_invalid',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_10_duplicate_retry',
      description: 'Duplicate write attempt creates exactly one committed memory.',
      setup: () => createDuplicateRetryFixture(),
      expectedStatus: 'duplicate_detected',
      expectedStoreChanged: false,
      expectedMemoryCount: 1,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_11_partial_write',
      description: 'Partial failure reports partial_failure and integrity issue.',
      setup: () => createCommitFixture({ storeMode: 'throw_after_memory_before_commit_audit' }),
      expectedStatus: 'partial_failure',
      expectedStoreChanged: true,
      expectedMemoryCount: 1,
      expectedApprovalConsumed: true,
    },
    {
      caseId: 'case_12_conflict_detected',
      description: 'Conflict detected blocks commit.',
      setup: () => createConflictFixture(),
      expectedStatus: 'conflict_detected',
      expectedStoreChanged: false,
      expectedMemoryCount: 1,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_13_missing_evidence',
      description: 'Missing evidence stages but is not committable.',
      setup: () => createCommitFixture({ evidence: [] }),
      expectedStatus: 'blocked',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_14_provider_authored_without_commander',
      description: 'Provider-authored memory without valid commander approval is rejected.',
      setup: () => createCommitFixture({ source: 'provider_result', approvalMode: 'none' }),
      expectedStatus: 'rejected',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_15_auto_mode_memory_write',
      description: 'Auto Mode memory write is rejected.',
      setup: () => createCommitFixture({ autoModeEnabled: true }),
      expectedStatus: 'rejected',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_16_cross_scope_write',
      description: 'Cross-scope write attempt is rejected.',
      setup: () => createCommitFixture({ approvalOverride: { allowCrossScopeWrite: true } }),
      expectedStatus: 'approval_invalid',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_17_overwrite_attempt',
      description: 'Overwrite attempt is rejected.',
      setup: () => createCommitFixture({ approvalOverride: { allowOverwrite: true } }),
      expectedStatus: 'approval_invalid',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_18_rollback_uncommitted',
      description: 'Rollback of uncommitted staged write has no persistent effect.',
      setup: () => createCommitFixture({ approvalMode: 'none' }),
      expectedStatus: 'blocked',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
    {
      caseId: 'case_19_rollback_committed',
      description: 'Rollback of committed fake memory marks record revoked and appends audit.',
      setup: () => createCommitFixture(),
      expectedStatus: 'committed',
      expectedStoreChanged: true,
      expectedMemoryCount: 1,
      expectedApprovalConsumed: true,
    },
    {
      caseId: 'case_20_duck_typed_approval',
      description: 'Duck-typed approved object is structurally rejected.',
      setup: () => createCommitFixture({ approvalMode: 'duck_typed' }),
      expectedStatus: 'approval_invalid',
      expectedStoreChanged: false,
      expectedMemoryCount: 0,
      expectedApprovalConsumed: false,
    },
  ]
}

function runNegativeCase(input: NegativeCase): MemoryWriteValidationResult {
  const fixture = input.setup()
  const committer = new MemoryWriteCommitter()
  const commit = committer.commit({
    proposal: fixture.proposal,
    stagedWrite: fixture.stagedWrite,
    approval: fixture.approval,
    store: fixture.store,
    now: NOW,
    autoModeEnabled: fixture.autoModeEnabled,
  })
  let observedStatus: MemoryWriteValidationResult['observedStatus'] = commit.result.status
  let rollbackResult: MemoryRollbackResult | null = null

  if (input.caseId === 'case_18_rollback_uncommitted') {
    rollbackResult = fixture.store.rollback({
      rollbackPlanId: commit.result.rollbackPlan.rollbackPlanId,
      targetMemoryId: null,
      createdAt: NOW,
    })
    observedStatus = rollbackResult.status
  }

  if (input.caseId === 'case_19_rollback_committed') {
    rollbackResult = fixture.store.rollback({
      rollbackPlanId: commit.result.rollbackPlan.rollbackPlanId,
      targetMemoryId: commit.result.memoryId,
      createdAt: NOW,
    })
  }

  const after = fixture.store.snapshot()
  const report = new MemoryIntegrityChecker().check(fixture.store)
  const observedMemoryCount = after.records.length
  const expectedStatus =
    input.caseId === 'case_18_rollback_uncommitted'
      ? 'not_committed'
      : input.expectedStatus
  const observedStoreChanged =
    rollbackResult?.memoryStoreChanged ?? commit.result.memoryStoreChanged
  const expectedIntegrity = input.caseId !== 'case_11_partial_write'
  const passed =
    observedStatus === expectedStatus &&
    observedMemoryCount === input.expectedMemoryCount &&
    commit.result.approvalConsumed === input.expectedApprovalConsumed &&
    observedStoreChanged === input.expectedStoreChanged &&
    report.consistent === expectedIntegrity

  return {
    caseId: input.caseId,
    description: input.description,
    expectedStatus,
    observedStatus,
    expectedStoreChanged: input.expectedStoreChanged,
    observedStoreChanged,
    expectedMemoryCount: input.expectedMemoryCount,
    observedMemoryCount,
    expectedApprovalConsumed: input.expectedApprovalConsumed,
    observedApprovalConsumed: commit.result.approvalConsumed,
    integrityConsistent: report.consistent,
    result: passed ? 'PASS' : 'FAIL',
    notes: [
      commit.result.errorMessage ?? 'No commit error.',
      report.message,
      rollbackResult?.message ?? 'No rollback executed.',
    ],
  }
}

function buildRealisticProposalCases(): Array<() => MemoryWriteValidationResult> {
  return [
    () => runStagingCase('realistic_01_jasmine_added', 'Remember that Jasmine was added to War Room on July 7, 2026.', 'project_fact', 'project'),
    () => runStagingCase('realistic_02_routing_correction', 'Save this as a routing correction: scam questions should route to Skeptic.', 'routing_correction', 'global_war_room'),
    () => runStagingCase('realistic_03_architecture_decision', 'Record this architecture decision: 46I uses fake storage only.', 'architecture_decision', 'validation'),
    () => runAutoModeRealisticCase(),
    () => runProviderRealisticCase(),
    () => runDuplicateRealisticCase(),
    () => runConflictRealisticCase(),
    () => runWrongScopeRealisticCase(),
  ]
}

function runRealisticCase(fn: () => MemoryWriteValidationResult): MemoryWriteValidationResult {
  return fn()
}

function runStagingCase(
  caseId: string,
  content: string,
  memoryType: MemoryType,
  memoryScope: MemoryScope
): MemoryWriteValidationResult {
  const store = new FakeMemoryStore()
  const proposal = createProposal({ proposalId: caseId, content, memoryType, memoryScope })
  const stagedWrite = new MemoryWriteStager().stage({ proposal, store, createdAt: NOW })
  const snapshot = store.snapshot()
  const passed =
    stagedWrite.status === 'pending_review' &&
    stagedWrite.requiresSecondConfirmation === true &&
    snapshot.records.length === 0

  return {
    caseId,
    description: content,
    expectedStatus: 'staged',
    observedStatus: 'staged',
    expectedStoreChanged: false,
    observedStoreChanged: false,
    expectedMemoryCount: 0,
    observedMemoryCount: snapshot.records.length,
    expectedApprovalConsumed: false,
    observedApprovalConsumed: false,
    integrityConsistent: new MemoryIntegrityChecker().check(store).consistent,
    result: passed ? 'PASS' : 'FAIL',
    notes: ['Proposal staged for review; no fake memory committed.'],
  }
}

function runAutoModeRealisticCase(): MemoryWriteValidationResult {
  return runNegativeCase({
    caseId: 'realistic_04_auto_mode',
    description: 'Auto mode learned this, save it.',
    setup: () => createCommitFixture({ autoModeEnabled: true }),
    expectedStatus: 'rejected',
    expectedStoreChanged: false,
    expectedMemoryCount: 0,
    expectedApprovalConsumed: false,
  })
}

function runProviderRealisticCase(): MemoryWriteValidationResult {
  return runNegativeCase({
    caseId: 'realistic_05_provider_output',
    description: 'Provider output suggests User prefers X without Commander approval.',
    setup: () => createCommitFixture({ source: 'provider_result', approvalMode: 'none' }),
    expectedStatus: 'rejected',
    expectedStoreChanged: false,
    expectedMemoryCount: 0,
    expectedApprovalConsumed: false,
  })
}

function runDuplicateRealisticCase(): MemoryWriteValidationResult {
  return runNegativeCase({
    caseId: 'realistic_06_duplicate',
    description: 'Duplicate memory proposal detects duplicate and blocks duplicate commit.',
    setup: () => createDuplicateRetryFixture(),
    expectedStatus: 'duplicate_detected',
    expectedStoreChanged: false,
    expectedMemoryCount: 1,
    expectedApprovalConsumed: false,
  })
}

function runConflictRealisticCase(): MemoryWriteValidationResult {
  return runNegativeCase({
    caseId: 'realistic_07_conflict',
    description: 'Conflicting memory proposal detects conflict and blocks commit.',
    setup: () => createConflictFixture(),
    expectedStatus: 'conflict_detected',
    expectedStoreChanged: false,
    expectedMemoryCount: 1,
    expectedApprovalConsumed: false,
  })
}

function runWrongScopeRealisticCase(): MemoryWriteValidationResult {
  return runNegativeCase({
    caseId: 'realistic_08_wrong_scope',
    description: 'Wrong scope proposal blocks commit.',
    setup: () => createCommitFixture({ approvalOverride: { memoryScope: 'operator' } }),
    expectedStatus: 'approval_invalid',
    expectedStoreChanged: false,
    expectedMemoryCount: 0,
    expectedApprovalConsumed: false,
  })
}

function createCommitFixture(options: {
  approvalMode?: 'valid' | 'none' | 'execution_approval' | 'duck_typed'
  approvalOverride?: Record<string, unknown>
  evidence?: MemoryEvidence[]
  source?: MemoryWriteProposal['source']
  storeMode?: 'normal' | 'throw_after_audit_before_memory' | 'throw_after_memory_before_commit_audit'
  autoModeEnabled?: boolean
  targetEntityId?: string | null
} = {}): {
  proposal: MemoryWriteProposal
  stagedWrite: StagedMemoryWrite
  approval: unknown
  store: FakeMemoryStore
  autoModeEnabled?: boolean
} {
  const store = new FakeMemoryStore(options.storeMode ?? 'normal')
  const proposal = createProposal({
    proposalId: 'proposal_validation',
    source: options.source,
    evidence: options.evidence,
    targetEntityId: options.targetEntityId,
  })
  const stagedWrite = new MemoryWriteStager().stage({ proposal, store, createdAt: NOW })
  const approvalMode = options.approvalMode ?? 'valid'
  const approval =
    approvalMode === 'none'
      ? null
      : approvalMode === 'execution_approval'
        ? createExecutionApproval()
        : approvalMode === 'duck_typed'
          ? { approved: true, approvalKind: 'memory_write' }
          : {
              ...createExplicitMemoryWriteApproval({
                approvalId: 'approval_validation',
                proposal,
                stagedWrite,
                approvedAt: NOW,
                expiresAt: FUTURE,
                nonce: 'validation_nonce',
              }),
              ...options.approvalOverride,
            }

  return {
    proposal,
    stagedWrite,
    approval,
    store,
    autoModeEnabled: options.autoModeEnabled,
  }
}

function createDuplicateRetryFixture(): ReturnType<typeof createCommitFixture> {
  const fixture = createCommitFixture()
  const committer = new MemoryWriteCommitter()
  committer.commit({
    proposal: fixture.proposal,
    stagedWrite: fixture.stagedWrite,
    approval: fixture.approval,
    store: fixture.store,
    now: NOW,
  })
  const proposal = createProposal({ proposalId: 'proposal_duplicate' })
  const stagedWrite = new MemoryWriteStager().stage({ proposal, store: fixture.store, createdAt: NOW })
  const approval = createExplicitMemoryWriteApproval({
    approvalId: 'approval_duplicate',
    proposal,
    stagedWrite,
    approvedAt: NOW,
    expiresAt: FUTURE,
    nonce: 'duplicate_nonce',
  })

  return { proposal, stagedWrite, approval, store: fixture.store }
}

function createConflictFixture(): ReturnType<typeof createCommitFixture> {
  const store = new FakeMemoryStore()
  const seedProposal = createProposal({
    proposalId: 'proposal_conflict_seed',
    content: 'conflict:global_war_room:none Existing rule says scam questions route to Strategist.',
  })
  const seedStaged = new MemoryWriteStager().stage({ proposal: seedProposal, store, createdAt: NOW })
  const seedApproval = createExplicitMemoryWriteApproval({
    approvalId: 'approval_conflict_seed',
    proposal: seedProposal,
    stagedWrite: seedStaged,
    approvedAt: NOW,
    expiresAt: FUTURE,
    nonce: 'conflict_seed',
  })
  new MemoryWriteCommitter().commit({
    proposal: seedProposal,
    stagedWrite: seedStaged,
    approval: seedApproval,
    store,
    now: NOW,
  })
  const proposal = createProposal({
    proposalId: 'proposal_conflict',
    content: 'New rule says scam questions route to Skeptic.',
  })
  const stagedWrite = new MemoryWriteStager().stage({ proposal, store, createdAt: NOW })
  const approval = createExplicitMemoryWriteApproval({
    approvalId: 'approval_conflict',
    proposal,
    stagedWrite,
    approvedAt: NOW,
    expiresAt: FUTURE,
    nonce: 'conflict',
  })

  return { proposal, stagedWrite, approval, store }
}

function createProposal(options: {
  proposalId: string
  content?: string
  memoryType?: MemoryType
  memoryScope?: MemoryScope
  evidence?: MemoryEvidence[]
  source?: MemoryWriteProposal['source']
  targetEntityId?: string | null
}): MemoryWriteProposal {
  return new MemoryWriteProposalBuilder().build({
    proposalId: options.proposalId,
    source: options.source ?? 'commander_message',
    proposedBy: options.source === 'provider_result' ? 'council_entity' : 'commander',
    memoryType: options.memoryType ?? 'lesson',
    memoryScope: options.memoryScope ?? 'global_war_room',
    targetEntityId: options.targetEntityId ?? null,
    content: options.content ?? '46I uses fake storage only.',
    rationale: 'Validation fixture.',
    evidence: options.evidence ?? [
      {
        evidenceId: `evidence_${options.proposalId}`,
        evidenceType: 'commander_statement',
        reference: 'validation',
        summary: 'Commander supplied validation fixture.',
      },
    ],
    confidence: 'high',
    riskLevel: 'medium',
    privacySensitivity: 'medium',
    proposedAt: NOW,
  })
}

function createExecutionApproval(): ExplicitExecutionApproval {
  return ExplicitExecutionApprovalFactory.create({
    approvalId: 'execution_approval_wrong_kind',
    executionPlanId: 'exec_wrong_kind',
    previewId: 'preview_wrong_kind',
    allowedProviderCandidateId: 'openai-approved-smoke',
    allowedExecutionStepId: 'step_wrong_kind',
    approvedAt: NOW,
    expiresAt: FUTURE,
    approvalTokenSeed: 'wrong_kind',
  })
}

export function createUncommittedRollbackValidation(): MemoryWriteValidationResult {
  return runNegativeCase(buildNegativeCases()[17])
}
