import { NextResponse } from 'next/server'
import { startTokenizerTrainingForProgram } from '@/lib/sovereign-model-lab/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Backs [ TRAIN WAR ROOM TOKENIZER ]. Immediately before spawning, rechecks the corpus manifest
 * hash, the plan hash, and the approval binding fresh — any drift since approval aborts execution
 * and reverts the program to tokenizer_plan_ready (see tokenizerApproval.ts assertFreshBeforeSpawn,
 * wired through tokenizerRuntime.ts). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const program = await startTokenizerTrainingForProgram(id)
    return NextResponse.json({ program })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
