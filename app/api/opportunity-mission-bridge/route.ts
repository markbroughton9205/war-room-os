import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { READINESS_STATES } from '@/lib/opportunity-readiness/types'
import {
  BRIDGE_INPUT_LIMITS,
  checkLedgerVerifiedPayment,
  closeMission,
  getMissionRecord,
  markMissionCommanderActive,
  submitMissionReportBack,
  syncMissionAssessment,
  validateOpportunityId,
  validateReportBackInput,
} from '@/lib/opportunity-mission-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function omitOwner<T extends { ownerUserId: string }>(value: T): Omit<T, 'ownerUserId'> {
  const { ownerUserId, ...safe } = value
  void ownerUserId
  return safe
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message, persistence: 'session_only', externalActionsExecuted: false, durableMemoryWritten: false }, { status })
}

/** Read-only fetch of the current session mission record for one opportunity. */
export async function GET(req: Request) {
  const commander = await requireCommanderSession('Commander Opportunity Mission Bridge')
  if (!commander.ok) return commander.response

  const url = new URL(req.url)
  const opportunityId = url.searchParams.get('opportunityId')
  const validated = validateOpportunityId(opportunityId)
  if (!validated.ok) return errorResponse(validated.reason, 400)

  const record = getMissionRecord(commander.userId, validated.value)
  return NextResponse.json({
    persistence: 'session_only',
    externalActionsExecuted: false,
    durableMemoryWritten: false,
    record: record ? omitOwner(record) : null,
  })
}

export async function POST(req: Request) {
  const commander = await requireCommanderSession('Commander Opportunity Mission Bridge')
  if (!commander.ok) return commander.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid JSON body.', 400)
  }
  if (!body || typeof body !== 'object') return errorResponse('Request body must be a JSON object.', 400)
  const b = body as Record<string, unknown>

  if (b.action === 'SYNC_ASSESSMENT') {
    const opportunityId = validateOpportunityId(b.opportunityId)
    if (!opportunityId.ok) return errorResponse(opportunityId.reason, 400)
    if (typeof b.readinessState !== 'string' || !(READINESS_STATES as readonly string[]).includes(b.readinessState)) {
      return errorResponse(`readinessState must be one of ${READINESS_STATES.join(', ')}.`, 400)
    }
    if (typeof b.hasPreparationPath !== 'boolean') return errorResponse('hasPreparationPath must be a boolean.', 400)
    const outcome = syncMissionAssessment(commander.userId, opportunityId.value, b.readinessState as never, b.hasPreparationPath)
    if (!outcome.ok) return errorResponse(outcome.reason, 409)
    return NextResponse.json({ status: 'SYNCED', persistence: 'session_only', externalActionsExecuted: false, durableMemoryWritten: false, record: omitOwner(outcome.record) })
  }

  if (b.action === 'MARK_ACTIVE') {
    const opportunityId = validateOpportunityId(b.opportunityId)
    if (!opportunityId.ok) return errorResponse(opportunityId.reason, 400)
    const outcome = markMissionCommanderActive(commander.userId, opportunityId.value)
    if (!outcome.ok) return errorResponse(outcome.reason, 409)
    return NextResponse.json({ status: 'COMMANDER_ACTIVE', persistence: 'session_only', externalActionsExecuted: false, durableMemoryWritten: false, record: omitOwner(outcome.record) })
  }

  if (b.action === 'REPORT_BACK') {
    if (typeof b.opportunityId === 'string' && b.opportunityId.length > BRIDGE_INPUT_LIMITS.MAX_ID_LENGTH) return errorResponse('opportunityId exceeds the maximum id length.', 400)
    const parsed = validateReportBackInput(b)
    if (!parsed.ok) return errorResponse(parsed.reason, 400)
    const outcome = submitMissionReportBack(commander.userId, parsed.value)
    if (!outcome.ok) return errorResponse(outcome.reason, 409)
    return NextResponse.json({
      status: outcome.record.missionStatus,
      persistence: 'session_only',
      externalActionsExecuted: false,
      durableMemoryWritten: false,
      record: omitOwner(outcome.record),
      note: 'Report-back recorded. Completion does not imply payment; promised pay does not imply received pay; received pay does not imply verified deposit.',
    })
  }

  if (b.action === 'CHECK_LEDGER_PAYMENT') {
    const opportunityId = validateOpportunityId(b.opportunityId)
    if (!opportunityId.ok) return errorResponse(opportunityId.reason, 400)
    const outcome = checkLedgerVerifiedPayment(commander.userId, opportunityId.value)
    if (!outcome.ok) return errorResponse(outcome.reason, 409)
    return NextResponse.json({ status: 'PAYMENT_VERIFIED', persistence: 'session_only', externalActionsExecuted: false, durableMemoryWritten: false, record: omitOwner(outcome.record) })
  }

  if (b.action === 'CLOSE') {
    const opportunityId = validateOpportunityId(b.opportunityId)
    if (!opportunityId.ok) return errorResponse(opportunityId.reason, 400)
    const outcome = closeMission(commander.userId, opportunityId.value)
    if (!outcome.ok) return errorResponse(outcome.reason, 409)
    return NextResponse.json({ status: 'CLOSED', persistence: 'session_only', externalActionsExecuted: false, durableMemoryWritten: false, record: omitOwner(outcome.record) })
  }

  return errorResponse('Unsupported mission-bridge action.', 400)
}
