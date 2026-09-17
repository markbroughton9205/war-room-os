import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { lookupStreetView } from '@/lib/terra/streetView/lookup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseCoord(value: string | null, min: number, max: number): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null
  return parsed
}

/**
 * STREET VIEW coverage lookup. Coordinates only — Nominatim is never required.
 * Lawful Mapillary / Panoramax providers only. Never Google Street View. Never a fabricated panorama.
 */
export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra street view')
  if (!commander.ok && commander.response.status === 403) return commander.response

  const latitude = parseCoord(request.nextUrl.searchParams.get('lat') ?? request.nextUrl.searchParams.get('latitude'), -90, 90)
  const longitude = parseCoord(request.nextUrl.searchParams.get('lon') ?? request.nextUrl.searchParams.get('longitude'), -180, 180)
  const radiusMeters = parseCoord(request.nextUrl.searchParams.get('radiusMeters'), 25, 250)
  if (latitude == null || longitude == null) {
    return NextResponse.json({
      ok: false,
      state: 'UNAVAILABLE',
      items: [],
      nominatimUsed: false,
      googleUsed: false,
      fabricated: false,
      honesty: 'STREET VIEW needs coordinates. Reverse-geocoded address is enrichment only and is not required.',
    }, { status: 400 })
  }

  const result = await lookupStreetView({ latitude, longitude, radiusMeters: radiusMeters ?? undefined })
  return NextResponse.json(result)
}
