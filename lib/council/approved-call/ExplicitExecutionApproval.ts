import {
  EXPLICIT_EXECUTION_APPROVAL_TEXT,
  type ApprovalScopeActionType,
  type ExplicitExecutionApproval,
} from './types'

export type CreateExplicitExecutionApprovalInput = {
  approvalId: string
  executionPlanId: string
  previewId: string
  allowedProviderCandidateId: string
  allowedExecutionStepId: string
  approvedAt: string
  expiresAt: string
  approvalTokenSeed: string
  approvalText?: typeof EXPLICIT_EXECUTION_APPROVAL_TEXT
  allowedActionType?: ApprovalScopeActionType
}

export function createApprovalTokenHash(seed: string): string {
  let hash = 2166136261

  for (const character of seed) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }

  return `approval_${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export class ExplicitExecutionApprovalFactory {
  static create(
    input: CreateExplicitExecutionApprovalInput
  ): ExplicitExecutionApproval {
    return {
      approvalId: input.approvalId,
      executionPlanId: input.executionPlanId,
      previewId: input.previewId,
      approvalType: 'single_provider_call',
      approvalText: input.approvalText ?? EXPLICIT_EXECUTION_APPROVAL_TEXT,
      approvedBy: 'commander',
      approvedAt: input.approvedAt,
      expiresAt: input.expiresAt,
      singleUse: true,
      consumedAt: null,
      approvalTokenHash: createApprovalTokenHash(input.approvalTokenSeed),
      approvalScope: {
        allowedProviderCandidateId: input.allowedProviderCandidateId,
        allowedExecutionStepId: input.allowedExecutionStepId,
        allowedActionType: input.allowedActionType ?? 'provider_call',
      },
    }
  }

  static markConsumed(
    approval: ExplicitExecutionApproval,
    consumedAt: string
  ): ExplicitExecutionApproval {
    return {
      ...approval,
      consumedAt,
    }
  }
}
