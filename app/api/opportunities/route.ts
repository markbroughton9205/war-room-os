import { NextResponse } from 'next/server'
import { priorProviderPacketsInThread } from '@/lib/council-routing/threadContext'
import { loadCouncilThreadFromStore } from '@/lib/cognitive-bus/persistence'
import type { OperatorOpportunityFilterId, ScoutOpportunity } from '@/lib/opportunities/schema'
import type { OperatorOpportunityFilters } from '@/lib/opportunities/filters'
import { collectOpportunitiesFromBusPackets, listScoutOpportunities, setOpportunityApproval } from '@/lib/opportunities/store'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FILTER_IDS: OperatorOpportunityFilterId[] = [
  'under500',
  'recurring',
  'local',
  'remote',
  'ai-based',
  'logistics-aligned',
  'passive',
  'service-based',
]

function parseFilters(url: URL): OperatorOpportunityFilters {
  const filters: OperatorOpportunityFilters = {}
  for (const id of FILTER_IDS) {
    const raw = url.searchParams.get(id)
    if (raw === '1' || raw === 'true') filters[id] = true
  }
  return filters
}

function sortOpportunities(rows: ScoutOpportunity[], sort: string): ScoutOpportunity[] {
  const copy = [...rows]
  switch (sort) {
    case 'confidence':
      return copy.sort((a, b) => b.confidence - a.confidence)
    case 'startupCost':
      return copy.sort((a, b) => a.startupCost.localeCompare(b.startupCost))
    case 'roi':
      return copy.sort((a, b) => (b.estimatedRoi ?? 0) - (a.estimatedRoi ?? 0))
    case 'title':
      return copy.sort((a, b) => a.opportunityTitle.localeCompare(b.opportunityTitle))
    default:
      return copy.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const threadId = (url.searchParams.get('threadId') ?? '').trim()
  const sort = (url.searchParams.get('sort') ?? 'generatedAt').trim()
  const filters = parseFilters(url)
  const sup = tryWarRoomSupabase()

  if (threadId && sup.ok) {
    await loadCouncilThreadFromStore(sup.client, threadId).catch(() => undefined)
    const packets = priorProviderPacketsInThread(threadId)
    collectOpportunitiesFromBusPackets(
      packets.map(packet => ({ family: packet.family, opportunities: packet.opportunities ?? [] })),
      threadId,
      false,
    )
  }

  const opportunities = sortOpportunities(
    listScoutOpportunities({
      threadId: threadId || undefined,
      filters,
    }),
    sort,
  )

  return NextResponse.json({
    ok: true,
    threadId: threadId || null,
    sort,
    filters,
    opportunities,
    commanderNote: 'Opportunities remain PROPOSED until Commander approval; no autonomous execution.',
  })
}

export async function PATCH(req: Request) {
  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const action = typeof body.action === 'string' ? body.action.trim() : ''
  if (!id || !action) {
    return NextResponse.json({ ok: false, error: 'id and action required' }, { status: 400 })
  }

  const approvalStatus =
    action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : null
  if (!approvalStatus) {
    return NextResponse.json({ ok: false, error: 'action must be approve or reject' }, { status: 400 })
  }

  const updated = setOpportunityApproval(id, approvalStatus)
  if (!updated) {
    return NextResponse.json({ ok: false, error: 'opportunity not found' }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    opportunity: updated,
    externalExecution: false,
  })
}
