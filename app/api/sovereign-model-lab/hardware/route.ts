import { NextResponse } from 'next/server'
import { runHardwareProbe } from '@/lib/sovereign-model-lab/hardwareProbe'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Read-only. Runs a fresh real probe every call — installs nothing, mutates nothing. */
export async function GET() {
  const report = await runHardwareProbe()
  return NextResponse.json(report)
}
