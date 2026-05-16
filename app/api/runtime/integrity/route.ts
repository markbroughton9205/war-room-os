import { insertDiagnosticEvent } from '@/lib/runtime/diagnosticLog'
import { collectRuntimeIntegrity } from '@/lib/runtime/runtimeIntegrityCollect'
import type { RuntimeIntegrityResponse } from '@/lib/runtime/runtimeIntegrityTypes'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FAILING_LOG_COOLDOWN_MS = 300_000
const lastFailingIntegrityLogAt = new Map<string, number>()

function maybeLogFailingSubsystems(subsystems: RuntimeIntegrityResponse['subsystems']): void {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return
  const now = Date.now()
  for (const s of subsystems) {
    if (s.status !== 'FAILING') continue
    const prev = lastFailingIntegrityLogAt.get(s.id) ?? 0
    if (now - prev < FAILING_LOG_COOLDOWN_MS) continue
    lastFailingIntegrityLogAt.set(s.id, now)
    insertDiagnosticEvent(sup.client, {
      subsystem: s.id,
      severity: 'FAILING',
      source_family: 'integrity_poll',
      evidence: {
        label: s.label,
        truthLevel: s.truthLevel,
        evidence: s.evidence.slice(0, 4000),
      },
      recommendation: s.recommendation.slice(0, 2000),
      diagnostic_mode: null,
    })
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const councilMode = url.searchParams.get('councilMode')?.trim() || null

  const body = await collectRuntimeIntegrity(req, { councilMode })
  maybeLogFailingSubsystems(body.subsystems)

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  })
}
