import 'server-only'

import type { TerraUrbanTilePayload } from './types'
import {
  TERRA_URBAN_FRESH_TTL_MS,
  TERRA_URBAN_STALE_WINDOW_MS,
  classifyUrbanCacheFreshness,
  computeOverpassBackoffMs,
  type UrbanCacheFreshness,
} from './requestControl'

export const TERRA_URBAN_CACHE_TTL_MS = TERRA_URBAN_FRESH_TTL_MS
export const TERRA_URBAN_ERROR_TTL_MS = 45 * 1000

type GeometryEntry = {
  payload: TerraUrbanTilePayload
  freshUntil: number
  staleUntil: number
}

type BackoffState = {
  blockedUntil: number
  consecutive: number
  retryAfterMs: number | null
}

const geometryStore = new Map<string, GeometryEntry>()
let overpassBackoff: BackoffState = { blockedUntil: 0, consecutive: 0, retryAfterMs: null }

export type UrbanCacheRecord = {
  payload: TerraUrbanTilePayload
  freshness: Exclude<UrbanCacheFreshness, 'EXPIRED'>
}

export function readUrbanTileCache(key: string, now = Date.now()): TerraUrbanTilePayload | null {
  const record = readUrbanTileCacheRecord(key, now)
  return record?.payload ?? null
}

export function readUrbanTileCacheRecord(key: string, now = Date.now()): UrbanCacheRecord | null {
  const entry = geometryStore.get(key)
  if (!entry) return null
  const freshness = classifyUrbanCacheFreshness(entry.freshUntil, entry.staleUntil, now)
  if (freshness === 'EXPIRED') {
    geometryStore.delete(key)
    return null
  }
  return { payload: entry.payload, freshness }
}

export function writeUrbanTileCache(key: string, payload: TerraUrbanTilePayload, ttlMs = TERRA_URBAN_CACHE_TTL_MS, now = Date.now()): void {
  geometryStore.set(key, {
    payload,
    freshUntil: now + ttlMs,
    staleUntil: now + ttlMs + TERRA_URBAN_STALE_WINDOW_MS,
  })
}

/** 429/503 suppression — not a geometry poison cache. */
export function readOverpassBackoffRemainingMs(now = Date.now()): number {
  return Math.max(0, overpassBackoff.blockedUntil - now)
}

export function isOverpassBackedOff(now = Date.now()): boolean {
  return readOverpassBackoffRemainingMs(now) > 0
}

export function noteOverpassSuccess(): void {
  overpassBackoff = { blockedUntil: 0, consecutive: 0, retryAfterMs: null }
}

export function noteOverpassRateLimit(retryAfterMs: number | null, now = Date.now()): BackoffState {
  const consecutive = overpassBackoff.consecutive + 1
  const waitMs = computeOverpassBackoffMs(consecutive, retryAfterMs)
  overpassBackoff = { blockedUntil: now + waitMs, consecutive, retryAfterMs: waitMs }
  return overpassBackoff
}

export function currentOverpassBackoff(): BackoffState {
  return { ...overpassBackoff }
}

export function __resetUrbanCacheForTests(): void {
  geometryStore.clear()
  overpassBackoff = { blockedUntil: 0, consecutive: 0, retryAfterMs: null }
}
