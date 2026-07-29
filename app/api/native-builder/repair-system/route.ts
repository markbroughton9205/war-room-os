import { NextResponse } from 'next/server'
import { runRepairSystemSweep } from '@/lib/native-builder/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The [ REPAIR SYSTEM ] entry point. Read-only + issue-creation only (no file mutation), so it
 * does not need the dangerous-action approval gate — that gate applies at /approve, where a real
 * patch gets written.
 */
export async function POST(req: Request) {
  const result = await runRepairSystemSweep(req)
  return NextResponse.json(result)
}
