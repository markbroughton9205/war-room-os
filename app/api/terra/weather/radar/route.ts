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
export async function GET(_request: NextRequest) {
  const commander = await requireCommanderSession('Terra weather radar')
  if (!commander.ok && commander.response.status === 403) return commander.response

  const catalog = await loadIemRadarCatalog()
  return NextResponse.json({
    tool: 'terra-weather-radar',
    status: catalog.latest ? 'success' : 'error',
    liveClaim: false,
    truthKind: catalog.truthKind,
    catalog,
  })
}
