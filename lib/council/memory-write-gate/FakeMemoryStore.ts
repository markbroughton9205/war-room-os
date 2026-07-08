import type {
  FakeMemoryRecord,
  FakeMemoryStoreMode,
  FakeMemoryStoreSnapshot,
  MemoryAuditEvent,
  MemoryRollbackResult,
  MemoryWriteProposal,
  StagedMemoryWrite,
} from './types'

export class FakeMemoryStore {
  private records: FakeMemoryRecord[] = []
  private auditEvents: MemoryAuditEvent[] = []

  constructor(private mode: FakeMemoryStoreMode = 'normal') {}

  snapshot(): FakeMemoryStoreSnapshot {
    return {
      records: this.records.map(record => ({ ...record })),
      auditEvents: this.auditEvents.map(event => ({ ...event })),
    }
  }

  setMode(mode: FakeMemoryStoreMode): void {
    this.mode = mode
  }

  appendAuditEvent(input: Omit<MemoryAuditEvent, 'auditEventId'>): MemoryAuditEvent {
    const event: MemoryAuditEvent = {
      ...input,
      auditEventId: `audit_${this.auditEvents.length + 1}_${input.eventType}`,
    }

    this.auditEvents = [...this.auditEvents, event]

    return event
  }

  commitMemory(input: {
    proposal: MemoryWriteProposal
    stagedWrite: StagedMemoryWrite
    createdAt: string
  }): { memory: FakeMemoryRecord; auditEvent: MemoryAuditEvent } {
    const auditEvent = this.appendAuditEvent({
      eventType: 'memory_commit_attempted',
      proposalId: input.proposal.proposalId,
      stagedWriteId: input.stagedWrite.stagedWriteId,
      memoryId: null,
      message: 'Fake memory commit attempted.',
      createdAt: input.createdAt,
    })

    if (this.mode === 'throw_after_audit_before_memory') {
      throw new Error('Fake store partial failure after audit before memory record.')
    }

    const memory: FakeMemoryRecord = {
      memoryId: `memory_${this.records.length + 1}_${input.stagedWrite.memoryFingerprint}`,
      proposalId: input.proposal.proposalId,
      stagedWriteId: input.stagedWrite.stagedWriteId,
      memoryType: input.proposal.memoryType,
      memoryScope: input.proposal.memoryScope,
      targetEntityId: input.proposal.targetEntityId,
      content: input.stagedWrite.normalizedContent,
      fingerprint: input.stagedWrite.memoryFingerprint,
      status: 'committed',
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }

    this.records = [...this.records, memory]

    if (this.mode === 'throw_after_memory_before_commit_audit') {
      throw new Error('Fake store partial failure after memory record before commit audit.')
    }

    this.appendAuditEvent({
      eventType: 'memory_committed',
      proposalId: input.proposal.proposalId,
      stagedWriteId: input.stagedWrite.stagedWriteId,
      memoryId: memory.memoryId,
      message: 'Fake memory committed.',
      createdAt: input.createdAt,
    })

    return { memory, auditEvent }
  }

  rejectCommit(input: {
    proposalId: string
    stagedWriteId: string
    message: string
    createdAt: string
  }): MemoryAuditEvent {
    return this.appendAuditEvent({
      eventType: 'memory_commit_rejected',
      proposalId: input.proposalId,
      stagedWriteId: input.stagedWriteId,
      memoryId: null,
      message: input.message,
      createdAt: input.createdAt,
    })
  }

  markPartialFailure(input: {
    proposalId: string
    stagedWriteId: string
    message: string
    createdAt: string
  }): MemoryAuditEvent {
    return this.appendAuditEvent({
      eventType: 'memory_partial_failure',
      proposalId: input.proposalId,
      stagedWriteId: input.stagedWriteId,
      memoryId: null,
      message: input.message,
      createdAt: input.createdAt,
    })
  }

  rollback(plan: {
    rollbackPlanId: string
    targetMemoryId: string | null
    createdAt: string
  }): MemoryRollbackResult {
    if (!plan.targetMemoryId) {
      const auditEvent = this.appendAuditEvent({
        eventType: 'memory_rolled_back',
        proposalId: 'uncommitted',
        stagedWriteId: null,
        memoryId: null,
        message: 'Rollback no-op for uncommitted staged memory.',
        createdAt: plan.createdAt,
      })

      return {
        rollbackResultId: `rollback_result_${plan.rollbackPlanId}`,
        rollbackPlanId: plan.rollbackPlanId,
        targetMemoryId: null,
        status: 'not_committed',
        memoryStoreChanged: false,
        auditEventId: auditEvent.auditEventId,
        message: 'Staged write was not committed; no persistent memory changed.',
        createdAt: plan.createdAt,
      }
    }

    const existing = this.records.find(record => record.memoryId === plan.targetMemoryId)

    if (!existing) {
      const auditEvent = this.appendAuditEvent({
        eventType: 'memory_rolled_back',
        proposalId: 'unknown',
        stagedWriteId: null,
        memoryId: plan.targetMemoryId,
        message: 'Rollback target was not found.',
        createdAt: plan.createdAt,
      })

      return {
        rollbackResultId: `rollback_result_${plan.rollbackPlanId}`,
        rollbackPlanId: plan.rollbackPlanId,
        targetMemoryId: plan.targetMemoryId,
        status: 'rollback_failed',
        memoryStoreChanged: false,
        auditEventId: auditEvent.auditEventId,
        message: 'Rollback target memory was not found.',
        createdAt: plan.createdAt,
      }
    }

    this.records = this.records.map(record =>
      record.memoryId === plan.targetMemoryId
        ? { ...record, status: 'revoked', updatedAt: plan.createdAt }
        : record
    )
    const auditEvent = this.appendAuditEvent({
      eventType: 'memory_rolled_back',
      proposalId: existing.proposalId,
      stagedWriteId: existing.stagedWriteId,
      memoryId: existing.memoryId,
      message: 'Committed fake memory marked revoked; no record deleted.',
      createdAt: plan.createdAt,
    })

    return {
      rollbackResultId: `rollback_result_${plan.rollbackPlanId}`,
      rollbackPlanId: plan.rollbackPlanId,
      targetMemoryId: existing.memoryId,
      status: 'rolled_back',
      memoryStoreChanged: true,
      auditEventId: auditEvent.auditEventId,
      message: 'Committed fake memory was marked revoked.',
      createdAt: plan.createdAt,
    }
  }

  findCommittedByFingerprint(fingerprint: string): FakeMemoryRecord | null {
    return this.records.find(
      record => record.fingerprint === fingerprint && record.status === 'committed'
    ) ?? null
  }

  findConflicts(proposal: MemoryWriteProposal): FakeMemoryRecord[] {
    const marker = `conflict:${proposal.memoryScope}:${proposal.targetEntityId ?? 'none'}`

    return this.records.filter(
      record =>
        record.status === 'committed' &&
        record.content.toLowerCase().includes(marker.toLowerCase()) &&
        !proposal.content.toLowerCase().includes(record.content.toLowerCase())
    )
  }
}
