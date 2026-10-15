import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { probeSubsystems } from '@/lib/council/subsystems/probe'
import { realSubsystemDeps } from '@/lib/council/subsystems/real.server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Live, read-only state of the interfaces Council can use: Terra, Terra World and Higher Vision Studios. */
export async function GET() {
  const commander = await requireCommanderSession('Council subsystems')
  if (!commander.ok) return commander.response
  const subsystems = await probeSubsystems(realSubsystemDeps())
  return NextResponse.json({ generatedAt: new Date().toISOString(), subsystems })
}
