import { NextResponse } from 'next/server'

import { buildLearningIntegrationSnapshot } from '@/lib/learning/integrationStatus'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(await buildLearningIntegrationSnapshot())
}
