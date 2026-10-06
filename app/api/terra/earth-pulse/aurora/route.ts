import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { loadOvationAurora } from '@/lib/terra/earthPulse/aurora'
import { OVATION_SOURCE } from '@/lib/terra/earthPulse/sources'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra Earth Pulse aurora')
  if (!commander.ok && commander.response.status === 403) return commander.response

  const terraTime = request.nextUrl.searchParams.get('time') || new Date().toISOString()
  const timeMode = request.nextUrl.searchParams.get('mode') === 'historical' ? 'historical' : 'live'
  const aurora = await loadOvationAurora({ terraTime, timeMode })
  return NextResponse.json({
    tool: 'terra-earth-pulse-aurora',
    status: aurora.error && !aurora.cells.length ? 'error' : 'success',
    liveClaim: aurora.truthState === 'LIVE',
    source: OVATION_SOURCE,
    aurora,
  })
}
