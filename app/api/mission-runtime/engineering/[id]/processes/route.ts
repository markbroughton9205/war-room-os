import { NextResponse } from 'next/server'
import { listProcessesForRepair } from '@/lib/native-builder/processRegistry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return NextResponse.json({ processes: listProcessesForRepair(id) })
}
