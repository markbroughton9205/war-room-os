import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { providerEnvDescriptor } from '@/lib/research-engine/config/providerEnv'
import { getImplementedAdapter } from '@/lib/research-engine/providers/registry'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import { recordResearchAudit } from '@/lib/research-engine/diagnostics/audit'
import type { ResearchHealthStatus, ResearchProviderId } from '@/lib/research-engine/core/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ provider: string }> }

export async function GET(_req: Request, context: Context) {
  const commander = await requireCommanderSession('Research Engine provider health check')
  if (!commander.ok) return commander.response

  const { provider: providerParam } = await context.params
  const provider = providerParam as ResearchProviderId
  const descriptor = providerEnvDescriptor(provider)
  if (!descriptor) {
    return NextResponse.json({ tool: 'research-engine-provider-health', status: 'not_found', message: `Unknown provider "${providerParam}".` }, { status: 404 })
  }

  const startedAt = new Date().toISOString()
  const started = Date.now()
  const cacheKey = `health:${provider}`
  const cached = cacheGet<ResearchHealthStatus>(cacheKey)

  let health: ResearchHealthStatus
  if (cached) {
    health = cached
  } else {
    const adapter = getImplementedAdapter(provider)
    health = adapter
      ? await adapter.healthCheck()
      : { provider, state: 'not_implemented', checkedAt: new Date().toISOString(), detail: 'No adapter implemented in this build phase.', durationMs: 0 }
    cacheSet(cacheKey, health, CACHE_TTL.health)
  }

  recordResearchAudit({
    operation: 'provider_health',
    provider,
    queryHash: null,
    startedAt,
    durationMs: Date.now() - started,
    resultCount: null,
    outcome: health.state === 'ready' ? 'success' : 'failure',
    errorCategory: health.state === 'ready' ? null : health.state,
    requestedBy: commander.userId,
  })

  return NextResponse.json({ tool: 'research-engine-provider-health', status: 'ready', health, secretsExposed: false })
}
