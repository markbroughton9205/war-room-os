/**
 * Compact, truthful platform snapshot for council prompts (client-side).
 * Cached 30s; fetches are **sequential** with a small gap to avoid API bursts
 * (aligns with conservative use of /api/workers/limits semantics).
 */

const CACHE_TTL_MS = 30_000
const STAGGER_MS = 120

export type PlatformBrief = {
  fetchedAt: string
  deployStatus?: unknown
  workerLimits?: unknown
  permissions?: unknown
  actionQueue?: unknown
  engineControl?: unknown
  errors: string[]
}

let cache: { expires: number; value: PlatformBrief } | null = null
let inFlight: Promise<PlatformBrief> | null = null

function sleep(ms: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms)
  })
}

async function safeJson(fetchImpl: typeof fetch, url: string, errors: string[]) {
  try {
    const res = await fetchImpl(url, { cache: 'no-store' })
    const j: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      errors.push(`${url}: HTTP ${res.status}`)
      return undefined
    }
    return j
  } catch (e) {
    errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`)
    return undefined
  }
}

/**
 * @param fetchImpl — inject `fetch` (browser or test).
 */
export async function buildPlatformBrief(fetchImpl: typeof fetch = fetch): Promise<PlatformBrief> {
  const now = Date.now()
  if (cache && cache.expires > now) return cache.value
  if (inFlight) return inFlight

  inFlight = (async () => {
    const errors: string[] = []
    const deployStatus = await safeJson(fetchImpl, '/api/deploy/status', errors)
    await sleep(STAGGER_MS)
    const workerLimits = await safeJson(fetchImpl, '/api/workers/limits', errors)
    await sleep(STAGGER_MS)
    const permissions = await safeJson(fetchImpl, '/api/permissions/status', errors)
    await sleep(STAGGER_MS)
    const actionQueue = await safeJson(fetchImpl, '/api/actions/queue?limit=5', errors)
    await sleep(STAGGER_MS)
    const engineControl = await safeJson(fetchImpl, '/api/engine-control/status', errors)

    const value: PlatformBrief = {
      fetchedAt: new Date().toISOString(),
      deployStatus,
      workerLimits,
      permissions,
      actionQueue,
      engineControl,
      errors,
    }
    cache = { expires: Date.now() + CACHE_TTL_MS, value }
    return value
  })()

  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

/** Test helper */
export function __resetPlatformBriefCacheForTests() {
  cache = null
  inFlight = null
}
