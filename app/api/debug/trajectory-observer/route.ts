import { NextResponse } from 'next/server'
import { assertDebugRouteAuthorized } from '@/lib/security/debugRouteGuard'
import { isTrajectoryObservationEnabled } from '@/lib/modular-intelligence/trajectoryObservationGate'
import { readRuntimeObserverStatus } from '@/lib/modular-intelligence/trajectoryObserverStatus'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const blocked = assertDebugRouteAuthorized(req)
  if (blocked) return blocked
  return NextResponse.json(readRuntimeObserverStatus())
}
