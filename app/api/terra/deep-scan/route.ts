import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { planDeepScan } from '@/lib/planetary-intelligence/terraCoverage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DEEP SCAN REGION — source discovery / research only.
 * Does not grant consequential physical authority.
 */
export async function POST(request: NextRequest) {
  const commander = await requireCommanderSession('Terra deep scan')
  if (!commander.ok) return commander.response

  let body: { regionLabel?: string; latitude?: number; longitude?: number } = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const regionLabel = body.regionLabel?.trim() || request.nextUrl.searchParams.get('region')?.trim() || ''
  if (!regionLabel) {
    return NextResponse.json({
      tool: 'terra-deep-scan',
      status: 'error',
      error: { message: 'regionLabel is required.' },
      grantsPhysicalAuthority: false,
    }, { status: 400 })
  }

  const plan = planDeepScan({
    regionLabel,
    latitude: body.latitude,
    longitude: body.longitude,
  })

  return NextResponse.json({
    tool: 'terra-deep-scan',
    status: 'planned',
    plan,
    grantsPhysicalAuthority: false,
  })
}
