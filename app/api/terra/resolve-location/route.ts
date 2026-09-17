import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { parseTerraCoordinates, type TerraLocationResolution, looksLikePostalCode } from '@/lib/terra/locationCommand'
import { reverseResolveCoordinatesViaNominatim } from '@/lib/terra/resolveGeography'
import { resolveCommanderPlaceSearch } from '@/lib/terra/geocodeSearchPolicy'
import type { TerraReverseLocationResolution } from '@/lib/terra/activeLocation'
import { formatPlaceDisplayLabel } from '@/lib/terra/liveIntelLanguage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra location resolution')
  let requestedBy = 'terra-public-geocode'
  if (commander.ok) {
    requestedBy = commander.userId
  } else if (commander.response.status === 403) {
    return commander.response
  }

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

  const resolution = await resolveCommanderPlaceSearch(command, `commander-location:${requestedBy}`)
  const source = resolution.resolverProviderId === 'open_meteo'
    ? 'open_meteo' as const
    : resolution.resolverProviderId === 'geonames'
      ? 'geonames' as const
      : 'nominatim' as const
  if (resolution.quality === 'strong' || resolution.quality === 'exact') {
    return NextResponse.json<TerraLocationResolution>({
      status: 'resolved',
      target: {
        latitude: resolution.latitude,
        longitude: resolution.longitude,
        query: command,
        label: formatPlaceDisplayLabel(resolution.nativeName, resolution.englishName) ?? resolution.matchTitle,
        source,
        placeType: resolution.placeType ?? null,
        boundingBox: resolution.boundingBox ?? null,
        nativeName: resolution.nativeName ?? null,
        englishName: resolution.englishName ?? null,
        sourceUrl: resolution.sourceUrl ?? null,
        coverage: source,
        retrievedAt: resolution.retrievedAt,
        instantRequested: false,
      },
    })
  }

  if (resolution.quality === 'ambiguous') {
    const matches = (resolution.matches ?? []).map(match => ({
      latitude: match.latitude,
      longitude: match.longitude,
      query: command,
      label: match.label,
      source,
      placeType: match.placeType,
      boundingBox: match.boundingBox,
      nativeName: match.nativeName,
      englishName: match.englishName,
      sourceUrl: match.sourceUrl,
      coverage: source,
      retrievedAt: resolution.retrievedAt,
      instantRequested: false,
    }))
    return NextResponse.json<TerraLocationResolution>({
      status: 'ambiguous',
      message: looksLikePostalCode(command)
        ? 'That postal code matches more than one place. Pick a listed match or add a city, state, or country — coordinates are never guessed.'
        : 'That command matches multiple locations. Pick a listed match or add a city, region, postal code, or country.',
      matches,
    })
  }

  return NextResponse.json<TerraLocationResolution>({
    status: 'unresolved',
    message: 'reason' in resolution ? resolution.reason : 'Location could not be resolved.',
  })
}
