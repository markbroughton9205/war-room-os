import { ApprovalVerifier } from './ApprovalVerifier'
import { ApprovedProviderCallPlanner } from './ApprovedProviderCallPlanner'
import { ExplicitExecutionApprovalFactory } from './ExplicitExecutionApproval'
import { FakeProviderAdapter } from './FakeProviderAdapter'
import { ProviderCallAudit } from './ProviderCallAudit'
import { ProviderCallResultBuilder } from './ProviderCallResultBuilder'
import {
  type ApprovedCallOrchestratorInput,
  type ApprovedCallOrchestratorResult,
} from './types'

export class ApprovedCallOrchestrator {
  private readonly planner: ApprovedProviderCallPlanner
  private readonly verifier: ApprovalVerifier
  private readonly resultBuilder: ProviderCallResultBuilder
  private readonly audit: ProviderCallAudit
  private readonly adapter: FakeProviderAdapter

  constructor(adapter = new FakeProviderAdapter()) {
    this.planner = new ApprovedProviderCallPlanner()
    this.verifier = new ApprovalVerifier()
    this.resultBuilder = new ProviderCallResultBuilder()
    this.audit = new ProviderCallAudit()
    this.adapter = adapter
  }

  run(input: ApprovedCallOrchestratorInput): ApprovedCallOrchestratorResult {
    const createdAt = input.createdAt ?? new Date().toISOString()
    const request = this.planner.createRequest({
      executionPlan: input.executionPlan,
      preview: input.preview,
      prompt: input.prompt,
      systemInstruction: input.systemInstruction,
      providerCandidateId: input.providerCandidateId,
      executionStepId: input.executionStepId,
      createdAt,
    })
    const adapterInvocationCountBefore = this.adapter.getInvocationCount()
    const verification = this.verifier.verify(input.approval, request, createdAt)

    if (!verification.valid) {
      const result = this.resultBuilder.buildBlockedResult(
        request,
        verification,
        createdAt
      )
      const auditRecord = this.audit.createRecord({
        request,
        approval: input.approval,
        result,
        adapterInvocationCountBefore,
        adapterInvocationCountAfter: this.adapter.getInvocationCount(),
        createdAt,
      })

      return {
        request,
        result,
        auditRecord,
        verification,
        consumedApproval: null,
      }
    }

    const consumedApproval = ExplicitExecutionApprovalFactory.markConsumed(
      verification.approval,
      createdAt
    )
    const adapterResult = this.adapter.call(request, createdAt)
    const result = this.resultBuilder.buildAdapterResult(
      request,
      adapterResult,
      createdAt
    )
    const auditRecord = this.audit.createRecord({
      request,
      approval: consumedApproval,
      result,
      adapterInvocationCountBefore,
      adapterInvocationCountAfter: this.adapter.getInvocationCount(),
      createdAt,
    })

    return {
      request,
      result,
      auditRecord,
      verification,
      consumedApproval,
    }
  }

  getFakeAdapterInvocationCount(): number {
    return this.adapter.getInvocationCount()
  }
}
