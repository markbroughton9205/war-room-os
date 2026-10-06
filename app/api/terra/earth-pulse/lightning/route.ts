import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { loadGlmLightning } from '@/lib/terra/earthPulse/lightning'
import { GLM_SOURCE } from '@/lib/terra/earthPulse/sources'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra Earth Pulse lightning')
  if (!commander.ok && commander.response.status === 403) return commander.response

  const terraTime = request.nextUrl.searchParams.get('time') || new Date().toISOString()
  const timeMode = request.nextUrl.searchParams.get('mode') === 'historical' ? 'historical' : 'live'
  const lightning = await loadGlmLightning({ terraTime, timeMode })
  return NextResponse.json({
    tool: 'terra-earth-pulse-lightning',
    status: lightning.flashes.length || lightning.truthState === 'NO_COVERAGE' ? 'success' : (lightning.error ? 'error' : 'success'),
    liveClaim: lightning.truthState === 'LIVE',
    source: GLM_SOURCE,
    lightning,
  })
}
