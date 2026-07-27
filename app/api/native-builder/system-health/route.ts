import { NextResponse } from 'next/server'
import { buildCanonicalSystemHealthSnapshot } from '@/lib/native-builder/systemHealthSnapshot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const snapshot = await buildCanonicalSystemHealthSnapshot(req)
  return NextResponse.json(snapshot)
}
