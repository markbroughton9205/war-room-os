import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { fetchTerraLiveIntel } from '@/lib/terra/fetchLiveIntel'
import { TERRA_LIVE_LAYER_IDS, type TerraLiveLayerId } from '@/lib/terra/liveGeoIntelligence'
import { TERRA_TIME_WINDOW_PRESETS } from '@/lib/terra/terraTime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseLayers(raw: string | null): TerraLiveLayerId[] | undefined {
  if (!raw?.trim()) return undefined
  const ids = raw.split(',').map(part => part.trim()).filter((part): part is TerraLiveLayerId => (
    TERRA_LIVE_LAYER_IDS as readonly string[]
  ).includes(part))
  return ids.length ? ids : undefined
}

function parseCoord(raw: string | null): number | null {
  if (!raw?.trim()) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra live intel')
  let requestedBy = 'terra-live-intel'
  let allowCredentialedProviders = false
  let authState: 'AUTHENTICATED' | 'AUTH_REQUIRED' = 'AUTH_REQUIRED'

  if (commander.ok) {
    requestedBy = commander.userId
    allowCredentialedProviders = true
    authState = 'AUTHENTICATED'
  } else if (commander.response.status === 403) {
    return commander.response
  }

  const windowId = request.nextUrl.searchParams.get('window') ?? 'all'
  const timeWindow = TERRA_TIME_WINDOW_PRESETS.find(preset => preset.id === windowId)?.window ?? null

  const snapshot = await fetchTerraLiveIntel({
    requestedBy,
    bbox: request.nextUrl.searchParams.get('bbox'),
    layers: parseLayers(request.nextUrl.searchParams.get('layers')),
    timeWindow,
    lat: parseCoord(request.nextUrl.searchParams.get('lat')),
    lon: parseCoord(request.nextUrl.searchParams.get('lon')),
    place: request.nextUrl.searchParams.get('place'),
    nativePlaceName: request.nextUrl.searchParams.get('nativePlace'),
    englishPlaceName: request.nextUrl.searchParams.get('englishPlace'),
    city: request.nextUrl.searchParams.get('city'),
    county: request.nextUrl.searchParams.get('county'),
    state: request.nextUrl.searchParams.get('state'),
    country: request.nextUrl.searchParams.get('country'),
    countryCode: request.nextUrl.searchParams.get('countryCode'),
    reverseSublocalityLabel: request.nextUrl.searchParams.get('reversePlace'),
    zoom: request.nextUrl.searchParams.get('zoom'),
    allowCredentialedProviders,
    authState,
    includeNews: request.nextUrl.searchParams.get('news') !== '0',
  })

  return NextResponse.json({
    tool: 'terra-live-intel',
    status: snapshot.objects.length === 0 && !snapshot.panel?.sections.some(section => section.count > 0) ? 'empty' : 'success',
    authState,
    ...snapshot,
  })
}
