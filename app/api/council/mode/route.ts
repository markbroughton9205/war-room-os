import { NextResponse } from 'next/server'
import {
  COUNCIL_FLOW_MODE_ENV,
  COUNCIL_FLOW_MODE_LABELS,
  getDefaultCouncilFlowMode,
  parseCouncilFlowMode,
  type CouncilFlowMode,
} from '@/lib/council/councilMode'
import { isCouncilStabilityMode, stabilityModeResponseMeta } from '@/lib/council/stabilityMode'

export async function GET() {
  const defaultMode = getDefaultCouncilFlowMode()
  const envMode = parseCouncilFlowMode(process.env[COUNCIL_FLOW_MODE_ENV])
  return NextResponse.json({
    defaultMode,
    envMode,
    envKey: COUNCIL_FLOW_MODE_ENV,
    labels: COUNCIL_FLOW_MODE_LABELS,
    councilStabilityEnv: isCouncilStabilityMode(),
    ...stabilityModeResponseMeta(defaultMode),
  })
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const mode = parseCouncilFlowMode(body.councilFlowMode ?? body.mode)
  if (!mode) {
    return NextResponse.json({ error: 'Invalid councilFlowMode' }, { status: 400 })
  }
  const labels = COUNCIL_FLOW_MODE_LABELS[mode as CouncilFlowMode]
  return NextResponse.json({
    ok: true,
    mode,
    label: labels,
    ...stabilityModeResponseMeta(mode),
  })
}
