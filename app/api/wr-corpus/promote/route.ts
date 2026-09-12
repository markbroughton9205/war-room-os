import { NextResponse } from 'next/server'
import { promoteApprovedCandidate } from '@/lib/wr-corpus/promote'
import { WrCorpusPolicyError } from '@/lib/wr-corpus/hashes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (body.commanderApproval !== true) {
    return NextResponse.json({ error: 'Explicit commanderApproval:true is required. Auto-promotion denied.' }, { status: 403 })
  }
  try {
    const result = await promoteApprovedCandidate({
      candidateId: String(body.candidateId ?? ''),
      ownerUserId: String(body.ownerUserId ?? 'local-commander'),
      commanderApproval: true,
    })
    return NextResponse.json(result)
  } catch (error) {
    const err = error as WrCorpusPolicyError
    return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
  }
}
