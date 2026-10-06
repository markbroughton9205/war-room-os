import { NextResponse } from 'next/server'
import { lookupCapability } from '@/lib/council/intelligence/capabilityRegistry'
import { collectPersistenceHealth } from '@/lib/war-room/persistenceHealth'
import { GODS_EYE_CAPABILITY_ID, resolveGodsEyeRuntimeState } from '@/lib/terra/godsEye/runtimeState'
import { aggregateWarRoomRuntimeHealth } from '@/lib/runtime/warRoomRuntimeHealth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function probeLocalCore(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:3847/api/local/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return false
    const body = await res.json() as { ok?: boolean; health?: { boot_state?: string } }
    return body.ok === true && body.health?.boot_state === 'CORE_READY'
  } catch {
    return false
  }
}

export async function GET() {
  const persistence = await collectPersistenceHealth()
  const godsEye = resolveGodsEyeRuntimeState({
    registered: Boolean(lookupCapability(GODS_EYE_CAPABILITY_ID)),
  })
  const coreHealthy = await probeLocalCore()
  const health = aggregateWarRoomRuntimeHealth({
    persistence,
    godsEye,
    terraLinked: godsEye.terra_linked,
    coreHealthy,
    uiHealthy: true,
    councilOperational: Boolean(lookupCapability('wr.council.backend')),
  })
  return NextResponse.json({
    health,
    persistence,
    godsEye: {
      configured: godsEye.configured,
      registered: godsEye.registered,
      healthy: godsEye.healthy,
      terra_linked: godsEye.terra_linked,
      capability_count: godsEye.capability_count,
      runtime_owner: godsEye.runtime_owner,
      status: godsEye.status,
      failure_reason: godsEye.failure_reason,
      degraded_reason: godsEye.degraded_reason,
      capabilities: godsEye.capabilities,
      last_health_check: godsEye.last_health_check,
    },
  })
}
