/**
 * W1: hold Tool Broker writes that would clobber a dirty Commander workbench buffer.
 */
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type DirtyGuardResult = { blocked: boolean; reason?: string; paths?: string[] }

function dirtyManifestPath(): string {
  if (process.env.FOUNDRY_WORKBENCH_STATE_DIR) {
    return path.join(path.resolve(process.env.FOUNDRY_WORKBENCH_STATE_DIR), 'dirty-buffers.json')
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  return path.join(xdg, 'war-room-os', 'data', 'foundry', 'workbench', 'dirty-buffers.json')
}

export function readDirtyCommanderBuffers(): string[] {
  const file = dirtyManifestPath()
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { paths?: unknown }
    return Array.isArray(parsed.paths) ? parsed.paths.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function refuseIfDirtyCommanderBuffer(absOrRel: string): DirtyGuardResult {
  const dirty = readDirtyCommanderBuffers()
  if (!dirty.length) return { blocked: false }
  const target = path.resolve(absOrRel)
  const hit = dirty.find(item => path.resolve(item) === target || target.endsWith(path.sep + item) || item.endsWith(path.sep + target) || path.basename(item) === path.basename(target) && target.includes(path.basename(item)))
  if (!hit) return { blocked: false, paths: dirty }
  return {
    blocked: true,
    reason: 'DIRTY_COMMANDER_BUFFER: Tool Broker write held until the Commander buffer is saved or discarded.',
    paths: dirty,
  }
}
