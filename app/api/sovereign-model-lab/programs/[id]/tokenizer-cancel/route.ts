import { NextResponse } from 'next/server'
import { cancelTokenizerTrainingForProgram } from '@/lib/sovereign-model-lab/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Backs [ CANCEL TOKENIZER JOB ]. Cancellation can never produce tokenizer_ready — the state
 * machine only allows tokenizer_cancelled -> tokenizer_not_planned/blocked/cancelled. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let reason: string | undefined
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object' && typeof raw.reason === 'string') reason = raw.reason
  } catch {
    reason = undefined
  }
  try {
    const program = await cancelTokenizerTrainingForProgram(id, reason)
    return NextResponse.json({ program })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
