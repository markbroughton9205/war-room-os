import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { discoverLocalModels, getSovereignRuntimeTruth } from '@/lib/sovereign-runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * #22 Phase 11B — Local model discovery via War Room Core path (Next server → canonical router).
 * Renderer must not call Ollama directly.
 */
export async function GET() {
  const session = await requireCommanderSession('SOVEREIGN_LOCAL_MODEL_STATUS')
  if (!session.ok) return session.response

  try {
    const discovery = await discoverLocalModels()
    return NextResponse.json({
      ok: true,
      runtime_truth: getSovereignRuntimeTruth(),
      ...discovery,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
