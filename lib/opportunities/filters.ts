import type { OperatorOpportunityFilterId, OpportunityPacket, ScoutOpportunity } from '@/lib/opportunities/schema'

function parseUsdAmount(text: string): number | null {
  const normalized = text.toLowerCase().replace(/,/g, '')
  const match = normalized.match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m)?/)
  if (!match) return null
  let value = Number(match[1])
  if (!Number.isFinite(value)) return null
  if (match[2] === 'k') value *= 1000
  if (match[2] === 'm') value *= 1_000_000
  return value
}

function haystack(packet: OpportunityPacket): string {
  return [
    packet.opportunityTitle,
    packet.startupCost,
    packet.estimatedRevenue,
    packet.targetCustomer,
    packet.whyNow,
    packet.toolsRequired.join(' '),
    packet.risks.join(' '),
  ]
    .join(' ')
    .toLowerCase()
}

export function inferOpportunityFilterTags(packet: OpportunityPacket): OperatorOpportunityFilterId[] {
  const text = haystack(packet)
  const tags: OperatorOpportunityFilterId[] = []
  const startupUsd = parseUsdAmount(packet.startupCost)
  if (startupUsd !== null && startupUsd <= 500) tags.push('under500')
  if (/\b(recurring|subscription|mrr|retainer|monthly)\b/i.test(text)) tags.push('recurring')
  if (/\b(local|city|neighborhood|regional|nearby)\b/i.test(text)) tags.push('local')
  if (/\b(remote|online|virtual|distributed)\b/i.test(text)) tags.push('remote')
  if (/\b(ai|llm|automation|agent|model)\b/i.test(text)) tags.push('ai-based')
  if (/\b(freight|logistics|shipping|carrier|dispatch|trucking)\b/i.test(text)) tags.push('logistics-aligned')
  if (/\b(passive|hands-off|low-touch)\b/i.test(text)) tags.push('passive')
  if (/\b(service|consulting|agency|done-for-you)\b/i.test(text)) tags.push('service-based')
  return tags
}

export function computeEstimatedRoi(packet: OpportunityPacket): number | null {
  const cost = parseUsdAmount(packet.startupCost)
  const revenue = parseUsdAmount(packet.estimatedRevenue)
  if (cost === null || revenue === null || cost <= 0) return null
  return Math.round((revenue / cost) * 100) / 100
}

export type OperatorOpportunityFilters = Partial<Record<OperatorOpportunityFilterId, boolean>>

export function matchesOperatorFilters(
  opportunity: ScoutOpportunity,
  filters: OperatorOpportunityFilters,
): boolean {
  const active = (Object.entries(filters) as [OperatorOpportunityFilterId, boolean | undefined][])
    .filter(([, enabled]) => enabled === true)
    .map(([id]) => id)
  if (!active.length) return true
  return active.every(id => opportunity.filterTags.includes(id))
}
