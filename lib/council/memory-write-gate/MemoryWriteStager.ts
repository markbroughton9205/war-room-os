import type { FakeMemoryStore } from './FakeMemoryStore'
import type {
  MemoryReviewChecklist,
  MemoryWriteProposal,
  StagedMemoryWrite,
} from './types'
import { MemoryRollbackPlanner } from './MemoryRollbackPlanner'

export class MemoryWriteStager {
  private readonly rollbackPlanner = new MemoryRollbackPlanner()

  stage(input: {
    proposal: MemoryWriteProposal
    store: FakeMemoryStore
    createdAt: string
    stagedWriteId?: string
  }): StagedMemoryWrite {
    const normalizedContent = normalizeMemoryContent(input.proposal.content)
    const memoryFingerprint = createMemoryFingerprint(normalizedContent)
    const duplicate = input.store.findCommittedByFingerprint(memoryFingerprint)
    const conflicts = input.store.findConflicts(input.proposal)
    const checklist: MemoryReviewChecklist = {
      scopeVerified: Boolean(input.proposal.memoryScope),
      evidenceAttached: input.proposal.evidence.length > 0,
      duplicateChecked: true,
      conflictChecked: true,
      privacyChecked: true,
      rollbackPlanCreated: true,
      commanderApprovalRequired: true,
    }
    const stagedWrite: StagedMemoryWrite = {
      stagedWriteId:
        input.stagedWriteId ?? `staged_${input.proposal.proposalId}`,
      proposalId: input.proposal.proposalId,
      status: 'pending_review',
      normalizedContent,
      memoryFingerprint,
      duplicateOfMemoryId: duplicate?.memoryId ?? null,
      conflictsWithMemoryIds: conflicts.map(record => record.memoryId),
      requiresSecondConfirmation: true,
      reviewChecklist: checklist,
      createdAt: input.createdAt,
    }

    input.store.appendAuditEvent({
      eventType: 'memory_staged',
      proposalId: input.proposal.proposalId,
      stagedWriteId: stagedWrite.stagedWriteId,
      memoryId: null,
      message: 'Memory write staged for commander review.',
      createdAt: input.createdAt,
    })
    input.store.appendAuditEvent({
      eventType: 'memory_rollback_planned',
      proposalId: input.proposal.proposalId,
      stagedWriteId: stagedWrite.stagedWriteId,
      memoryId: null,
      message: this.rollbackPlanner.createPlan({
        proposal: input.proposal,
        stagedWrite,
        targetMemoryId: null,
        committed: false,
        createdAt: input.createdAt,
      }).expectedEffect,
      createdAt: input.createdAt,
    })

    return stagedWrite
  }
}

export function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, ' ')
}

export function createMemoryFingerprint(content: string): string {
  let hash = 2166136261

  for (const character of content.toLowerCase()) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }

  return `mem_${(hash >>> 0).toString(16).padStart(8, '0')}`
}

