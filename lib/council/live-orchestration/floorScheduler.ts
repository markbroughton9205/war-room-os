import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { DEFAULT_VISIBLE_FLOOR_ORDER, type CouncilParticipantState } from './types'

export type FloorParticipant = {
  family: CouncilOrchestrationFamily
  state: CouncilParticipantState
  configured: boolean
}

export type FloorSnapshot = {
  active: CouncilOrchestrationFamily[]
  current: CouncilOrchestrationFamily | null
  waiting: CouncilOrchestrationFamily[]
  completed: CouncilOrchestrationFamily[]
  failed: CouncilOrchestrationFamily[]
  skipped: CouncilOrchestrationFamily[]
}

export function resolveVisibleFloorOrder(input: {
  configured: Partial<Record<CouncilOrchestrationFamily, boolean>>
  includeRedTeam?: boolean
  includeKimi?: boolean
}): CouncilOrchestrationFamily[] {
  const order = [...DEFAULT_VISIBLE_FLOOR_ORDER]
  if (input.includeKimi) {
    const redIdx = order.indexOf('red_team')
    order.splice(redIdx >= 0 ? redIdx : order.length, 0, 'kimi')
  }
  return order.filter(family => {
    if (family === 'red_team' && input.includeRedTeam === false) return false
    return input.configured[family] !== false
  })
}

export function snapshotFloor(participants: FloorParticipant[]): FloorSnapshot {
  const active = participants.filter(p => p.configured && p.state !== 'SKIPPED').map(p => p.family)
  const current = participants.find(p =>
    p.state === 'FLOOR_GRANTED' || p.state === 'CONNECTING' || p.state === 'STREAMING' || p.state === 'RETRYING',
  )?.family ?? null
  return {
    active,
    current,
    waiting: participants.filter(p => p.state === 'WAITING' || p.state === 'PENDING').map(p => p.family),
    completed: participants.filter(p => p.state === 'COMPLETE' || p.state === 'PARTIAL').map(p => p.family),
    failed: participants.filter(p => p.state === 'FAILED').map(p => p.family),
    skipped: participants.filter(p => p.state === 'SKIPPED').map(p => p.family),
  }
}

export function nextEligibleFloor(participants: FloorParticipant[]): CouncilOrchestrationFamily | null {
  const granted = participants.find(p =>
    p.configured && (p.state === 'FLOOR_GRANTED' || p.state === 'CONNECTING' || p.state === 'STREAMING' || p.state === 'RETRYING'),
  )
  if (granted) return granted.family
  return participants.find(p => p.configured && (p.state === 'PENDING' || p.state === 'WAITING'))?.family ?? null
}

export function visibleConcurrentFamilies(snapshot: FloorSnapshot): number {
  return snapshot.current ? 1 : 0
}
