import { NextResponse } from 'next/server'

import { buildAgentActivationSnapshot } from '@/lib/agents/activation/agentActivationWorkflow'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const snapshot = await buildAgentActivationSnapshot()
  return NextResponse.json({
    generatedAt: snapshot.generatedAt,
    integrationStatus: snapshot.integrationStatus,
    persistenceAvailable: snapshot.persistenceAvailable,
    guardrails: snapshot.guardrails,
    readiness: snapshot.readiness,
    blockers: snapshot.readiness.flatMap(item => item.blockers.map(blocker => ({ agentId: item.agentId, blocker }))),
    workerLaunch: snapshot.workerLaunch,
  })
}
