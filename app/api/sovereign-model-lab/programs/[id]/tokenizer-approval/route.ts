import { NextResponse } from 'next/server'
import { approveTokenizerTraining } from '@/lib/sovereign-model-lab/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Backs [ APPROVE TOKENIZER TRAINING ]. Binds the approval to the plan's immutable hash — any
 * change to the plan invalidates it (see tokenizerApproval.ts / assertFreshBeforeSpawn). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const program = await approveTokenizerTraining(id)
    return NextResponse.json({ program })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
