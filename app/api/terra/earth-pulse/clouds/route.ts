import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { loadEarthPulseCloudCatalog } from '@/lib/terra/earthPulse/clouds'
import { CLOUD_SOURCE } from '@/lib/terra/earthPulse/sources'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra Earth Pulse clouds')
  if (!commander.ok && commander.response.status === 403) return commander.response

  const terraTime = request.nextUrl.searchParams.get('time') || new Date().toISOString()
  const timeMode = request.nextUrl.searchParams.get('mode') === 'historical' ? 'historical' : 'live'
  const catalog = await loadEarthPulseCloudCatalog({ terraTime, timeMode })
  return NextResponse.json({
    tool: 'terra-earth-pulse-clouds',
    status: catalog.frames.length ? 'success' : 'error',
    liveClaim: catalog.truthState === 'LIVE',
    source: CLOUD_SOURCE,
    catalog,
  })
}
