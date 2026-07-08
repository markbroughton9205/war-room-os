import {
  type ApprovedProviderCallRequest,
  type ExplicitExecutionApproval,
  type ProviderCallAuditRecord,
  type ProviderCallResult,
} from './types'

export type ProviderCallAuditInput = {
  request: ApprovedProviderCallRequest | null
  approval: ExplicitExecutionApproval | null
  result: ProviderCallResult
  adapterInvocationCountBefore: number
  adapterInvocationCountAfter: number
  createdAt: string
}

export class ProviderCallAudit {
  createRecord(input: ProviderCallAuditInput): ProviderCallAuditRecord {
    const request = input.request

    return {
      auditId: `audit_${input.result.resultId}`,
      requestId: request?.requestId ?? null,
      approvalId: input.approval?.approvalId ?? null,
      executionPlanId:
        request?.executionPlanId ?? input.approval?.executionPlanId ?? 'execution_plan_unknown',
      previewId: request?.previewId ?? input.approval?.previewId ?? 'preview_unknown',
      providerCandidateId: request?.providerCandidateId ?? null,
      executionStepId: request?.executionStepId ?? null,
      status: input.result.status,
      approvalConsumed: input.result.approvalConsumed,
      adapterCalled:
        input.adapterInvocationCountAfter > input.adapterInvocationCountBefore,
      adapterInvocationCountBefore: input.adapterInvocationCountBefore,
      adapterInvocationCountAfter: input.adapterInvocationCountAfter,
      blockedReason: input.result.blockedReason,
      notes: this.createNotes(input),
      createdAt: input.createdAt,
    }
  }

  private createNotes(input: ProviderCallAuditInput): string[] {
    const baseNotes = [
      '46G fake adapter only.',
      'No real provider call, tool call, database mutation, repo mutation, message send, deployment, or Auto Mode action was attempted.',
    ]
    const invocationNote =
      input.result.status === 'blocked'
        ? 'Call was blocked before adapter invocation; approval remains unconsumed.'
        : 'Fake adapter invocation began; approval is consumed for single-use containment.'
    const multipleInvocationNote =
      input.adapterInvocationCountAfter - input.adapterInvocationCountBefore > 1
        ? ['Unexpected multiple adapter invocations detected.']
        : []

    return [...baseNotes, invocationNote, ...multipleInvocationNote]
  }
}
