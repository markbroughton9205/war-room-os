import type { EconomicFamily, EconomicProposal, EconomicProposalOutputType } from '@/lib/economic/types'

export type CreateEconomicProposalInput = {
  output_type: EconomicProposalOutputType
  assigned_family: EconomicFamily
  title: string
  body: string
  workflow_id?: string | null
  opportunity_id?: string | null
  metadata?: Record<string, unknown>
}

export function createProposalDraft(input: CreateEconomicProposalInput): EconomicProposal {
  const now = new Date().toISOString()

  return {
    id: crypto.randomUUID(),
    output_type: input.output_type,
    status: 'drafted',
    assigned_family: input.assigned_family,
    workflow_id: input.workflow_id ?? null,
    opportunity_id: input.opportunity_id ?? null,
    title: input.title.trim().slice(0, 300),
    body: input.body.slice(0, 120_000),
    approval_required: true,
    external_use_approved_at: null,
    created_at: now,
    updated_at: now,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  }
}

export function assertProposalExternalUseBlockedUntilApproved(proposal: EconomicProposal): void {
  if (!proposal.approval_required) {
    throw new Error(`Proposal is missing approval gate: ${proposal.id}`)
  }
  if (proposal.status !== 'approved' && proposal.external_use_approved_at) {
    throw new Error(`Proposal has external approval timestamp without approved status: ${proposal.id}`)
  }
}
