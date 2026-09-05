import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerEngineSelectionStore } from '@/lib/wr-engineer/engineSelection'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await requireCommanderSession('WR-Engineer engine selection')
  if (!session.ok) return session.response
  const selection = await wrEngineerEngineSelectionStore.load()
  return NextResponse.json({ selection })
}

export async function POST(req: Request) {
  const session = await requireCommanderSession('WR-Engineer engine selection')
  if (!session.ok) return session.response

  const body = await req.json().catch(() => null)
  const saved = await wrEngineerEngineSelectionStore.save(body)
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 400 })
  }
  return NextResponse.json({ selection: saved.selection })
}
