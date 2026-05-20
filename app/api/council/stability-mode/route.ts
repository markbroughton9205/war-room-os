import { NextResponse } from 'next/server'
import { isCouncilStabilityMode, stabilityModeResponseMeta } from '@/lib/council/stabilityMode'

export async function GET() {
  return NextResponse.json({
    active: isCouncilStabilityMode(),
    ...stabilityModeResponseMeta(),
  })
}
