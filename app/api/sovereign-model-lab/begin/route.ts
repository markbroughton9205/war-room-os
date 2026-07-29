import { NextResponse } from 'next/server'
import { beginModelProgram } from '@/lib/sovereign-model-lab/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** [ BEGIN WAR ROOM MODEL 001 ]: runs a real hardware audit, creates an empty program record,
 * and reports what's missing. Never implies training started. */
export async function POST(req: Request) {
  let body: { name?: string } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }
  const result = await beginModelProgram(body.name?.trim() || 'WRM-001')
  return NextResponse.json(result)
}
