import { NextResponse } from 'next/server'
import { ragFromWrCorpus } from '@/lib/wr-corpus/rag'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const ownerUserId = typeof body.ownerUserId === 'string' ? body.ownerUserId : 'local-commander'
  const query = typeof body.query === 'string' ? body.query : ''
  try {
    return NextResponse.json(await ragFromWrCorpus({ query, ownerUserId, skipModel: body.skipModel === true }))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
