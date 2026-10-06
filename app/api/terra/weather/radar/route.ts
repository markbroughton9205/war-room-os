import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { loadIemRadarCatalog } from '@/lib/terra/weather/radar/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Public IEM radar frame metadata. Tiles are NOT proxied — Cesium loads IEM TMS directly.
 * Commander session is not required to display public NEXRAD mosaics.
 */
export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra weather radar')
  if (!commander.ok && commander.response.status === 403) return commander.response

  const time = request.nextUrl.searchParams.get('time')
  const mode = request.nextUrl.searchParams.get('mode') === 'historical' ? 'historical' : 'live'
  const parsed = time ? new Date(time) : new Date()
  const when = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  const catalog = await loadIemRadarCatalog(mode === 'historical' ? when : new Date())
  return NextResponse.json({
    tool: 'terra-weather-radar',
    status: catalog.latest ? 'success' : 'error',
    liveClaim: false,
    truthKind: catalog.truthKind,
    timeMode: mode,
    terraTime: when.toISOString(),
    catalog,
  })
}
