import { NextResponse } from 'next/server'

import { runSchemaSweep } from '@/lib/schema-sweep'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function response() {
  const snapshot = await runSchemaSweep()
  return NextResponse.json({
    generatedAt: snapshot.generatedAt,
    persistenceHealth: snapshot.persistenceHealth,
    repairPacket: snapshot.repairPacket,
    operatorNextSteps: snapshot.repairPacket.operatorNextSteps,
    operatorNextStepsMarkdown: snapshot.repairPacket.operatorNextStepsMarkdown,
    issues: snapshot.issues,
    guardrails: snapshot.guardrails,
  }, {
    headers: {
      'cache-control': 'no-store',
      'x-war-room-schema-repair': 'advisory-only',
      'x-war-room-db-mutation': 'false',
    },
  })
}

export async function GET() {
  return response()
}

export async function POST() {
  return response()
}
