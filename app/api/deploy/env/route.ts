import { NextResponse } from 'next/server'

import { summarizeEnvReadinessGroups } from '@/lib/deploy/envReadiness'
import type { EnvReadinessResponse } from '@/lib/deploy/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const body: EnvReadinessResponse = {
    source: 'process.env',
    groups: summarizeEnvReadinessGroups(),
  }
  return NextResponse.json(body)
}
