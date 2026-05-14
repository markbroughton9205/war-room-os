export const WAR_ROOM_EVENT_TYPES = [
  'command.received',
  'command.routed',
  'action.created',
  'action.auto_approved',
  'action.approval_required',
  'action.completed',
  'action.failed',
  'internet.query.started',
  'internet.query.completed',
  'repo.status.checked',
  'diff.preview.created',
  'rollback.checkpoint.created',
  'deployment.status.checked',
  'red_sentinel.scan.started',
  'red_sentinel.scan.completed',
  'income.opportunity.discovered',
  'income.opportunity.reviewed',
  'income.opportunity.assigned',
  'income.deposit.expected',
  'income.deposit.proof_submitted',
  'income.deposit.confirmed',
  'income.deposit.notified',
  'memory.proposal.created',
  'audit.logged',
] as const

export type WarRoomEventType = (typeof WAR_ROOM_EVENT_TYPES)[number]

export type WarRoomEventSource = 'system' | 'user' | 'worker'

export type WarRoomEvent = {
  id: string
  type: WarRoomEventType
  createdAt: string
  payload: Record<string, unknown>
  correlationId?: string
  source: WarRoomEventSource
}

export function isWarRoomEventType(value: string): value is WarRoomEventType {
  return (WAR_ROOM_EVENT_TYPES as readonly string[]).includes(value)
}
