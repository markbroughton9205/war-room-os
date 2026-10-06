import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import type { TerraLocationResolution, TerraLocationTarget } from '@/lib/terra/locationCommand'
import { parseTypedPlaceQuery } from '@/lib/terra/placePrecision/parsePlaceQuery'
import { enrichResolvedPlace } from '@/lib/terra/placePrecision/enrich'
import { assertNoOwnerLikePayload } from '@/lib/terra/placePrecision/privacy'
import type { TerraPlaceMatchClass } from '@/lib/terra/placePrecision/matchClass'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const commander = await requireCommanderSession('Terra location enrichment')
  if (!commander.ok && commander.response.status === 403) return commander.response

  let body: { query?: string; seed?: TerraLocationTarget } = {}
  try {
    body = await request.json() as { query?: string; seed?: TerraLocationTarget }
  } catch {
    return NextResponse.json<TerraLocationResolution>({ status: 'unresolved', message: 'Enrichment request was not valid JSON.' }, { status: 400 })
  }

  const query = body.query?.trim() || body.seed?.query?.trim() || ''
  const seed = body.seed
  if (!query || !seed || !Number.isFinite(seed.latitude) || !Number.isFinite(seed.longitude)) {
    return NextResponse.json<TerraLocationResolution>({ status: 'unresolved', message: 'Enrichment requires the global geocoder seed.' }, { status: 400 })
  }

  const parsed = parseTypedPlaceQuery(query)
  const outcome = await enrichResolvedPlace({
    parsed,
    seed: {
      longitude: seed.longitude,
      latitude: seed.latitude,
      matchClass: (seed.matchQuality ?? 'STREET') as TerraPlaceMatchClass,
      label: seed.label,
      houseNumber: seed.houseNumber,
      road: seed.road,
      city: seed.city,
      state: seed.state,
      postcode: seed.postcode,
      provider: seed.provider ?? seed.source,
    },
  })

  const leaks = assertNoOwnerLikePayload(outcome)
  if (leaks.length > 0) {
    return NextResponse.json<TerraLocationResolution>({
      status: 'resolved',
      target: {
        ...seed,
        query,
        enrichmentState: 'unavailable',
        precisionSource: seed.precisionSource ?? seed.provider ?? seed.source,
      },
    })
  }

  if (outcome.enrichmentState === 'skipped' || outcome.enrichmentState === 'no_coverage' || !outcome.selected) {
    if (outcome.candidates.length > 1) {
      return NextResponse.json<TerraLocationResolution>({
        status: 'ambiguous',
        message: outcome.reason ?? 'Multiple precision matches — pick a listed location.',
        matches: outcome.candidates.map(row => ({
          ...seed,
          query,
          latitude: row.latitude,
          longitude: row.longitude,
          label: row.label,
          matchQuality: row.matchClass,
          houseNumber: row.houseNumber ?? seed.houseNumber,
          road: row.road ?? seed.road,
          city: row.city ?? seed.city,
          state: row.state ?? seed.state,
          postcode: row.postcode ?? seed.postcode,
          streetMismatch: row.streetMismatch ?? false,
          provider: row.provider,
          precisionSource: row.hit?.source ?? row.provider,
          enrichmentState: 'refined',
          enrichmentEligible: false,
          geometryType: row.hit?.geometryKind === 'polygon' ? 'polygon' : 'point',
          ring: row.hit?.ring ?? null,
        })),
      })
    }
    return NextResponse.json<TerraLocationResolution>({
      status: 'resolved',
      target: {
        ...seed,
        query,
        enrichmentState: outcome.enrichmentState === 'no_coverage' ? 'no_coverage' : 'unavailable',
        precisionSource: seed.precisionSource ?? seed.provider ?? seed.source,
      },
    })
  }

  const selected = outcome.selected
  return NextResponse.json<TerraLocationResolution>({
    status: 'resolved',
    target: {
      ...seed,
      query,
      latitude: selected.latitude,
      longitude: selected.longitude,
      label: selected.label || seed.label,
      matchQuality: selected.matchClass,
      houseNumber: selected.houseNumber ?? seed.houseNumber,
      road: selected.road ?? seed.road,
      city: selected.city ?? seed.city,
      state: selected.state ?? seed.state,
      postcode: selected.postcode ?? seed.postcode,
      streetMismatch: false,
      provider: selected.provider,
      precisionSource: selected.hit?.source ?? selected.provider,
      enrichmentState: 'refined',
      enrichmentEligible: false,
      geometryType: selected.hit?.geometryKind === 'polygon' ? 'polygon' : 'point',
      ring: selected.hit?.ring ?? null,
      boundingBox: selected.hit?.boundingBox ?? seed.boundingBox,
    },
  })
}
