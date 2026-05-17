import { NextResponse } from 'next/server'

import { buildAgentActivationSnapshot } from '@/lib/agents/activation/agentActivationWorkflow'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(await buildAgentActivationSnapshot())
}
