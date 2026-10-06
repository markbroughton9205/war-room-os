import { NextResponse } from 'next/server'
import { lookupCapability } from '@/lib/council/intelligence/capabilityRegistry'
import { GODS_EYE_CAPABILITY_ID, godsEyeCardLabel, resolveGodsEyeRuntimeState } from '@/lib/terra/godsEye/runtimeState'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const state = resolveGodsEyeRuntimeState({
    registered: Boolean(lookupCapability(GODS_EYE_CAPABILITY_ID)),
  })
  return NextResponse.json({
    configured: state.configured,
    registered: state.registered,
    healthy: state.healthy,
    terra_linked: state.terra_linked,
    capability_count: state.capability_count,
    runtime_owner: state.runtime_owner,
    status: state.status,
    failure_reason: state.failure_reason,
    degraded_reason: state.degraded_reason,
    capabilities: state.capabilities,
    data_sources: state.data_sources,
    last_health_check: state.last_health_check,
    label: godsEyeCardLabel(state),
  })
}
