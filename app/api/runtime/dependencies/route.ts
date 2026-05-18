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
      graph: snapshot.graph,
      guardrails: snapshot.guardrails,
    }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Runtime dependency graph failed',
        generatedAt: new Date().toISOString(),
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}
