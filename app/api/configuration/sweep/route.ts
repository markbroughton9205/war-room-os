import { NextResponse } from 'next/server'

import { buildConfigurationSweep } from '@/lib/configuration/configurationHealth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(buildConfigurationSweep())
}
