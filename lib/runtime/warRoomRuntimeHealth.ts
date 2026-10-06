/**
 * Top-level War Room runtime health.
 * NOMINAL requires every required dependency to be healthy.
 * God's Eye is optional: it is surfaced, and it does not by itself block NOMINAL.
 * Persistence is required for normal Council mode.
 */
import type { PersistenceHealth, PersistenceHealthStatus } from '@/lib/war-room/persistenceHealth'
import type { GodsEyeRuntimeState, GodsEyeRuntimeStatus } from '@/lib/terra/godsEye/runtimeState'

export const WAR_ROOM_RUNTIME_STATUSES = ['NOMINAL', 'DEGRADED', 'BLOCKED', 'STARTING'] as const
export type WarRoomRuntimeStatus = (typeof WAR_ROOM_RUNTIME_STATUSES)[number]

export type RuntimeDependency = {
  id: 'core' | 'ui' | 'council' | 'persistence' | 'terra' | 'gods_eye' | 'browser_broker'
  required: boolean
  status: string
}

export type WarRoomRuntimeHealth = {
  status: WarRoomRuntimeStatus
  dependencies: RuntimeDependency[]
  persistence: PersistenceHealth | null
  gods_eye: GodsEyeRuntimeState | null
  nominal_requires: string[]
  optional: string[]
}

export type WarRoomRuntimeHealthInput = {
  persistence: PersistenceHealth | null
  godsEye: GodsEyeRuntimeState | null
  coreHealthy?: boolean | null
  uiHealthy?: boolean | null
  councilOperational?: boolean | null
  terraLinked?: boolean | null
  browserBrokerReady?: boolean | null
  starting?: boolean
}

const REQUIRED = ['core', 'ui', 'council', 'persistence'] as const
const OPTIONAL = ['terra', 'gods_eye', 'browser_broker'] as const

function persistenceBlocks(status: PersistenceHealthStatus | null): boolean {
  return status !== 'HEALTHY'
}

export function aggregateWarRoomRuntimeHealth(input: WarRoomRuntimeHealthInput): WarRoomRuntimeHealth {
  const dependencies: RuntimeDependency[] = [
    { id: 'core', required: true, status: input.coreHealthy == null ? 'UNKNOWN' : input.coreHealthy ? 'HEALTHY' : 'UNAVAILABLE' },
    { id: 'ui', required: true, status: input.uiHealthy == null ? 'UNKNOWN' : input.uiHealthy ? 'HEALTHY' : 'UNAVAILABLE' },
    { id: 'council', required: true, status: input.councilOperational == null ? 'UNKNOWN' : input.councilOperational ? 'HEALTHY' : 'DEGRADED' },
    { id: 'persistence', required: true, status: input.persistence?.status ?? 'UNKNOWN' },
    { id: 'terra', required: false, status: input.terraLinked == null ? 'UNKNOWN' : input.terraLinked ? 'HEALTHY' : 'DEGRADED' },
    { id: 'gods_eye', required: false, status: input.godsEye?.status ?? 'UNKNOWN' },
    { id: 'browser_broker', required: false, status: input.browserBrokerReady == null ? 'UNKNOWN' : input.browserBrokerReady ? 'HEALTHY' : 'DEGRADED' },
  ]

  const knownRequired = dependencies.filter(row => row.required && row.status !== 'UNKNOWN')
  const persistenceDown = persistenceBlocks(input.persistence?.status ?? null)
  const criticalDown = input.coreHealthy === false || input.uiHealthy === false
  let status: WarRoomRuntimeStatus = 'NOMINAL'
  if (input.starting || !input.persistence) status = 'STARTING'
  else if (criticalDown) status = 'BLOCKED'
  else if (persistenceDown || knownRequired.some(row => row.status !== 'HEALTHY')) status = 'DEGRADED'
  else if (knownRequired.length === 0) status = 'STARTING'

  return {
    status,
    dependencies,
    persistence: input.persistence,
    gods_eye: input.godsEye,
    nominal_requires: [...REQUIRED],
    optional: [...OPTIONAL],
  }
}

export function systemsLabelForRuntime(input: {
  councilOffline: boolean
  systemsOk: boolean
  persistenceStatus: PersistenceHealthStatus | null
  aggregate?: WarRoomRuntimeStatus | null
}): { label: string; tone: 'nominal' | 'active' | 'degraded' | 'offline' } {
  if (input.councilOffline) return { label: 'OFFLINE', tone: 'offline' }
  if (input.aggregate === 'BLOCKED') return { label: 'BLOCKED', tone: 'offline' }
  if (input.aggregate === 'STARTING' || input.persistenceStatus == null) return { label: 'STARTING', tone: 'active' }
  if (input.persistenceStatus !== 'HEALTHY' || input.aggregate === 'DEGRADED' || !input.systemsOk) {
    return { label: 'DEGRADED', tone: 'degraded' }
  }
  return { label: 'NOMINAL', tone: 'nominal' }
}

export type { GodsEyeRuntimeStatus }
