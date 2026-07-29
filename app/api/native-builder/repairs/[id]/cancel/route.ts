import { NextResponse } from 'next/server'
import { cancelRepair } from '@/lib/native-builder/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Cancel before any patch is applied — no file mutation occurred, so no approval gate is needed. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { reason?: string } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }
  try {
    const repair = await cancelRepair(id, body.reason)
    return NextResponse.json({ repair })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
