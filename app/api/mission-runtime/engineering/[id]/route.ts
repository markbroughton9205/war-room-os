import { NextResponse } from 'next/server'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const strategy = getMissionExecutionStrategy('engineering')
  const mission = await strategy.get(id)
  if (!mission) return NextResponse.json({ error: 'Mission not found.' }, { status: 404 })
  return NextResponse.json({ mission })
}
