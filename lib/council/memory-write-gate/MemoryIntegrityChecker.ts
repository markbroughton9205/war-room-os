import type { FakeMemoryStore } from './FakeMemoryStore'
import type { MemoryIntegrityReport } from './types'

export class MemoryIntegrityChecker {
  detectPartialFailure(
    store: FakeMemoryStore,
    stagedWriteId: string
  ): MemoryIntegrityReport {
    const snapshot = store.snapshot()
    const hasAttempt = snapshot.auditEvents.some(
      event =>
        event.eventType === 'memory_commit_attempted' &&
        event.stagedWriteId === stagedWriteId
    )
    const hasCommitAudit = snapshot.auditEvents.some(
      event =>
        event.eventType === 'memory_committed' &&
        event.stagedWriteId === stagedWriteId
    )
    const hasPartialAudit = snapshot.auditEvents.some(
      event =>
        event.eventType === 'memory_partial_failure' &&
        event.stagedWriteId === stagedWriteId
    )
    const hasMemoryRecord = snapshot.records.some(
      record => record.stagedWriteId === stagedWriteId
    )
    const issueIds: string[] = []

    if (hasAttempt && !hasCommitAudit) {
      issueIds.push(`partial_commit_attempt_without_commit_audit:${stagedWriteId}`)
    }

    if (hasMemoryRecord && !hasCommitAudit) {
      issueIds.push(`partial_memory_record_without_commit_audit:${stagedWriteId}`)
    }

    if (hasPartialAudit) {
      issueIds.push(`partial_failure_audit:${stagedWriteId}`)
    }

    return {
      consistent: issueIds.length === 0,
      issueIds,
      message:
        issueIds.length === 0
          ? 'No partial memory failure detected.'
          : `Partial memory failure detected: ${issueIds.join(', ')}`,
    }
  }

  check(store: FakeMemoryStore): MemoryIntegrityReport {
    const snapshot = store.snapshot()
    const issueIds: string[] = []

    for (const record of snapshot.records) {
      const committedAudit = snapshot.auditEvents.some(
        event =>
          event.eventType === 'memory_committed' &&
          event.memoryId === record.memoryId
      )

      if (record.status === 'committed' && !committedAudit) {
        issueIds.push(`missing_commit_audit:${record.memoryId}`)
      }
    }

    for (const audit of snapshot.auditEvents) {
      if (audit.eventType === 'memory_partial_failure') {
        issueIds.push(`partial_failure:${audit.stagedWriteId}`)
      }

      if (audit.eventType === 'memory_commit_attempted') {
        const relatedCommit = snapshot.auditEvents.some(
          event =>
            event.eventType === 'memory_committed' &&
            event.stagedWriteId === audit.stagedWriteId
        )
        const relatedPartial = snapshot.auditEvents.some(
          event =>
            event.eventType === 'memory_partial_failure' &&
            event.stagedWriteId === audit.stagedWriteId
        )
        const relatedReject = snapshot.auditEvents.some(
          event =>
            event.eventType === 'memory_commit_rejected' &&
            event.stagedWriteId === audit.stagedWriteId
        )

        if (!relatedCommit && !relatedPartial && !relatedReject) {
          issueIds.push(`commit_attempt_without_resolution:${audit.stagedWriteId}`)
        }
      }
    }

    const fingerprints = new Set<string>()

    for (const record of snapshot.records.filter(record => record.status === 'committed')) {
      if (fingerprints.has(record.fingerprint)) {
        issueIds.push(`duplicate_committed_fingerprint:${record.fingerprint}`)
      }

      fingerprints.add(record.fingerprint)
    }

    return {
      consistent: issueIds.length === 0,
      issueIds,
      message:
        issueIds.length === 0
          ? 'Fake memory store integrity is consistent.'
          : `Fake memory store integrity issues: ${issueIds.join(', ')}`,
    }
  }
}
