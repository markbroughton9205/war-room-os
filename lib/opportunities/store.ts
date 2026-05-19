import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { computeEstimatedRoi, inferOpportunityFilterTags, matchesOperatorFilters } from '@/lib/opportunities/filters'
import { resolveOpportunityEvidenceLabel } from '@/lib/opportunities/degradedMode'
import type {
  OpportunityApprovalStatus,
  OpportunityPacket,
  ScoutOpportunity,
} from '@/lib/opportunities/schema'
import type { OperatorOpportunityFilters } from '@/lib/opportunities/filters'

const globalOpportunities: ScoutOpportunity[] = []
const MAX_PER_THREAD = 120
const MAX_GLOBAL = 500

function newId(family: string): string {
  return `opp_${family}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export function registerScoutOpportunities(input: {
  threadId: string
  family: CouncilOrchestrationFamily
  providerId?: string
  packets: OpportunityPacket[]
  liveSignalsAvailable: boolean
}): ScoutOpportunity[] {
  const label = resolveOpportunityEvidenceLabel(input.liveSignalsAvailable)
  const created: ScoutOpportunity[] = input.packets.map(packet => ({
    ...packet,
    id: newId(input.family),
    threadId: input.threadId,
    family: input.family,
    providerId: input.providerId ?? input.family,
    evidenceLabel: label,
    approvalStatus: 'PROPOSED',
    filterTags: inferOpportunityFilterTags(packet),
    estimatedRoi: computeEstimatedRoi(packet),
    generatedAt: new Date().toISOString(),
  }))

  for (const item of created) {
    globalOpportunities.unshift(item)
  }

  let threadCount = globalOpportunities.filter(o => o.threadId === input.threadId).length
  if (threadCount > MAX_PER_THREAD) {
    let toRemove = threadCount - MAX_PER_THREAD
    for (let i = globalOpportunities.length - 1; i >= 0 && toRemove > 0; i -= 1) {
      if (globalOpportunities[i]?.threadId === input.threadId) {
        globalOpportunities.splice(i, 1)
        toRemove -= 1
        threadCount -= 1
      }
    }
  }
  if (globalOpportunities.length > MAX_GLOBAL) {
    globalOpportunities.splice(MAX_GLOBAL)
  }

  return created
}

export function listScoutOpportunities(opts?: {
  threadId?: string
  filters?: OperatorOpportunityFilters
  family?: CouncilOrchestrationFamily
  approvalStatus?: OpportunityApprovalStatus
}): ScoutOpportunity[] {
  let rows = [...globalOpportunities]
  if (opts?.threadId) rows = rows.filter(o => o.threadId === opts.threadId)
  if (opts?.family) rows = rows.filter(o => o.family === opts.family)
  if (opts?.approvalStatus) rows = rows.filter(o => o.approvalStatus === opts.approvalStatus)
  if (opts?.filters) rows = rows.filter(o => matchesOperatorFilters(o, opts.filters!))
  return rows
}

export function setOpportunityApproval(
  id: string,
  approvalStatus: OpportunityApprovalStatus,
): ScoutOpportunity | null {
  const row = globalOpportunities.find(o => o.id === id)
  if (!row) return null
  row.approvalStatus = approvalStatus
  return row
}

export function collectOpportunitiesFromBusPackets(
  packets: { family: CouncilOrchestrationFamily; opportunities?: OpportunityPacket[] }[],
  threadId: string,
  liveSignalsAvailable: boolean,
): ScoutOpportunity[] {
  const out: ScoutOpportunity[] = []
  for (const packet of packets) {
    if (!packet.opportunities?.length) continue
    out.push(
      ...registerScoutOpportunities({
        threadId,
        family: packet.family,
        packets: packet.opportunities,
        liveSignalsAvailable,
      }),
    )
  }
  return out
}
