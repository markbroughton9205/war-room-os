import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerEngineSelectionStore } from '@/lib/wr-engineer/engineSelection'
import { buildEngineDashboardState, dashboardStateIsSecretFree } from '@/lib/wr-engineer/engineHealth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await requireCommanderSession('WR-Engineer engine status')
  if (!session.ok) return session.response

  const selection = await wrEngineerEngineSelectionStore.load()
  const state = await buildEngineDashboardState(selection)
  if (!dashboardStateIsSecretFree(state)) {
    return NextResponse.json({ error: 'Engine status redaction failed.' }, { status: 500 })
  }

  return NextResponse.json({
    mode: state.mode,
    activeEngine: state.activeEngine,
    model: state.model,
    runtime: state.runtime,
    gpu: state.gpu,
    engineStatus: state.engineStatus,
    node: state.node,
    local: state.local,
    external: state.external,
    fallbackAllowed: state.fallbackAllowed,
  })
}
