import { NextResponse } from 'next/server'
import { probeTokenizerEnvironment } from '@/lib/sovereign-model-lab/tokenizerEnvironment'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Read-only. Runs a fresh real probe every call — installs nothing, mutates nothing, matching
 * the existing hardware/route.ts convention. */
export async function GET() {
  const report = await probeTokenizerEnvironment()
  return NextResponse.json(report)
}
