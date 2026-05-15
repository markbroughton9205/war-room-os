import { NextResponse } from 'next/server'

import { collectEngineStatuses } from '@/lib/engine-control/status'
import { buildToolRoutingSnapshotFromOrigin, requestOriginFromHeaders } from '@/lib/engine-control/tool-snapshot'
import type { EngineId } from '@/lib/engine-control/types'

export const dynamic = 'force-dynamic'

type ProviderHealthRow = {
  provider: EngineId
  keyPresent: boolean
  configured: boolean
  preflightStatus: 'healthy' | 'degraded' | 'unavailable'
  errorType: string | null
  timedOut: boolean
  durationMs: number
}

const CLOUD_ENV: Record<EngineId, string> = {
  chatgpt: 'OPENAI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  grok: 'XAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  ollama: '',
  lm_studio: '',
  continue: '',
  aider: '',
  openhands: '',
  goose: '',
  cursor: '',
  codex: 'OPENAI_API_KEY',
}

const CLOUD_PROVIDERS: EngineId[] = ['chatgpt', 'claude', 'grok', 'gemini']

function keyPresent(id: EngineId): boolean {
  const env = CLOUD_ENV[id]
  if (!env) return false
  return Boolean(process.env[env]?.trim())
}

function classifyPreflight(
  configured: boolean,
  functional: boolean,
  reachable: boolean,
): ProviderHealthRow['preflightStatus'] {
  if (!configured) return 'unavailable'
  if (functional) return 'healthy'
  if (configured && reachable) return 'degraded'
  if (configured) return 'degraded'
  return 'unavailable'
}

export async function GET() {
  const started = Date.now()
  let engines: Awaited<ReturnType<typeof collectEngineStatuses>> = []
  let collectError: string | null = null
  let timedOut = false

  try {
    const origin = await requestOriginFromHeaders()
    const tools = await buildToolRoutingSnapshotFromOrigin(origin)
    const raced = await Promise.race([
      collectEngineStatuses(tools),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('engine_status_collect_timeout')), 12_000)
      }),
    ])
    engines = raced
  } catch (e) {
    collectError = e instanceof Error ? e.message : String(e)
    timedOut = collectError.includes('timeout')
  }

  const durationMs = Date.now() - started
  const byId = new Map(engines.map(e => [e.id, e]))

  const providers: ProviderHealthRow[] = CLOUD_PROVIDERS.map(provider => {
    const row = byId.get(provider)
    const present = keyPresent(provider)
    const configured = row?.configured ?? present
    const functional = row?.functional ?? false
    const reachable = row?.reachable ?? false
    const preflightStatus = collectError && present
      ? 'degraded'
      : classifyPreflight(configured, functional, reachable)

    let errorType: string | null = null
    if (!present) errorType = 'missing_key'
    else if (collectError) errorType = timedOut ? 'status_collect_timeout' : 'status_collect_error'
    else if (!functional && configured) errorType = 'not_functional'
    else if (!configured) errorType = 'not_configured'

    return {
      provider,
      keyPresent: present,
      configured,
      preflightStatus,
      errorType,
      timedOut: timedOut && Boolean(present),
      durationMs,
    }
  })

  return NextResponse.json({
    tool: 'provider-health',
    checkedAt: new Date().toISOString(),
    durationMs,
    statusCollectError: collectError,
    providers,
  })
}
