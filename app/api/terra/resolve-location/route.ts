import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { parseTerraCoordinates, type TerraLocationResolution } from '@/lib/terra/locationCommand'
import { resolvePlaceNameViaNominatim, reverseResolveCoordinatesViaNominatim } from '@/lib/terra/resolveGeography'
import type { TerraReverseLocationResolution } from '@/lib/terra/activeLocation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra location resolution')
  if (!commander.ok) return commander.response

  const latitudeText = request.nextUrl.searchParams.get('lat')
  const longitudeText = request.nextUrl.searchParams.get('lon')
  if (latitudeText !== null || longitudeText !== null) {
    const latitude = Number(latitudeText)
    const longitude = Number(longitudeText)
    if (latitudeText === null || longitudeText === null || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return NextResponse.json({ status: 'coordinate_only', message: 'Latitude or longitude is missing or outside its valid range.' }, { status: 400 })
    }
    const heightText = request.nextUrl.searchParams.get('height')
    const parsedHeight = heightText === null ? null : Number(heightText)
    const resolution = await reverseResolveCoordinatesViaNominatim({
      latitude,
      longitude,
      height: parsedHeight !== null && Number.isFinite(parsedHeight) ? parsedHeight : null,
      hasTerrainHeight: request.nextUrl.searchParams.get('terrain') === '1',
    })
    return NextResponse.json<TerraReverseLocationResolution>(resolution)
  }

  const command = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (!command) {
    return NextResponse.json<TerraLocationResolution>({ status: 'unresolved', message: 'Enter a place, address, or latitude/longitude.' }, { status: 400 })
  }

  const coordinates = parseTerraCoordinates(command)
  if (coordinates) return NextResponse.json<TerraLocationResolution>({ status: 'resolved', target: coordinates })

  const resolution = await resolvePlaceNameViaNominatim(command, `commander-location:${commander.userId}`)
  if (resolution.quality === 'strong' || resolution.quality === 'exact') {
    return NextResponse.json<TerraLocationResolution>({
      status: 'resolved',
      target: {
        latitude: resolution.latitude,
        longitude: resolution.longitude,
        label: resolution.matchTitle,
        source: 'nominatim',
      },
    })
  }

  return NextResponse.json<TerraLocationResolution>({
    status: resolution.quality,
    message: resolution.quality === 'ambiguous'
      ? 'That command matches multiple locations. Add a city, region, postal code, or country and try again.'
      : ('reason' in resolution ? resolution.reason : 'Location could not be resolved.'),
  })
}
