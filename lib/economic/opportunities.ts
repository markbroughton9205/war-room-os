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
  source_provider?: EconomicFamily | 'unknown'
  confidence?: number
  estimated_value?: number | null
  assigned_family?: EconomicFamily
  required_actions?: readonly string[]
  risk_level?: EconomicRiskLevel
  notes?: string
  source_details?: Record<string, unknown>
  dedupe_key?: string
  expires_at?: string | null
  metadata?: Record<string, unknown>
}

export function normalizeOpportunityTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildOpportunityDedupeKey(input: {
  provider: string
  sessionId?: string | null
  decree: string
  title: string
}): string {
  const provider = input.provider.trim().toLowerCase() || 'unknown'
  const session = input.sessionId?.trim() || 'global'
  const decree = normalizeOpportunityTitle(input.decree).slice(0, 120)
  const title = normalizeOpportunityTitle(input.title).slice(0, 160)
  return [provider, session, decree, title].join(':')
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
    source_provider: input.source_provider ?? 'unknown',
    confidence: clampConfidence(input.confidence),
    estimated_value: typeof input.estimated_value === 'number' && Number.isFinite(input.estimated_value)
      ? Math.max(0, input.estimated_value)
      : null,
    assigned_family: assignedFamily,
    required_actions: cleanRequiredActions(input.required_actions),
    risk_level: input.risk_level ?? 'medium',
    notes: (input.notes ?? '').trim().slice(0, 20_000),
    source_details: input.source_details && typeof input.source_details === 'object' ? input.source_details : {},
    status: 'discovered',
    discovered_at: new Date().toISOString(),
    expires_at: input.expires_at ?? null,
    dedupe_key: input.dedupe_key ?? buildOpportunityDedupeKey({
      provider: input.source_provider ?? 'unknown',
      sessionId: null,
      decree: input.source,
      title: input.title,
    }),
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
  if (!opportunity.dedupe_key.trim()) {
    return { ok: false, error: 'Opportunity dedupe key is required.' }
  }
  return { ok: true }
}
