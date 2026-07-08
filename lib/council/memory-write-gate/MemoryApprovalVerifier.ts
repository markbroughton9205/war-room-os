import {
  EXPLICIT_MEMORY_WRITE_APPROVAL_TEXT,
  type ExplicitMemoryWriteApproval,
  type MemoryApprovalInvalidReason,
  type MemoryApprovalVerificationResult,
  type MemoryWriteProposal,
  type StagedMemoryWrite,
} from './types'

export class MemoryApprovalVerifier {
  verify(input: {
    approval: unknown
    proposal: MemoryWriteProposal
    stagedWrite: StagedMemoryWrite
    now: string
  }): MemoryApprovalVerificationResult {
    if (input.approval === null || input.approval === undefined) {
      return reject(null, 'approval_missing', 'ExplicitMemoryWriteApproval is missing.')
    }

    if (isExecutionApproval(input.approval)) {
      return reject(null, 'wrong_approval_kind', 'ExplicitExecutionApproval cannot authorize memory writing.')
    }

    const approval = parseMemoryApproval(input.approval)

    if (!approval) {
      return reject(null, 'structural_invalid', 'Approval object is not a structurally valid ExplicitMemoryWriteApproval.')
    }

    if (approval.approvalKind !== 'memory_write') {
      return reject(approval, 'wrong_approval_kind', 'Approval kind is not memory_write.')
    }

    if (approval.approvalText !== EXPLICIT_MEMORY_WRITE_APPROVAL_TEXT) {
      return reject(approval, 'wrong_approval_text', 'Approval text does not exactly match the required memory-write phrase.')
    }

    if (approval.approvedBy !== 'commander') {
      return reject(approval, 'wrong_approver', 'Only commander approval can authorize memory writing.')
    }

    if (Date.parse(approval.expiresAt) <= Date.parse(input.now)) {
      return reject(approval, 'approval_expired', 'Memory write approval has expired.')
    }

    if (approval.consumed) {
      return reject(approval, 'approval_consumed', 'Memory write approval has already been consumed.')
    }

    if (approval.proposalId !== input.proposal.proposalId) {
      return reject(approval, 'proposal_mismatch', 'Approval proposalId does not match the proposal.')
    }

    if (approval.stagedWriteId && approval.stagedWriteId !== input.stagedWrite.stagedWriteId) {
      return reject(approval, 'staged_write_mismatch', 'Approval stagedWriteId does not match the staged write.')
    }

    if (approval.memoryScope !== input.proposal.memoryScope) {
      return reject(approval, 'memory_scope_mismatch', 'Approval memoryScope does not match the proposal scope.')
    }

    if (approval.targetEntityId !== input.proposal.targetEntityId) {
      return reject(approval, 'target_entity_mismatch', 'Approval targetEntityId does not match the proposal target.')
    }

    if (approval.approvedMemoryType !== input.proposal.memoryType) {
      return reject(approval, 'memory_type_mismatch', 'Approval memory type does not match the proposal memory type.')
    }

    if (approval.maxWrites !== 1) {
      return reject(approval, 'max_writes_mismatch', 'Memory write approvals must be single-write only.')
    }

    if (
      approval.allowOverwrite ||
      approval.allowCrossScopeWrite ||
      approval.allowAutoMode ||
      approval.allowProviderAuthoredMemory ||
      approval.allowUnreviewedWrite
    ) {
      return reject(approval, 'unsafe_allow_flag', 'One or more memory approval allow-flags is unsafe.')
    }

    return {
      valid: true,
      approval,
      reason: null,
      message: 'ExplicitMemoryWriteApproval is valid and scope-matched.',
    }
  }
}

export function createMemoryApprovalTokenHash(seed: string): string {
  let hash = 2166136261

  for (const character of seed) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }

  return `memory_approval_${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function createExplicitMemoryWriteApproval(input: {
  approvalId: string
  proposal: MemoryWriteProposal
  stagedWrite: StagedMemoryWrite
  approvedAt: string
  expiresAt: string
  nonce: string
}): ExplicitMemoryWriteApproval {
  return {
    approvalId: input.approvalId,
    proposalId: input.proposal.proposalId,
    stagedWriteId: input.stagedWrite.stagedWriteId,
    approvalKind: 'memory_write',
    approvalText: EXPLICIT_MEMORY_WRITE_APPROVAL_TEXT,
    approvedBy: 'commander',
    approvedAt: input.approvedAt,
    expiresAt: input.expiresAt,
    memoryScope: input.proposal.memoryScope,
    targetEntityId: input.proposal.targetEntityId,
    approvedMemoryType: input.proposal.memoryType,
    maxWrites: 1,
    allowOverwrite: false,
    allowCrossScopeWrite: false,
    allowAutoMode: false,
    allowProviderAuthoredMemory: false,
    allowUnreviewedWrite: false,
    nonce: input.nonce,
    approvalTokenHash: createMemoryApprovalTokenHash(input.nonce),
    consumed: false,
  }
}

export function markMemoryApprovalConsumed(
  approval: ExplicitMemoryWriteApproval
): ExplicitMemoryWriteApproval {
  return {
    ...approval,
    consumed: true,
  }
}

function parseMemoryApproval(input: unknown): ExplicitMemoryWriteApproval | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<ExplicitMemoryWriteApproval>

  if (
    typeof candidate.approvalId !== 'string' ||
    typeof candidate.proposalId !== 'string' ||
    typeof candidate.approvalKind !== 'string' ||
    typeof candidate.approvalText !== 'string' ||
    candidate.approvedBy !== 'commander' ||
    typeof candidate.approvedAt !== 'string' ||
    typeof candidate.expiresAt !== 'string' ||
    typeof candidate.memoryScope !== 'string' ||
    typeof candidate.approvedMemoryType !== 'string' ||
    candidate.maxWrites !== 1 ||
    candidate.allowOverwrite !== false ||
    candidate.allowCrossScopeWrite !== false ||
    candidate.allowAutoMode !== false ||
    candidate.allowProviderAuthoredMemory !== false ||
    candidate.allowUnreviewedWrite !== false ||
    typeof candidate.nonce !== 'string' ||
    typeof candidate.approvalTokenHash !== 'string' ||
    typeof candidate.consumed !== 'boolean'
  ) {
    return null
  }

  return candidate as ExplicitMemoryWriteApproval
}

function isExecutionApproval(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false
  const candidate = input as { approvalType?: unknown }

  return candidate.approvalType === 'single_provider_call'
}

function reject(
  approval: ExplicitMemoryWriteApproval | null,
  reason: MemoryApprovalInvalidReason,
  message: string
): MemoryApprovalVerificationResult {
  return {
    valid: false,
    approval,
    reason,
    message,
  }
}
