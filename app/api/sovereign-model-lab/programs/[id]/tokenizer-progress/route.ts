import { NextResponse } from 'next/server'
import { checkTokenizerTrainingProgress } from '@/lib/sovereign-model-lab/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Backs TOKENIZER LIVE PROGRESS polling. Reconciles program state with the real observed
 * subprocess outcome (completed -> tokenizer_verification, failed/timed_out -> tokenizer_failed,
 * cancelled -> tokenizer_cancelled) — never trusts a client claim of completion. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const { program, jobStatus } = await checkTokenizerTrainingProgress(id)
    return NextResponse.json({ program, jobStatus })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
