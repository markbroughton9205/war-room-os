import 'server-only'

/**
 * Server-side cache of camera still URLs keyed by federated camera id. Adapters write the
 * source-supplied imageUrl here when they ingest a catalog; the camera-image proxy reads it so
 * the browser never supplies a URL (no SSRF surface) and so we never reconstruct an unknown
 * LargeUrl pattern. Entries expire with the live-feed TTL — inspect/hover of a camera that is
 * not in the current catalog is an honest miss, not a guessed URL.
 */
type CachedImage = { url: string; attribution: string; expiresAt: number }

const store = new Map<string, CachedImage>()
const TTL_MS = 5 * 60 * 1000

function cacheKey(provider: string, id: string): string {
  return `${provider}:${id}`
}

export function rememberCameraImageUrl(provider: string, id: string, url: string, attribution: string): void {
  if (!provider || !id || !url) return
  store.set(cacheKey(provider, id), { url, attribution, expiresAt: Date.now() + TTL_MS })
}

export function lookupCameraImageUrl(provider: string, id: string): { url: string; attribution: string } | null {
  const entry = store.get(cacheKey(provider, id))
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(cacheKey(provider, id))
    return null
  }
  return { url: entry.url, attribution: entry.attribution }
}

export function __resetCameraImageUrlCacheForTests(): void {
  store.clear()
}
