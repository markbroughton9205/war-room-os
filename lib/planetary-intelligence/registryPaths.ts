import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { planetaryLiveStoreDir } from './livePersistence'

export const LOCAL_SQLITE_PLANETARY_REGISTRY = 'LOCAL_SQLITE_PLANETARY_REGISTRY' as const
export const PLANETARY_REGISTRY_SCHEMA_VERSION = 2

export function planetaryRegistryDir(rootDir?: string): string {
  if (rootDir?.trim()) return path.isAbsolute(rootDir) ? rootDir : path.resolve(resolveBaseRepoRoot(), rootDir)
  return planetaryLiveStoreDir()
}

export function planetaryRegistrySqlitePath(rootDir?: string): string {
  return path.join(planetaryRegistryDir(rootDir), 'registry.sqlite')
}

export function resolvePlanetaryRegistryTarget(rootDir?: string): {
  resolved: true
  target: typeof LOCAL_SQLITE_PLANETARY_REGISTRY
  path: string
  hostedSupabase: false
  relational: true
  engine: 'node:sqlite'
  notASecondStack: true
} {
  return {
    resolved: true,
    target: LOCAL_SQLITE_PLANETARY_REGISTRY,
    path: planetaryRegistrySqlitePath(rootDir),
    hostedSupabase: false,
    relational: true,
    engine: 'node:sqlite',
    notASecondStack: true,
  }
}

export function registryDoesNotUseHostedSupabase(url?: string | null): boolean {
  const host = (() => {
    try {
      return url ? new URL(url).hostname : ''
    } catch {
      return ''
    }
  })()
  return !host.endsWith('supabase.co')
}
