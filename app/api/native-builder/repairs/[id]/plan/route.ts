import { NextResponse } from 'next/server'
import { planRepair } from '@/lib/native-builder/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Planning is inspection + reasoning only — no filesystem mutation — so it does not need the
 * dangerous-action approval gate (that gate applies at /approve, where a real patch is written). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { targetFiles?: string[]; useLocalModel?: boolean } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }

  try {
    const repair = await planRepair(id, { targetFiles: body.targetFiles, useLocalModel: body.useLocalModel })
    return NextResponse.json({ repair })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
