import { NextResponse } from 'next/server'

import { buildAgentIntegrationSnapshot } from '@/lib/agents/foundry/agentIntegrationStatus'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(await buildAgentIntegrationSnapshot())
}
