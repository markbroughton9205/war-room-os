import { getEconomicDomain } from '@/lib/economic/domains'
import type {
  EconomicFamily,
  EconomicOperationalDomainId,
  EconomicOpportunity,
  EconomicRiskLevel,
} from '@/lib/economic/types'

export type CreateEconomicOpportunityInput = {
  title: string
  category: EconomicOperationalDomainId
  source: string
  confidence?: number
  estimated_value?: number | null
  assigned_family?: EconomicFamily
  required_actions?: readonly string[]
  risk_level?: EconomicRiskLevel
  expires_at?: string | null
  metadata?: Record<string, unknown>
}

function clampConfidence(confidence: number | undefined): number {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return 0.5
  return Math.min(1, Math.max(0, confidence))
}

function cleanRequiredActions(actions: readonly string[] | undefined): string[] {
  return (actions ?? ['human_review'])
    .map(action => action.trim())
    .filter(Boolean)
    .slice(0, 20)
}

export function createOpportunityDraft(input: CreateEconomicOpportunityInput): EconomicOpportunity {
  const domain = getEconomicDomain(input.category)
  const assignedFamily = input.assigned_family ?? domain.providerPriority[0]

  return {
    id: crypto.randomUUID(),
    title: input.title.trim().slice(0, 300),
    category: input.category,
    source: input.source.trim().slice(0, 500),
    confidence: clampConfidence(input.confidence),
    estimated_value: typeof input.estimated_value === 'number' && Number.isFinite(input.estimated_value)
      ? Math.max(0, input.estimated_value)
      : null,
    assigned_family: assignedFamily,
    required_actions: cleanRequiredActions(input.required_actions),
    risk_level: input.risk_level ?? 'medium',
    status: 'discovered',
    discovered_at: new Date().toISOString(),
    expires_at: input.expires_at ?? null,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  }
}

export function validateOpportunity(opportunity: EconomicOpportunity): { ok: true } | { ok: false; error: string } {
  if (!opportunity.title.trim()) return { ok: false, error: 'Opportunity title is required.' }
  if (!opportunity.source.trim()) return { ok: false, error: 'Opportunity source is required.' }
  if (opportunity.confidence < 0 || opportunity.confidence > 1) {
    return { ok: false, error: 'Opportunity confidence must be between 0 and 1.' }
  }
  if (!opportunity.required_actions.length) {
    return { ok: false, error: 'At least one required action is required.' }
  }
  return { ok: true }
}
