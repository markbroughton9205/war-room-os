import { NextResponse } from 'next/server'

import { buildEngineControlStatusResponse, collectEngineStatuses } from '@/lib/engine-control/status'
import { buildToolRoutingSnapshotFromOrigin, requestOriginFromHeaders } from '@/lib/engine-control/tool-snapshot'
import type { EngineControlStatusResponse } from '@/lib/engine-control/types'
import { normalizeEngineControlPayload } from '@/lib/runtime/canonicalStatus'

export const dynamic = 'force-dynamic'

function sanitizeReason(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Engine status collection failed.'
  return message.replace(/\b(sk-|api[_-]?key|bearer|token|password|secret)\S*/gi, '[redacted]').slice(0, 240)
}

function emptyEngineControlPayload(reason: string, timestamp = new Date().toISOString()): EngineControlStatusResponse {
  return normalizeEngineControlPayload({
    engines: [],
    configuredProviders: [],
    reachableProviders: [],
    functionalProviders: [],
    routingReadiness: 'unavailable',
    approvalRequired: true,
    timestamp,
    checkedAt: timestamp,
    degradedReason: reason,
  }, timestamp)
}

export async function GET() {
  const timestamp = new Date().toISOString()
  try {
    const origin = await requestOriginFromHeaders()
    const tools = await buildToolRoutingSnapshotFromOrigin(origin)
    const engines = await collectEngineStatuses(tools)
    const payload = normalizeEngineControlPayload(buildEngineControlStatusResponse(engines), timestamp)
    return NextResponse.json(payload, {
      headers: {
        'cache-control': 'no-store',
        'x-war-room-engine-control': payload.routingReadiness,
      },
    })
  } catch (error) {
    const reason = sanitizeReason(error)
    const payload = emptyEngineControlPayload(reason, timestamp)
    return NextResponse.json(payload, {
      status: 503,
      headers: {
        'cache-control': 'no-store',
        'x-war-room-engine-control': 'unavailable',
      },
    })
  }
}
