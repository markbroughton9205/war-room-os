/**
 * Disk-backed ownership for Application Builder project processes (preview/dev-server).
 * Survives mission-wrapper exit. Stop/restart uses this record — never arbitrary host pids.
 */
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { foundryDataHierarchy } from './foundryPaths'
import { isPathInsideRoot } from './workspaceRegistry'

export type FoundryProjectProcessType = 'preview' | 'dev-server'
export type FoundryProjectProcessOwnership = 'owned' | 'released-from-wrapper' | 'stopped'

export type FoundryProjectProcessRecord = {
  recordId: string
  projectId: string
  missionId: string
  pid: number
  port: number | null
  cwd: string
  startedAt: string
  processType: FoundryProjectProcessType
  ownership: FoundryProjectProcessOwnership
  label: string
  command: string
  args: string[]
}

function registryPath(): string {
  return path.join(foundryDataHierarchy().foundryRoot, 'application-builder', 'processes.json')
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function procCwd(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    return null
  }
}

export async function loadProjectProcessRegistry(): Promise<FoundryProjectProcessRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(registryPath(), 'utf8')) as FoundryProjectProcessRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function saveProjectProcessRegistry(records: FoundryProjectProcessRecord[]): Promise<void> {
  await mkdir(path.dirname(registryPath()), { recursive: true })
  await writeFile(registryPath(), JSON.stringify(records, null, 2), 'utf8')
}

function projectsRoot(): string {
  const env = process.env.FOUNDRY_PROJECTS_ROOT?.trim()
  if (env) return path.resolve(env)
  return path.join(os.homedir(), 'FoundryProjects')
}

export function isOwnedProjectCwd(cwd: string): boolean {
  return isPathInsideRoot(path.resolve(cwd), path.resolve(projectsRoot()))
}

export async function registerProjectProcess(record: FoundryProjectProcessRecord): Promise<FoundryProjectProcessRecord> {
  if (!isOwnedProjectCwd(record.cwd)) {
    throw new Error('REFUSED_PROJECT_PROCESS: cwd is outside FoundryProjects.')
  }
  if (!Number.isInteger(record.pid) || record.pid <= 1 || record.pid === process.pid) {
    throw new Error('REFUSED_PROJECT_PROCESS: pid is not a project child.')
  }
  const all = await loadProjectProcessRegistry()
  const next = all.filter(item => {
    if (item.recordId === record.recordId) return false
    if (item.projectId === record.projectId && item.processType === record.processType) return false
    if (item.pid === record.pid) return false
    return true
  })
  next.push(record)
  await saveProjectProcessRegistry(next)
  return record
}

export async function listProjectProcesses(projectId?: string): Promise<FoundryProjectProcessRecord[]> {
  const all = await loadProjectProcessRegistry()
  return projectId ? all.filter(item => item.projectId === projectId) : all
}

export async function findLiveProjectPreview(input: {
  projectId?: string
  projectRoot?: string
  port?: number
}): Promise<FoundryProjectProcessRecord | null> {
  const all = await loadProjectProcessRegistry()
  const matches = all.filter(item => {
    if (item.processType !== 'preview') return false
    if (item.ownership === 'stopped') return false
    if (input.projectId && item.projectId !== input.projectId) return false
    if (input.projectRoot && path.resolve(item.cwd) !== path.resolve(input.projectRoot)) return false
    if (input.port && item.port !== input.port) return false
    return isPidAlive(item.pid) && isOwnedProjectCwd(item.cwd)
  })
  for (const item of matches) {
    const liveCwd = procCwd(item.pid)
    if (liveCwd && path.resolve(liveCwd) !== path.resolve(item.cwd)) continue
    if (item.port) {
      const health = await probeLoopback(item.port)
      if (!health) continue
    }
    return item
  }
  return null
}

export async function markProjectProcessOwnership(
  recordId: string,
  ownership: FoundryProjectProcessOwnership,
): Promise<void> {
  const all = await loadProjectProcessRegistry()
  const next = all.map(item => item.recordId === recordId ? { ...item, ownership } : item)
  await saveProjectProcessRegistry(next)
}

export async function stopOwnedProjectPreview(input: {
  projectId: string
  pid?: number
}): Promise<{ ok: boolean; killed: number[]; refused: string[] }> {
  const killed: number[] = []
  const refused: string[] = []
  const all = await loadProjectProcessRegistry()
  const targets = all.filter(item => {
    if (item.projectId !== input.projectId) return false
    if (item.processType !== 'preview') return false
    if (input.pid != null && item.pid !== input.pid) return false
    return true
  })
  if (!targets.length) {
    refused.push('no owned preview record')
    return { ok: false, killed, refused }
  }
  for (const target of targets) {
    if (target.pid === process.pid || target.pid <= 1) {
      refused.push(`refuse self/system pid ${target.pid}`)
      continue
    }
    if (!isOwnedProjectCwd(target.cwd)) {
      refused.push('cwd outside FoundryProjects')
      continue
    }
    const liveCwd = procCwd(target.pid)
    if (liveCwd && path.resolve(liveCwd) !== path.resolve(target.cwd)) {
      refused.push('pid cwd mismatch — refuse arbitrary kill')
      continue
    }
    if (!isPidAlive(target.pid)) {
      target.ownership = 'stopped'
      continue
    }
    try {
      process.kill(target.pid, 'SIGTERM')
      killed.push(target.pid)
      target.ownership = 'stopped'
    } catch {
      refused.push(`SIGTERM failed for pid ${target.pid}`)
    }
  }
  await saveProjectProcessRegistry(all)
  return { ok: killed.length > 0 || refused.length === 0, killed, refused }
}

export async function adoptLoopbackPreview(input: {
  projectId: string
  projectRoot: string
  missionId: string
  port: number
  label?: string
}): Promise<FoundryProjectProcessRecord | null> {
  if (!isOwnedProjectCwd(input.projectRoot)) return null
  const existing = await findLiveProjectPreview({
    projectId: input.projectId,
    projectRoot: input.projectRoot,
    port: input.port,
  })
  if (existing) return existing
  const pid = findListenerPidOnLoopback(input.port)
  if (!pid || !isPidAlive(pid)) return null
  const cwd = procCwd(pid)
  if (!cwd || path.resolve(cwd) !== path.resolve(input.projectRoot)) return null
  return registerProjectProcess({
    recordId: `adopt-${input.projectId}-${input.port}`,
    projectId: input.projectId,
    missionId: input.missionId,
    pid,
    port: input.port,
    cwd: path.resolve(input.projectRoot),
    startedAt: new Date().toISOString(),
    processType: 'preview',
    ownership: 'owned',
    label: input.label ?? 'foundry-app-preview',
    command: 'node',
    args: ['server.mjs'],
  })
}

export function findListenerPidOnLoopback(port: number): number | null {
  const hexPort = port.toString(16).toUpperCase().padStart(4, '0')
  const files = ['/proc/net/tcp', '/proc/net/tcp6']
  for (const file of files) {
    if (!existsSync(file)) continue
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/)
      if (cols.length < 10) continue
      const local = cols[1]
      const state = cols[3]
      const inode = cols[9]
      if (state !== '0A') continue
      const portPart = local.split(':')[1]
      if (portPart !== hexPort) continue
      const pid = pidForSocketInode(inode)
      if (pid) return pid
    }
  }
  return null
}

function pidForSocketInode(inode: string): number | null {
  if (!inode || inode === '0') return null
  try {
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue
      const pid = Number(entry)
      let fds: string[]
      try {
        fds = readdirSync(`/proc/${pid}/fd`)
      } catch {
        continue
      }
      for (const fd of fds) {
        try {
          const target = readlinkSync(`/proc/${pid}/fd/${fd}`)
          if (target === `socket:[${inode}]`) return pid
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    return null
  }
  return null
}

export function probeLoopback(port: number, pathname = '/'): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: 'GET',
      agent: false,
      timeout: 2000,
    }, res => {
      res.resume()
      resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 500)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.end()
  })
}

export { isPidAlive }
