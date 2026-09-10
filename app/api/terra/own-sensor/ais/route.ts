import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { ingestOwnSensorAisObservations } from '@/lib/terra/maritimeOwnSensorStore'
import type { TerraOwnSensorAisObservation } from '@/lib/terra/maritimeOwnSensorBridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isLoopback(request: NextRequest): boolean {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
  const realIp = request.headers.get('x-real-ip')?.trim() ?? ''
  const candidates = [forwarded, realIp, request.nextUrl.hostname]
  return candidates.some(value => value === '127.0.0.1' || value === '::1' || value === 'localhost' || value === ':ffff:127.0.0.1')
}

function tokenMatches(request: NextRequest): boolean {
  const expected = process.env.TERRA_AIS_CATCHER_INGEST_TOKEN?.trim() ?? ''
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : request.headers.get('x-terra-own-sensor-token')?.trim() ?? ''
  if (!provided || provided.length !== expected.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i)
  return mismatch === 0
}

function parseObservation(value: unknown): TerraOwnSensorAisObservation | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.mmsi !== 'number' || typeof row.latitude !== 'number' || typeof row.longitude !== 'number') return null
  if (typeof row.observedAtIso !== 'string' || !row.observedAtIso.trim()) return null
  return {
    mmsi: row.mmsi,
    latitude: row.latitude,
    longitude: row.longitude,
    speedKnots: typeof row.speedKnots === 'number' ? row.speedKnots : null,
    courseDeg: typeof row.courseDeg === 'number' ? row.courseDeg : null,
    headingDeg: typeof row.headingDeg === 'number' ? row.headingDeg : null,
    navStatCode: typeof row.navStatCode === 'number' ? row.navStatCode : null,
    observedAtIso: row.observedAtIso,
  }
}

export async function POST(request: NextRequest) {
  const authorized = tokenMatches(request) || (!process.env.TERRA_AIS_CATCHER_INGEST_TOKEN?.trim() && isLoopback(request))
  if (!authorized) {
    return NextResponse.json({ tool: 'terra-own-sensor-ais', status: 'error', error: 'Own-sensor ingest requires loopback or TERRA_AIS_CATCHER_INGEST_TOKEN.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ tool: 'terra-own-sensor-ais', status: 'error', error: 'JSON body required.' }, { status: 400 })
  }

  const raw = body && typeof body === 'object' && Array.isArray((body as { observations?: unknown }).observations)
    ? (body as { observations: unknown[] }).observations
    : Array.isArray(body) ? body : [body]
  const observations = raw.map(parseObservation).filter((row): row is TerraOwnSensorAisObservation => row !== null)
  const stored = ingestOwnSensorAisObservations(observations)
  return NextResponse.json({
    tool: 'terra-own-sensor-ais',
    status: stored === 0 ? 'empty' : 'success',
    stored,
    received: observations.length,
  })
}
