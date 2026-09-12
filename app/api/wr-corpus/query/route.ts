import { NextResponse } from 'next/server'
import { queryWrCorpus } from '@/lib/wr-corpus/query'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const ownerUserId = typeof body.ownerUserId === 'string' ? body.ownerUserId : 'local-commander'
  const query = typeof body.query === 'string' ? body.query : ''
  const corpusVersion = typeof body.corpusVersion === 'string' ? body.corpusVersion : undefined
  try {
    return NextResponse.json(queryWrCorpus({ query, ownerUserId, corpusVersion }))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
