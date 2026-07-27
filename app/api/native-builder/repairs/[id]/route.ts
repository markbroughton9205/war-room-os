import { NextResponse } from 'next/server'
import { getRepair, getIssue } from '@/lib/native-builder/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const repair = await getRepair(id)
  if (!repair) return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })
  const issue = await getIssue(repair.issueId)
  return NextResponse.json({ repair, issue })
}
