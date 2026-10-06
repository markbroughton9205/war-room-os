import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { loadNightLightsCatalog } from '@/lib/terra/earthPulse/nightLights'
import { NIGHT_LIGHTS_ARCHIVE_SOURCE, NIGHT_LIGHTS_DAILY_SOURCE } from '@/lib/terra/earthPulse/sources'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra Earth Pulse night lights')
  if (!commander.ok && commander.response.status === 403) return commander.response

  const terraTime = request.nextUrl.searchParams.get('time') || new Date().toISOString()
  const night = await loadNightLightsCatalog(terraTime)
  return NextResponse.json({
    tool: 'terra-earth-pulse-night-lights',
    status: 'success',
    liveClaim: false,
    source: night.mode === 'DAILY' ? NIGHT_LIGHTS_DAILY_SOURCE : NIGHT_LIGHTS_ARCHIVE_SOURCE,
    night,
  })
}
