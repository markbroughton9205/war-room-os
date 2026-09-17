import { createHash } from 'node:crypto'
import { copyFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'

export const LOCAL_FILESYSTEM_FALLBACK = 'LOCAL_FILESYSTEM_FALLBACK' as const
export const PLANETARY_LIVE_STORE_VERSION = 1

export function planetaryLiveStoreDir(): string {
  return path.join(resolveBaseRepoRoot(), '.war-room', 'planetary-intelligence')
}

export type PlanetaryFilesystemPersistResult =
  | {
      ok: true
      label: typeof LOCAL_FILESYSTEM_FALLBACK
      version: number
      path: string
      sha256: string
      relational: false
    }
  | { ok: false; label: typeof LOCAL_FILESYSTEM_FALLBACK; error: string }

export async function persistPlanetaryLiveMission(missionId: string, payload: unknown): Promise<PlanetaryFilesystemPersistResult> {
  try {
    const dir = path.join(planetaryLiveStoreDir(), 'missions')
    await mkdir(dir, { recursive: true })
    const envelope = {
      label: LOCAL_FILESYSTEM_FALLBACK,
      version: PLANETARY_LIVE_STORE_VERSION,
      missionId,
      recordedAt: new Date().toISOString(),
      payload,
    }
    const body = JSON.stringify(envelope, null, 2)
    const sha256 = createHash('sha256').update(body).digest('hex')
    const filePath = path.join(dir, `${missionId}.v${PLANETARY_LIVE_STORE_VERSION}.json`)
    const tmpPath = `${filePath}.${process.pid}.tmp`
    await writeFile(tmpPath, body, 'utf8')
    try {
      await rename(tmpPath, filePath)
    } catch {
      await copyFile(tmpPath, filePath)
      await unlink(tmpPath)
    }
    await writeFile(`${filePath}.sha256`, `${sha256}\n`, 'utf8')
    return {
      ok: true,
      label: LOCAL_FILESYSTEM_FALLBACK,
      version: PLANETARY_LIVE_STORE_VERSION,
      path: filePath,
      sha256,
      relational: false,
    }
  } catch (error) {
    return { ok: false, label: LOCAL_FILESYSTEM_FALLBACK, error: error instanceof Error ? error.message : String(error) }
  }
}

export function filesystemFallbackIsNotRelational(result: PlanetaryFilesystemPersistResult): boolean {
  return result.ok === false || result.relational === false
}
