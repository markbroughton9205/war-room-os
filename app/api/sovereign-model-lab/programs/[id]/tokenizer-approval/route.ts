import { NextResponse } from 'next/server'
import { approveTokenizerTraining } from '@/lib/sovereign-model-lab/runtime'
import { requireCommanderSession } from '@/lib/security/commanderSession'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Backs [ APPROVE TOKENIZER TRAINING ]. Binds the approval to the plan's immutable hash — any
 * change to the plan invalidates it (see tokenizerApproval.ts / assertFreshBeforeSpawn).
 *
 * Wave 1 repair (sovereign-model-lab authorization audit): docs/architecture/
 * SOVEREIGN_MODEL_LAB_ARCHITECTURE_AND_GOVERNANCE.md section 12 names this "the two decisions
 * that matter most" alongside dataset-approval, but the hash-bound execution gate this route's
 * own approval feeds (tokenizer-train's assertTokenizerExecutionApproved) never checks WHO issued
 * the approval - only that a validly-shaped, correctly-hash-bound approval object was presented.
 * Any authenticated session (not just the Commander) could grant this approval. Adding
 * requireCommanderSession here closes that gap without touching the hash-binding/freshness
 * machinery, which stays exactly as documented. Does not affect the "read-only ops stay
 * session-only" surface at all - this route was never in that category. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const commander = await requireCommanderSession('Tokenizer training approval')
  if (!commander.ok) return commander.response

  const { id } = await params
  try {
    const program = await approveTokenizerTraining(id)
    return NextResponse.json({ program })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
