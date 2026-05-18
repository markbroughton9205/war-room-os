import { NextResponse } from 'next/server'
import { collectRuntimeReliabilitySnapshot } from '@/lib/runtime/operationalReliability'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const snapshot = await collectRuntimeReliabilitySnapshot(req)
    return NextResponse.json({
      generatedAt: snapshot.generatedAt,
      mode: snapshot.mode,
      degraded: snapshot.degraded,
      fallbackSystems: snapshot.graph.fallbackSystems,
      staleSystems: snapshot.graph.staleSystems,
      blockedSystems: snapshot.graph.blockedSystems,
      recommendations: snapshot.recommendations,
      guardrails: snapshot.guardrails,
    }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Runtime degraded intelligence failed',
        generatedAt: new Date().toISOString(),
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}
