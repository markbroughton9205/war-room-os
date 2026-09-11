import { NextResponse } from 'next/server'
import { readLocalBuildMeta, resolveGitCommitShortFromEnv } from '@/lib/deploy/status'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Process boot timestamp — module load is server process start for this route bundle. */
const PROCESS_STARTED_AT_MS = Date.now()

const CHEAP_PROBE_MS = 400

type Reachability = 'ok' | 'unreachable' | 'skipped'

async function cheapGet(url: string, ms = CHEAP_PROBE_MS): Promise<Reachability> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(ms),
    })
    return res.ok || res.status === 401 || res.status === 403 ? 'ok' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

/**
 * Lightweight public liveness probe for origin / Cloudflare / watchdog use.
 * Must stay sub-second: no Council, Terra, research, Overpass, or heavy DB work.
 *
 * Semantics (#18):
 * - HTTP 200 + status "ok"       → APPLICATION_HEALTHY (app answers; deps ok/skipped)
 * - HTTP 200 + status "degraded" → DEPENDENCY_DEGRADED (app answers; a cheap dep failed)
 * - No HTTP / hang / non-response → APPLICATION_UNHEALTHY (detected by external probes)
 *
 * Dependency degradation must NOT itself hang this endpoint and must NOT cause
 * the production supervisor to restart the web shell.
 */
export async function GET() {
  const started = Date.now()
  const localBuild = await readLocalBuildMeta()
  const envShort = resolveGitCommitShortFromEnv()

  const supabaseUrl = typeof process.env.NEXT_PUBLIC_SUPABASE_URL === 'string'
    ? process.env.NEXT_PUBLIC_SUPABASE_URL.trim().replace(/\/$/, '')
    : ''
  const ollamaBase = (
    typeof process.env.OLLAMA_BASE_URL === 'string' && process.env.OLLAMA_BASE_URL.trim()
      ? process.env.OLLAMA_BASE_URL.trim()
      : 'http://127.0.0.1:11434'
  ).replace(/\/$/, '')

  const [database, ollama] = await Promise.all([
    supabaseUrl
      ? cheapGet(`${supabaseUrl}/auth/v1/health`)
      : Promise.resolve('skipped' as Reachability),
    cheapGet(`${ollamaBase}/api/tags`),
  ])

  const depsDegraded = database === 'unreachable' || ollama === 'unreachable'
  const status = depsDegraded ? 'degraded' : 'ok'

  const body = {
    status,
    application: 'healthy' as const,
    dependencyState: depsDegraded ? 'degraded' as const : 'ok' as const,
    version: {
      gitSha: localBuild?.gitSha ?? null,
      gitShort: localBuild?.gitShort ?? envShort,
      gitRef: localBuild?.gitRef ?? null,
      builtAt: localBuild?.builtAt ?? null,
      nodeEnv: process.env.NODE_ENV ?? null,
    },
    uptimeSec: Math.max(0, Math.round((Date.now() - PROCESS_STARTED_AT_MS) / 1000)),
    runtime: {
      pid: process.pid,
      platform: process.platform,
      node: process.version,
    },
    checks: {
      database,
      ollama,
    },
    elapsedMs: Date.now() - started,
  }

  return NextResponse.json(body, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
