import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { probeRadarEcho } from '@/lib/terra/weather/radar/echoProbe'
import { viewIntersectsRadarCoverage } from '@/lib/terra/weather/radar/coverage'
import { radarCoverageFit } from '@/lib/terra/weather/radar/presentation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const USER_AGENT = 'WarRoomOS-Terra/1.0 (weather-radar@warroom.internal; +https://mesonet.agron.iastate.edu/ogc/)'

function finiteParam(request: NextRequest, key: string): number | null {
  const raw = request.nextUrl.searchParams.get(key)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * Measures whether the published mosaic carries any reflectivity over the requested view so Terra
 * can distinguish NO_PRECIP (measured, nothing there) from NO_DATA (nothing measured).
 * Tiles are read and discarded; nothing is cached, re-hosted or archived.
 */
export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra radar echo probe')
  if (!commander.ok && commander.response.status === 403) return commander.response

  const stamp = request.nextUrl.searchParams.get('stamp')
  if (!stamp || !/^\d{12}$/.test(stamp)) {
    return NextResponse.json({
      tool: 'terra-weather-radar-echo',
      status: 'error',
      error: 'A 12-digit IEM frame stamp is required.',
    }, { status: 400 })
  }

  const west = finiteParam(request, 'west')
  const south = finiteParam(request, 'south')
  const east = finiteParam(request, 'east')
  const north = finiteParam(request, 'north')
  if (west === null || south === null || east === null || north === null) {
    return NextResponse.json({
      tool: 'terra-weather-radar-echo',
      status: 'error',
      error: 'west, south, east and north are required.',
    }, { status: 400 })
  }

  const view = { west, south, east, north }
  if (!viewIntersectsRadarCoverage(view)) {
    return NextResponse.json({
      tool: 'terra-weather-radar-echo',
      status: 'success',
      truthKind: 'MEASURED',
      coverageFit: 'NONE',
      probe: {
        echoFraction: null,
        tilesRequested: 0,
        tilesMeasured: 0,
        pixelsMeasured: 0,
        echoPixels: 0,
        frameStamp: stamp,
        note: 'View is outside the radar mosaic domain; no tiles were requested.',
      },
    })
  }

  const probe = await probeRadarEcho({ iemStamp: stamp, view, userAgent: USER_AGENT })
  return NextResponse.json({
    tool: 'terra-weather-radar-echo',
    status: 'success',
    truthKind: 'MEASURED',
    coverageFit: radarCoverageFit(view),
    probe,
  })
}
