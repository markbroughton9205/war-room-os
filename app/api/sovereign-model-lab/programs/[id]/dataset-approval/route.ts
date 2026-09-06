import { NextResponse } from 'next/server'
import { decideDatasetApproval } from '@/lib/sovereign-model-lab/runtime'
import { requireCommanderSession } from '@/lib/security/commanderSession'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Backs [ APPROVE / REJECT DATASET ]. Wave 1 repair (sovereign-model-lab authorization audit):
 * docs/architecture/SOVEREIGN_MODEL_LAB_ARCHITECTURE_AND_GOVERNANCE.md section 12 names this one
 * of "the two decisions that matter most," but the route itself had no identity check beyond the
 * app-wide session gate - any authenticated user, not just the Commander, could approve or reject
 * a dataset. Added requireCommanderSession; does not affect the documented read-only-stays-
 * session-only surface (dataset-candidate listing, corpus building, etc.), which this route was
 * never part of. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const commander = await requireCommanderSession('Dataset approval')
  if (!commander.ok) return commander.response

  const { id } = await params
  let body: { approved?: boolean } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }
  if (typeof body.approved !== 'boolean') {
    return NextResponse.json({ error: 'approved (boolean) is required.' }, { status: 400 })
  }
  try {
    const program = await decideDatasetApproval(id, body.approved)
    return NextResponse.json({ program })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
