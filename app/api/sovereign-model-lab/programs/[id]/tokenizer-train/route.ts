import { NextResponse } from 'next/server'
import { startTokenizerTrainingForProgram } from '@/lib/sovereign-model-lab/runtime'
import { getProgram, getTokenizerExperiment } from '@/lib/sovereign-model-lab/storage'
import { assertTokenizerExecutionApproved } from '@/lib/sovereign-model-lab/tokenizerApproval'
import { fetchWarRoomPermissionsState } from '@/lib/war-room/permissionsState'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Backs [ TRAIN WAR ROOM TOKENIZER ]. Commander-gated (hardening decision, see
 * docs/architecture/SOVEREIGN_MODEL_LAB_ARCHITECTURE_AND_GOVERNANCE.md): assertTokenizerExecution
 * Approved() runs BEFORE startTokenizerTrainingForProgram is ever called, so a blocked result here
 * guarantees no output directory is created, no artifact is written, and no subprocess is spawned.
 * Once past this gate, startTokenizerTrainingForProgram still independently rechecks the corpus
 * manifest hash, the plan hash, and the approval binding immediately before spawning (see
 * tokenizerApproval.ts assertFreshBeforeSpawn, wired through tokenizerRuntime.ts) — this route-
 * level gate and that pre-spawn freshness recheck are deliberately layered, not redundant: this
 * gate proves the CALLER explicitly authorized this exact action; the pre-spawn recheck proves
 * nothing drifted between authorization and the moment of execution. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { tokenizerExecutionApproval?: unknown } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }

  const program = await getProgram(id)
  if (!program) {
    return NextResponse.json({ error: 'Program not found.' }, { status: 404 })
  }
  const experiment = program.tokenizerExperimentId ? await getTokenizerExperiment(program.tokenizerExperimentId) : null

  const sup = tryWarRoomSupabase()
  const state = await fetchWarRoomPermissionsState(sup.ok ? sup.client : null)

  // middleware.ts's updateSession() already blocks any unauthenticated request from ever reaching
  // this handler — hasSession is true here by construction, same convention as Native Builder's
  // live-research gate. The gate function itself still declares hasSession as an explicit,
  // independently unit-tested parameter rather than silently assuming truthiness.
  const gate = assertTokenizerExecutionApproved({
    hasSession: true,
    safetyLock: state.safetyLock,
    programState: program.state,
    programId: id,
    currentPlanHash: experiment?.plan?.planHash ?? null,
    approval: body.tokenizerExecutionApproval,
  })
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason, blocked: true }, { status: gate.status })
  }

  try {
    const result = await startTokenizerTrainingForProgram(id)
    return NextResponse.json({ program: result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
