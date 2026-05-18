import { NextResponse } from 'next/server'

import { buildBabyDailyBriefing } from '@/lib/baby-ai/operationalIntelligence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(await buildBabyDailyBriefing())
}

