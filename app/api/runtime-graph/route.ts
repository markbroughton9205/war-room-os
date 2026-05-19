import { NextResponse } from 'next/server'

import { collectRuntimeGraph } from '@/lib/runtime-graph/collect'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const graph = await collectRuntimeGraph(req)
    return NextResponse.json(graph, {
      headers: {
        'cache-control': 'no-store',
        'x-war-room-runtime-graph': graph.derived.momentumTrend,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Runtime graph failed.' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}
