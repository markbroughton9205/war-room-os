export const WAR_ROOM_ACTION_STATUSES = [
  'requested',
  'planned',
  'routed',
  'waiting_approval',
  'approved',
  'executing',
  'qa_check',
  'completed',
  'failed',
  'rollback_available',
  'rolled_back',
  'deferred',
  'archived',
] as const

export type WarRoomActionStatus = (typeof WAR_ROOM_ACTION_STATUSES)[number]

export function isWarRoomActionStatus(value: string): value is WarRoomActionStatus {
  return (WAR_ROOM_ACTION_STATUSES as readonly string[]).includes(value)
}

export const APPROVAL_REQUIRED_STATUSES: WarRoomActionStatus[] = ['approved', 'executing']
