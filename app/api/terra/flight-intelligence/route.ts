import { fetchTerraOfficialGis } from '@/lib/terra/placePrecision/gisFetch'
import { authRequiredState, parseAdsbFeed } from '@/lib/terra/flightIntelligence/adapters'
import type { AircraftProviderObservation, ProviderHealthState } from '@/lib/terra/flightIntelligence/types'

export const dynamic = 'force-dynamic'

function bboxCenter(lamin: number, lomin: number, lamax: number, lomax: number) {
  return { lat: (lamin + lamax) / 2, lon: (lomin + lomax) / 2 }
}

function radiusNm(lamin: number, lomin: number, lamax: number, lomax: number): number {
  const latSpan = Math.abs(lamax - lamin) * 60
  const lonSpan = Math.abs(lomax - lomin) * 60 * Math.cos(((lamin + lamax) / 2) * Math.PI / 180)
  return Math.max(1, Math.min(250, Math.ceil(Math.hypot(latSpan, lonSpan) / 2)))
}

async function airplanesLive(lat: number, lon: number, radius: number, receivedAt: string): Promise<{
  observations: AircraftProviderObservation[]
  state: ProviderHealthState
}> {
  const url = `https://api.airplanes.live/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radius}`
  const result = await fetchTerraOfficialGis({ service: 'airplanes_live', url, timeoutMs: 12_000 })
  if (!result.ok) {
    let detail = result.status ? `HTTP ${result.status}` : result.text
    try {
      const body = JSON.parse(result.text) as { error?: unknown }
      if (typeof body.error === 'string' && body.error.trim()) detail = body.error.trim()
    } catch { /* keep the HTTP detail */ }
    return {
      observations: [],
      state: {
        provider: 'airplanes_live',
        state: 'PROVIDER_UNAVAILABLE',
        detail,
        observationCount: 0,
      },
    }
  }
  return parseAdsbFeed('airplanes_live', result.text, receivedAt)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const lamin = Number(url.searchParams.get('lamin'))
  const lomin = Number(url.searchParams.get('lomin'))
  const lamax = Number(url.searchParams.get('lamax'))
  const lomax = Number(url.searchParams.get('lomax'))
  if (![lamin, lomin, lamax, lomax].every(Number.isFinite) || lamax <= lamin || lomax <= lomin) {
    return Response.json({ observations: [], providers: [], error: 'bbox required' }, { status: 400 })
  }
  if (lamax - lamin > 20 || lomax - lomin > 20) {
    return Response.json({
      observations: [],
      providers: [{ provider: 'airplanes_live', state: 'NO_COVERAGE', detail: 'View is wider than the flight query limit.', observationCount: 0 }],
    })
  }
  const receivedAt = new Date().toISOString()
  const center = bboxCenter(lamin, lomin, lamax, lomax)
  const providers: ProviderHealthState[] = []
  let observations: AircraftProviderObservation[] = []
  try {
    const live = await airplanesLive(center.lat, center.lon, radiusNm(lamin, lomin, lamax, lomax), receivedAt)
    observations = live.observations
    providers.push(live.state)
  } catch (error) {
    providers.push({
      provider: 'airplanes_live',
      state: 'PROVIDER_UNAVAILABLE',
      detail: error instanceof Error ? error.message : 'Airplanes.live failed.',
      observationCount: 0,
    })
  }
  if (!process.env.ADSBX_API_KEY && !process.env.ADSB_EXCHANGE_API_KEY) {
    providers.push(authRequiredState('adsb_exchange', 'ADS-B Exchange credentials are not configured.'))
  } else {
    providers.push({
      provider: 'adsb_exchange',
      state: 'AUTH_REQUIRED',
      detail: 'A key is present but this install has no verified ADS-B Exchange request path yet.',
      observationCount: 0,
    })
  }
  return Response.json({ observations, providers, receivedAt })
}
