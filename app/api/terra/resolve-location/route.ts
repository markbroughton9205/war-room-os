import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { parseTerraCoordinates, type TerraLocationResolution } from '@/lib/terra/locationCommand'
import { resolvePlaceNameViaNominatim } from '@/lib/terra/resolveGeography'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra location resolution')
  if (!commander.ok) return commander.response

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
