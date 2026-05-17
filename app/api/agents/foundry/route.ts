import { NextResponse } from 'next/server'

import { buildAgentFoundrySnapshot } from '@/lib/agents/foundry/agentFoundry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(await buildAgentFoundrySnapshot())
}
