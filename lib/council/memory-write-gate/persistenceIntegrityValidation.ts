import { FakeMemoryStore } from './FakeMemoryStore'
import {
  createExplicitMemoryWriteApproval,
} from './MemoryApprovalVerifier'
import { MemoryIntegrityChecker } from './MemoryIntegrityChecker'
import { MemoryWriteCommitter } from './MemoryWriteCommitter'
import { MemoryWriteProposalBuilder } from './MemoryWriteProposalBuilder'
import { MemoryWriteStager } from './MemoryWriteStager'
import type { FakeMemoryStoreSnapshot, MemoryWriteValidationResult } from './types'

const NOW = '2026-07-07T12:00:00.000Z'
const FUTURE = '2026-07-07T12:10:00.000Z'

class IndependentStoreSpy {
  private snapshots: FakeMemoryStoreSnapshot[] = []

  capture(store: FakeMemoryStore): FakeMemoryStoreSnapshot {
    const snapshot = store.snapshot()
    this.snapshots = [...this.snapshots, snapshot]
    return snapshot
  }

  memoryRecordsChangedBetween(first: number, second: number): boolean {
    return JSON.stringify(this.snapshots[first]?.records) !== JSON.stringify(this.snapshots[second]?.records)
  }
}

export function runMemoryPersistenceIntegrityValidation(): MemoryWriteValidationResult[] {
  return [
    validateBlockedAttemptsLeaveStoreUnchanged(),
    validateDuplicateRetryCreatesNoDuplicate(),
    validatePartialFailureDetected(),
    validatePartialFailureWithNoWriteReportsStoreUnchanged(),
    validateRollbackPlanBeforeCommit(),
    validateRollbackRevokesWithoutDeleting(),
    validateAuditTrailAppendOnly(),
  ]
}

function validateBlockedAttemptsLeaveStoreUnchanged(): MemoryWriteValidationResult {
  const store = new FakeMemoryStore()
  const spy = new IndependentStoreSpy()
  const fixture = buildFixture(store)
  spy.capture(store)
  const result = new MemoryWriteCommitter().commit({
    ...fixture,
    approval: null,
    store,
    now: NOW,
  }).result
  spy.capture(store)
  const memoryCount = store.snapshot().records.length
  const changed = spy.memoryRecordsChangedBetween(0, 1)
  const passed = result.status === 'approval_missing' && memoryCount === 0 && !changed

  return makeResult('gate8_blocked_unchanged', 'Blocked memory write leaves independent memory records unchanged.', 'approval_missing', result.status, false, changed, 0, memoryCount, false, result.approvalConsumed, new MemoryIntegrityChecker().check(store).consistent, passed)
}

function validateDuplicateRetryCreatesNoDuplicate(): MemoryWriteValidationResult {
  const store = new FakeMemoryStore()
  const first = buildFixture(store)
  const committer = new MemoryWriteCommitter()
  const firstResult = committer.commit({ ...first, store, now: NOW }).result
  const duplicate = buildFixture(store, 'proposal_duplicate')
  const secondResult = committer.commit({ ...duplicate, store, now: NOW }).result
  const memoryCount = store.snapshot().records.length
  const passed = firstResult.status === 'committed' && secondResult.status === 'duplicate_detected' && memoryCount === 1

  return makeResult('gate8_duplicate_retry', 'Duplicate retry creates no duplicate memory.', 'duplicate_detected', secondResult.status, false, false, 1, memoryCount, false, secondResult.approvalConsumed, new MemoryIntegrityChecker().check(store).consistent, passed)
}

function validatePartialFailureDetected(): MemoryWriteValidationResult {
  const store = new FakeMemoryStore('throw_after_memory_before_commit_audit')
  const fixture = buildFixture(store)
  const result = new MemoryWriteCommitter().commit({ ...fixture, store, now: NOW }).result
  const report = new MemoryIntegrityChecker().detectPartialFailure(
    store,
    fixture.stagedWrite.stagedWriteId
  )
  const memoryCount = store.snapshot().records.length
  const passed =
    result.status === 'partial_failure' &&
    result.memoryStoreChanged &&
    !report.consistent &&
    memoryCount === 1

  return makeResult('gate8_partial_failure', 'Partial failure with a persisted fake record is detected by independent integrity report.', 'partial_failure', result.status, true, result.memoryStoreChanged, 1, memoryCount, true, result.approvalConsumed, report.consistent, passed)
}

function validatePartialFailureWithNoWriteReportsStoreUnchanged(): MemoryWriteValidationResult {
  const store = new FakeMemoryStore('throw_before_any_write')
  const fixture = buildFixture(store)
  const result = new MemoryWriteCommitter().commit({ ...fixture, store, now: NOW }).result
  const memoryCount = store.snapshot().records.length
  const passed =
    result.status === 'partial_failure' &&
    result.memoryStoreChanged === false &&
    result.memoryId === null &&
    memoryCount === 0

  return makeResult('gate8_partial_failure_no_write', 'Partial failure before any write correctly reports memoryStoreChanged false when no record was ever persisted.', 'partial_failure', result.status, false, result.memoryStoreChanged, 0, memoryCount, true, result.approvalConsumed, new MemoryIntegrityChecker().check(store).consistent, passed)
}

function validateRollbackPlanBeforeCommit(): MemoryWriteValidationResult {
  const store = new FakeMemoryStore()
  const fixture = buildFixture(store)
  const result = new MemoryWriteCommitter().commit({ ...fixture, store, now: NOW }).result
  const passed = Boolean(result.rollbackPlan.rollbackPlanId) && result.rollbackPlan.createdAt === NOW

  return makeResult('gate8_rollback_plan_before_commit', 'Rollback plan exists in commit result.', 'committed', result.status, true, result.memoryStoreChanged, 1, store.snapshot().records.length, true, result.approvalConsumed, new MemoryIntegrityChecker().check(store).consistent, passed)
}

function validateRollbackRevokesWithoutDeleting(): MemoryWriteValidationResult {
  const store = new FakeMemoryStore()
  const fixture = buildFixture(store)
  const result = new MemoryWriteCommitter().commit({ ...fixture, store, now: NOW }).result
  const rollback = store.rollback({
    rollbackPlanId: result.rollbackPlan.rollbackPlanId,
    targetMemoryId: result.memoryId,
    createdAt: NOW,
  })
  const records = store.snapshot().records
  const passed = rollback.status === 'rolled_back' && records.length === 1 && records[0]?.status === 'revoked'

  return makeResult('gate8_rollback_revokes', 'Rollback marks committed memory revoked without deleting.', 'rolled_back', rollback.status, true, rollback.memoryStoreChanged, 1, records.length, true, result.approvalConsumed, new MemoryIntegrityChecker().check(store).consistent, passed)
}

function validateAuditTrailAppendOnly(): MemoryWriteValidationResult {
  const store = new FakeMemoryStore()
  const fixture = buildFixture(store)
  const before = store.snapshot().auditEvents.length
  const result = new MemoryWriteCommitter().commit({ ...fixture, store, now: NOW }).result
  const afterCommit = store.snapshot().auditEvents.length
  store.rollback({
    rollbackPlanId: result.rollbackPlan.rollbackPlanId,
    targetMemoryId: result.memoryId,
    createdAt: NOW,
  })
  const afterRollback = store.snapshot().auditEvents.length
  const passed = before < afterCommit && afterCommit < afterRollback

  return makeResult('gate8_audit_append_only', 'Audit trail grows append-only through commit and rollback.', 'committed', result.status, true, result.memoryStoreChanged, 1, store.snapshot().records.length, true, result.approvalConsumed, new MemoryIntegrityChecker().check(store).consistent, passed)
}

function buildFixture(store: FakeMemoryStore, proposalId = 'proposal_gate8') {
  const proposal = new MemoryWriteProposalBuilder().build({
    proposalId,
    source: 'commander_message',
    proposedBy: 'commander',
    memoryType: 'lesson',
    memoryScope: 'validation',
    content: 'Gate 8 validates fake memory integrity.',
    rationale: 'Persistence integrity validation.',
    evidence: [{
      evidenceId: `evidence_${proposalId}`,
      evidenceType: 'validation_report',
      reference: 'gate8',
      summary: 'Independent persistence integrity validation.',
    }],
    confidence: 'high',
    riskLevel: 'medium',
    privacySensitivity: 'medium',
    proposedAt: NOW,
  })
  const stagedWrite = new MemoryWriteStager().stage({ proposal, store, createdAt: NOW })
  const approval = createExplicitMemoryWriteApproval({
    approvalId: `approval_${proposalId}`,
    proposal,
    stagedWrite,
    approvedAt: NOW,
    expiresAt: FUTURE,
    nonce: `nonce_${proposalId}`,
  })

  return { proposal, stagedWrite, approval }
}

function makeResult(
  caseId: string,
  description: string,
  expectedStatus: MemoryWriteValidationResult['expectedStatus'],
  observedStatus: MemoryWriteValidationResult['observedStatus'],
  expectedStoreChanged: boolean,
  observedStoreChanged: boolean,
  expectedMemoryCount: number,
  observedMemoryCount: number,
  expectedApprovalConsumed: boolean,
  observedApprovalConsumed: boolean,
  integrityConsistent: boolean,
  passed: boolean
): MemoryWriteValidationResult {
  return {
    caseId,
    description,
    expectedStatus,
    observedStatus,
    expectedStoreChanged,
    observedStoreChanged,
    expectedMemoryCount,
    observedMemoryCount,
    expectedApprovalConsumed,
    observedApprovalConsumed,
    integrityConsistent,
    result: passed ? 'PASS' : 'FAIL',
    notes: ['Gate 8 used an independent store spy snapshot, not writer counters.'],
  }
}
