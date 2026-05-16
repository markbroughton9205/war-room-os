import type { EconomicFamily } from '@/lib/economic/types'

export type EconomicCompressedResponse = {
  mode: 'economic_ops'
  assigned_family: EconomicFamily
  chat_summary: string
  expandable_reasoning: string
  stored_internally: true
}

export function compressEconomicOpsResponse(input: {
  assignedFamily: EconomicFamily
  opportunityCount: number
  workflowCount: number
  fullProviderAnalysis: string
}): EconomicCompressedResponse {
  const opportunityText = input.opportunityCount === 1 ? '1 opportunity' : `${input.opportunityCount} opportunities`
  const workflowText = input.workflowCount === 1 ? '1 workflow' : `${input.workflowCount} workflows`
  return {
    mode: 'economic_ops',
    assigned_family: input.assignedFamily,
    chat_summary: `${opportunityText} discovered and ${workflowText} prepared for operational review.`,
    expandable_reasoning: input.fullProviderAnalysis.slice(0, 12_000),
    stored_internally: true,
  }
}
