import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { TERRA_URBAN_LODS, type TerraUrbanLod, type TerraUrbanTileKey } from '@/lib/terra/urbanDetail/types'
import { TERRA_URBAN_TILE_ZOOM, urbanViewportIsFetchable } from '@/lib/terra/urbanDetail/lod'
import { expandBounds, tilesForBounds } from '@/lib/terra/urbanDetail/tiles'
import { emptyUrbanTile, loadUrbanTile, loadUrbanViewport } from '@/lib/terra/urbanDetail/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseLod(raw: string | null): TerraUrbanLod | null {
  if (!raw) return null
  return (TERRA_URBAN_LODS as readonly string[]).includes(raw) ? raw as TerraUrbanLod : null
}

function parseFinite(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra urban geography')
  if (!commander.ok) return commander.response

  const params = request.nextUrl.searchParams
  const lod = parseLod(params.get('lod'))
  if (!lod) {
    return NextResponse.json({ status: 'error', error: 'lod must be city, local, or building.' }, { status: 400 })
  }

  const z = parseFinite(params.get('z'))
  const x = parseFinite(params.get('x'))
  const y = parseFinite(params.get('y'))
  if (z !== null && x !== null && y !== null) {
    if (z !== TERRA_URBAN_TILE_ZOOM[lod] || z < 0 || x < 0 || y < 0) {
      return NextResponse.json({ status: 'error', error: 'Tile z/x/y does not match the requested lod zoom.' }, { status: 400 })
    }
    const tile = await loadUrbanTile({ z, x, y, lod })
    const rateLimited = tile.rateLimited || tile.diagnostics.roads === 'RATE_LIMITED'
    return NextResponse.json({
      status: rateLimited ? 'rate_limited' : tile.diagnostics.roads === 'UNAVAILABLE' && tile.diagnostics.buildings === 'UNAVAILABLE' ? 'unavailable' : tile.fromCache ? 'cached' : 'success',
      tile,
    })
  }

  const west = parseFinite(params.get('west'))
  const south = parseFinite(params.get('south'))
  const east = parseFinite(params.get('east'))
  const north = parseFinite(params.get('north'))
  if (west === null || south === null || east === null || north === null) {
    return NextResponse.json({ status: 'error', error: 'Provide z/x/y or west/south/east/north with lod.' }, { status: 400 })
  }

  const bounds = { west, south, east, north }
  if (!urbanViewportIsFetchable(bounds, lod)) {
    const tile = emptyUrbanTile({ z: TERRA_URBAN_TILE_ZOOM[lod], x: 0, y: 0, lod }, 'UNAVAILABLE', 'Viewport exceeds bounded urban fetch span.')
    return NextResponse.json({ status: 'unavailable', tile })
  }

  const tiles: TerraUrbanTileKey[] = tilesForBounds(expandBounds(bounds), TERRA_URBAN_TILE_ZOOM[lod], lod)
  const tile = await loadUrbanViewport(tiles)
  const unavailable = tile.diagnostics.roads === 'UNAVAILABLE' && (lod === 'city' || tile.diagnostics.buildings === 'UNAVAILABLE')
  const rateLimited = tile.rateLimited || tile.diagnostics.roads === 'RATE_LIMITED' || tile.diagnostics.buildings === 'RATE_LIMITED'
  const stale = tile.diagnostics.roads === 'STALE' || tile.diagnostics.buildings === 'STALE'
  return NextResponse.json({
    status: rateLimited ? 'rate_limited' : unavailable ? 'unavailable' : tile.truncated ? 'degraded' : stale ? 'stale' : tile.fromCache ? 'cached' : 'success',
    tile,
  })
}
