import { NextResponse } from 'next/server'
import { deleteActiveWrCorpusRecord } from '@/lib/wr-corpus/delete'
import { WrCorpusPolicyError } from '@/lib/wr-corpus/hashes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    return NextResponse.json(
      deleteActiveWrCorpusRecord({
        recordId: String(body.recordId ?? ''),
        ownerUserId: String(body.ownerUserId ?? 'local-commander'),
        policy: body.policy === 'DELETE_AND_BLOCK_RELEARN' ? 'DELETE_AND_BLOCK_RELEARN' : 'DELETE_AND_ALLOW_RELEARN',
      }),
    )
  } catch (error) {
    const err = error as WrCorpusPolicyError
    return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
  }
}
