import { NextResponse } from 'next/server'
import { checkTokenizerEnvironment } from '@/lib/sovereign-model-lab/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Runs a real environment probe and advances program state accordingly (tokenizer_not_planned ->
 * tokenizer_environment_unverified, or -> tokenizer_environment_blocked if incompatible). Never
 * installs anything. Backs [ INSPECT TOKENIZER ENVIRONMENT ]. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const { program, environment } = await checkTokenizerEnvironment(id)
    return NextResponse.json({ program, environment })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
