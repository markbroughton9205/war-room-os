import { NextResponse } from 'next/server'
import { requestTrainingApproval } from '@/lib/sovereign-model-lab/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Phase 1 ceiling — this is the last real transition. No route or function exists anywhere in
 * this domain that could move a program past this state into active training. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const program = await requestTrainingApproval(id)
    return NextResponse.json({ program })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
