import { NextResponse } from 'next/server'
import { createTokenizerPlan } from '@/lib/sovereign-model-lab/runtime'
import type { TokenizerAlgorithm } from '@/lib/sovereign-model-lab/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALGORITHMS: TokenizerAlgorithm[] = ['bpe', 'unigram', 'wordpiece']

/** Backs [ CREATE TOKENIZER PLAN ]. Builds a real execution plan (exact executable, argv, corpus
 * link, limits) — never a dry-run rubber stamp. Requires the tokenizer environment to have already
 * been probed as compatible (tokenizer_environment_unverified). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { vocabSize?: number; algorithm?: string; minimumFrequency?: number; seed?: number } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }
  const vocabSize = typeof body.vocabSize === 'number' && body.vocabSize > 0 ? body.vocabSize : 8192
  const algorithm: TokenizerAlgorithm = ALGORITHMS.includes(body.algorithm as TokenizerAlgorithm) ? (body.algorithm as TokenizerAlgorithm) : 'bpe'
  const minimumFrequency = typeof body.minimumFrequency === 'number' && body.minimumFrequency > 0 ? body.minimumFrequency : undefined
  const seed = typeof body.seed === 'number' ? body.seed : undefined

  try {
    const program = await createTokenizerPlan(id, { vocabSize, algorithm, minimumFrequency, seed })
    return NextResponse.json({ program })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
