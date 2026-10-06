import { NextResponse } from 'next/server'
import { collectPersistenceHealth } from '@/lib/war-room/persistenceHealth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const persistence = await collectPersistenceHealth()
  return NextResponse.json({ persistence })
}
