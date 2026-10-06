import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { loadEarthPulseEngine } from '@/lib/terra/earthPulse/engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra Earth Pulse')
  if (!commander.ok && commander.response.status === 403) return commander.response

  const terraTime = request.nextUrl.searchParams.get('time') || new Date().toISOString()
  const timeMode = request.nextUrl.searchParams.get('mode') === 'historical' ? 'historical' : 'live'
  const engine = await loadEarthPulseEngine({ terraTime, timeMode })
  return NextResponse.json({
    tool: 'terra-earth-pulse',
    status: 'success',
    liveClaim: false,
    engine,
  })
}
