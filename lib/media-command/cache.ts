/**
 * Disposable HVS caches. Cache is acceleration, never project truth.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'
import { stripSecrets } from './secrets'

export const HVS_CACHE_CATEGORIES = [
  'generation',
  'analysis',
  'embedding',
  'effect',
  'color',
  'audio',
  'render',
  'proxy',
] as const

export type HvsCacheCategory = (typeof HVS_CACHE_CATEGORIES)[number]

export type HvsCacheEntry = {
  key: string
  category: HvsCacheCategory
  createdAt: string
  size: number
  sourceFingerprint: string | null
  backend: string
  hit: boolean
  miss: boolean
  path: string
}

export function cacheRoot(): string {
  const dir = path.join(mediaCommandDataHierarchy().mediaCommandRoot, 'cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function cacheDir(category: HvsCacheCategory): string {
  const dir = path.join(cacheRoot(), category)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function cacheMetaPath(category: HvsCacheCategory, key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)
  return path.join(cacheDir(category), `${safe}.meta.json`)
}

export function writeCacheMeta(entry: HvsCacheEntry): HvsCacheEntry {
  const clean = stripSecrets(entry)
  writeFileSync(cacheMetaPath(entry.category, entry.key), `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
  return clean
}

export function cacheBytes(): Record<HvsCacheCategory | 'total', number> {
  const out = { total: 0 } as Record<HvsCacheCategory | 'total', number>
  for (const category of HVS_CACHE_CATEGORIES) {
    const dir = path.join(cacheRoot(), category)
    let sum = 0
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        try {
          sum += statSync(path.join(dir, name)).size
        } catch {
          /* ignore */
        }
      }
    }
    out[category] = sum
    out.total += sum
  }
  return out
}

export const CACHE_CONTRACT = `
CACHE CONTRACT
Cache lives under media-command/cache/{category}.
Cache is disposable acceleration.
Cache is NOT .hvsproj truth and MUST NOT be required to open a project.
A cache miss is a valid state. Missing cache never marks a job COMPLETED.
`.trim()
