/**
 * Storage report. Read-only. Never deletes Commander files.
 */
import { existsSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'
import { cacheBytes, cacheRoot } from './cache'

export type HvsStorageReport = {
  createdAt: string
  filesystemBytes: number | null
  freeBytes: number | null
  mediaCommandTotal: number
  originals: number
  renders: number
  tmp: number
  cache: number
  analysis: number
  jobs: number
  proxies: number
  thumbs: number
  projects: number
  tools: number
  models: number
}

async function dirBytes(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0
  let total = 0
  const walk = async (current: string) => {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      try {
        if (entry.isDirectory()) await walk(full)
        else if (entry.isFile()) total += statSync(full).size
      } catch {
        /* isolation */
      }
    }
  }
  await walk(dir)
  return total
}

/** Piper/Comfy/FLUX still must not appear. Authorized exceptions are the ASR whisper file and the verified MoveNet Lightning file. */
export async function modelsBytesExcludingAuthorizedAsr(modelsTotal: number): Promise<number> {
  const { verifyMoveNetFile } = await import('./digital-human/movenet-catalog')
  const whisper = await dirBytes(path.join(mediaCommandDataHierarchy().models, 'whisper'))
  const pose = verifyMoveNetFile()
  return Math.max(0, modelsTotal - whisper - (pose.ok ? pose.bytes : 0))
}

function fsStat(): { filesystemBytes: number | null; freeBytes: number | null } {
  try {
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
    const df = spawnSync('df', ['-B1', '--output=size,avail', mediaCommandDataHierarchy().mediaCommandRoot], { encoding: 'utf8', timeout: 4000 })
    if (df.status === 0 && df.stdout) {
      const line = df.stdout.trim().split('\n').at(-1) ?? ''
      const nums = line.trim().split(/\s+/).map(Number)
      if (nums.length >= 2 && Number.isFinite(nums[0]) && Number.isFinite(nums[1])) {
        return { filesystemBytes: nums[0], freeBytes: nums[1] }
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const statfs = (require('node:fs') as typeof import('node:fs')).statfsSync
    if (typeof statfs !== 'function') return { filesystemBytes: null, freeBytes: null }
    const info = statfs(mediaCommandDataHierarchy().mediaCommandRoot)
    const bsize = Number(info.bsize ?? 0)
    const blocks = Number(info.blocks ?? 0)
    const bavail = Number(info.bavail ?? info.bfree ?? 0)
    if (!bsize || !blocks) return { filesystemBytes: null, freeBytes: null }
    return { filesystemBytes: bsize * blocks, freeBytes: bsize * bavail }
  } catch {
    return { filesystemBytes: null, freeBytes: null }
  }
}

export async function reportHvsStorage(): Promise<HvsStorageReport> {
  const dirs = mediaCommandDataHierarchy()
  const fs = fsStat()
  const [originals, renders, tmp, analysis, jobs, proxies, thumbs, projects, tools, models] = await Promise.all([
    dirBytes(dirs.originals),
    dirBytes(dirs.renders),
    dirBytes(dirs.tmp),
    dirBytes(dirs.analysis),
    dirBytes(dirs.jobs),
    dirBytes(dirs.proxies),
    dirBytes(dirs.thumbs),
    dirBytes(dirs.projects),
    dirBytes(dirs.tools),
    dirBytes(dirs.models),
  ])
  const cache = existsSync(cacheRoot()) ? cacheBytes().total : 0
  const mediaCommandTotal = originals + renders + tmp + analysis + jobs + proxies + thumbs + projects + tools + cache + models
  return {
    createdAt: new Date().toISOString(),
    filesystemBytes: fs.filesystemBytes,
    freeBytes: fs.freeBytes,
    mediaCommandTotal,
    originals,
    renders,
    tmp,
    cache,
    analysis,
    jobs,
    proxies,
    thumbs,
    projects,
    tools,
    models,
  }
}
