import 'server-only'

/**
 * In-memory TTL cache shared by Research Engine adapters. No new database or
 * Redis per the build's dependency policy — this resets on redeploy, which
 * is fine for a soft "don't hammer the upstream provider" cache.
 */
type CacheEntry<T> = { value: T; expiresAt: number }

const store = new Map<string, CacheEntry<unknown>>()

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.value as T
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

export async function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<{ value: T; fromCache: boolean }> {
  const cached = cacheGet<T>(key)
  if (cached !== null) return { value: cached, fromCache: true }
  const value = await fn()
  cacheSet(key, value, ttlMs)
  return { value, fromCache: false }
}

export const CACHE_TTL = {
  scholarlyMetadata: 24 * 60 * 60 * 1000,
  timeSeries: 6 * 60 * 60 * 1000,
  liveFeed: 60 * 1000,
  codelist: 7 * 24 * 60 * 60 * 1000,
  webSearch: 5 * 60 * 1000,
  health: 30 * 1000,
  errorCooldown: 30 * 1000,
} as const

export function __resetCacheForTests(): void {
  store.clear()
}
