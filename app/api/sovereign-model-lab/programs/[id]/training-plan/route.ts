import { NextResponse } from 'next/server'
import { planTrainingForProgram } from '@/lib/sovereign-model-lab/runtime'
import type { TrainingScaleClass } from '@/lib/sovereign-model-lab/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const VALID_SCALES: readonly TrainingScaleClass[] = ['micro', 'tiny', 'small', 'research']

/** Creates a training PLAN only — never starts training. Phase 1's state machine has no state
 * beyond awaiting_commander_training_approval for this program to reach after this call. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { scaleClass?: TrainingScaleClass; purpose?: string } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }
  if (!body.scaleClass || !VALID_SCALES.includes(body.scaleClass)) {
    return NextResponse.json({ error: `scaleClass must be one of: ${VALID_SCALES.join(', ')}` }, { status: 400 })
  }
  try {
    const program = await planTrainingForProgram(id, { scaleClass: body.scaleClass, purpose: body.purpose ?? 'Unspecified' })
    return NextResponse.json({ program })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
