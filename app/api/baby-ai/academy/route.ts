import { NextResponse } from 'next/server'

import { buildBabyAiAcademySnapshot } from '@/lib/baby-ai/integrationStatus'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(await buildBabyAiAcademySnapshot())
}
