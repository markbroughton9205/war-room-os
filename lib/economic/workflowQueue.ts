import { getEconomicDomain } from '@/lib/economic/domains'
import type {
  EconomicFamily,
  EconomicOperationalDomainId,
  EconomicWorkflowQueueItem,
  EconomicWorkflowType,
} from '@/lib/economic/types'

export type CreateEconomicWorkflowInput = {
  workflow_type?: EconomicWorkflowType
  domain_id: EconomicOperationalDomainId
  assigned_family?: EconomicFamily
  priority?: number
  summary: string
  metadata?: Record<string, unknown>
}

function clampPriority(priority: number | undefined): number {
  if (typeof priority !== 'number' || !Number.isFinite(priority)) return 3
  return Math.min(5, Math.max(1, Math.round(priority)))
}

export function createWorkflowQueueItem(input: CreateEconomicWorkflowInput): EconomicWorkflowQueueItem {
  const domain = getEconomicDomain(input.domain_id)
  const now = new Date().toISOString()

  return {
    id: crypto.randomUUID(),
    workflow_type: input.workflow_type ?? domain.workflowType,
    status: 'pending',
    assigned_family: input.assigned_family ?? domain.providerPriority[0],
    priority: clampPriority(input.priority),
    created_at: now,
    updated_at: now,
    summary: input.summary.trim().slice(0, 1000),
    domain_id: input.domain_id,
    approval_required: true,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  }
}

export function workflowRequiresHumanApproval(item: EconomicWorkflowQueueItem): true {
  if (!item.approval_required) {
    throw new Error(`Workflow is missing human approval gate: ${item.id}`)
  }
  return true
}
