import { NextResponse } from 'next/server'
import { verifyTokenizerForProgram } from '@/lib/sovereign-model-lab/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Backs [ VERIFY TOKENIZER ]. Runs all 18 mandatory checks (Part 10). Only if every one passes
 * does the program advance to tokenizer_ready; any failure -> tokenizer_failed. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const program = await verifyTokenizerForProgram(id)
    return NextResponse.json({ program })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
