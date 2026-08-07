import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { browserSafeProviderStatusRows } from '@/lib/research-engine/config/providerEnv'
import { recordResearchAudit } from '@/lib/research-engine/diagnostics/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const commander = await requireCommanderSession('Research Engine provider registry')
  if (!commander.ok) return commander.response

  const startedAt = new Date().toISOString()
  const started = Date.now()
  const providers = browserSafeProviderStatusRows()

  recordResearchAudit({
    operation: 'providers_list',
    provider: 'multi',
    queryHash: null,
    startedAt,
    durationMs: Date.now() - started,
    resultCount: providers.length,
    outcome: 'success',
    errorCategory: null,
    requestedBy: commander.userId,
  })

  return NextResponse.json({
    tool: 'research-engine-providers',
    status: 'ready',
    message: 'Provider configuration status is env-presence only. CONNECTED/ready states require an explicit health check.',
    providers,
    secretsExposed: false,
  })
}
