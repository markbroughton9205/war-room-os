/**
 * War Room desktop CDP ownership and discovery.
 * Electron claims a loopback port (9222 if free, else 9230-9249, else ephemeral)
 * and persists it to application-data runtime/desktop-runtime.json.
 * Consumers discover that endpoint; none independently assume 127.0.0.1:9222.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'

export const WAR_ROOM_CDP_ADDRESS = '127.0.0.1'
export const WAR_ROOM_CDP_PREFERRED_PORT = 9222
export const WAR_ROOM_CDP_RANGE = { start: 9230, end: 9249 } as const
export const DESKTOP_RUNTIME_FILENAME = 'desktop-runtime.json'

export type DesktopCdpRuntime = {
  cdpAddress: string
  bind: string
  cdpPort: number
  pid?: number
  selectedAt?: string
  preferredPort?: number
  range?: { start: number; end: number }
  allocation?: string
  cursorPortCollision?: boolean
  ephemeral?: boolean
}

function runtimeDir(override?: string): string {
  if (override) return override
  const dir = resolveLocalAppDataPaths().runtime
  mkdirSync(dir, { recursive: true })
  return dir
}

export function desktopRuntimePath(runtimeDirOverride?: string): string {
  return path.join(runtimeDir(runtimeDirOverride), DESKTOP_RUNTIME_FILENAME)
}

export function readDesktopCdpRuntime(runtimeDirOverride?: string): DesktopCdpRuntime | null {
  try {
    const parsed = JSON.parse(readFileSync(desktopRuntimePath(runtimeDirOverride), 'utf8')) as DesktopCdpRuntime
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function persistDesktopRuntime(record: Partial<DesktopCdpRuntime> & { cdpPort: number }, runtimeDirOverride?: string): DesktopCdpRuntime {
  const dir = runtimeDir(runtimeDirOverride)
  mkdirSync(dir, { recursive: true })
  const dest = desktopRuntimePath(runtimeDirOverride)
  const tmp = `${dest}.tmp-${process.pid}`
  const body: DesktopCdpRuntime = {
    cdpAddress: WAR_ROOM_CDP_ADDRESS,
    bind: WAR_ROOM_CDP_ADDRESS,
    cdpPort: record.cdpPort,
    pid: record.pid ?? process.pid,
    selectedAt: record.selectedAt ?? new Date().toISOString(),
    preferredPort: WAR_ROOM_CDP_PREFERRED_PORT,
    range: { start: WAR_ROOM_CDP_RANGE.start, end: WAR_ROOM_CDP_RANGE.end },
    allocation: record.allocation ?? 'range',
    cursorPortCollision: record.cursorPortCollision === true,
    ephemeral: record.ephemeral === true,
  }
  writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8')
  renameSync(tmp, dest)
  return body
}

export function loopbackPortInUse(port: number): boolean {
  const n = Number(port)
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return true
  const script = [
    'const net=require("net");',
    'const s=net.createServer();',
    's.once("error",(e)=>{process.stdout.write(e && e.code==="EADDRINUSE"?"1":"1");});',
    `s.listen({host:${JSON.stringify(WAR_ROOM_CDP_ADDRESS)},port:${n},exclusive:true},()=>{s.close(()=>{process.stdout.write("0");});});`,
  ].join('')
  try {
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 1200 })
    if (String(r.stdout).trim() === '0') return false
  } catch {
    /* fail closed */
  }
  return true
}

function uniquePorts(ports: number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const port of ports) {
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || seen.has(port)) continue
    seen.add(port)
    out.push(port)
  }
  return out
}

export function candidateWarRoomCdpPorts(runtimeDirOverride?: string): number[] {
  const envPort = Number(process.env.WAR_ROOM_CDP_PORT)
  const persisted = readDesktopCdpRuntime(runtimeDirOverride)
  const ports: number[] = []
  if (Number.isInteger(envPort) && envPort > 0) ports.push(envPort)
  if (Number.isInteger(Number(persisted?.cdpPort)) && Number(persisted?.cdpPort) > 0) ports.push(Number(persisted?.cdpPort))
  ports.push(WAR_ROOM_CDP_PREFERRED_PORT)
  for (let port = WAR_ROOM_CDP_RANGE.start; port <= WAR_ROOM_CDP_RANGE.end; port += 1) ports.push(port)
  return uniquePorts(ports)
}

function bindEphemeralLoopback(): number {
  const script = [
    'const net=require("net");',
    'const s=net.createServer();',
    `s.listen({host:${JSON.stringify(WAR_ROOM_CDP_ADDRESS)},port:0,exclusive:true},()=>{`,
    'const p=s.address().port;s.close(()=>{process.stdout.write(String(p));});',
    '});',
  ].join('')
  try {
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 1500 })
    const port = Number(String(r.stdout).trim())
    if (Number.isInteger(port) && port > 0) return port
  } catch {
    /* ignore */
  }
  return 0
}

export function claimWarRoomCdpEndpoint(runtimeDirOverride?: string): DesktopCdpRuntime {
  const occupiedPreferred = loopbackPortInUse(WAR_ROOM_CDP_PREFERRED_PORT)
  for (const port of candidateWarRoomCdpPorts(runtimeDirOverride)) {
    if (loopbackPortInUse(port)) continue
    const allocation = port === WAR_ROOM_CDP_PREFERRED_PORT
      ? 'preferred'
      : (port >= WAR_ROOM_CDP_RANGE.start && port <= WAR_ROOM_CDP_RANGE.end ? 'range' : 'configured')
    return persistDesktopRuntime({
      cdpPort: port,
      allocation,
      cursorPortCollision: occupiedPreferred && port !== WAR_ROOM_CDP_PREFERRED_PORT,
      ephemeral: false,
      pid: process.pid,
    }, runtimeDirOverride)
  }
  const ephemeral = bindEphemeralLoopback()
  return persistDesktopRuntime({
    cdpPort: ephemeral,
    allocation: 'ephemeral',
    cursorPortCollision: occupiedPreferred,
    ephemeral: true,
    pid: process.pid,
  }, runtimeDirOverride)
}

export function isLoopbackCdpAddress(address: string): boolean {
  return address === WAR_ROOM_CDP_ADDRESS || address === 'localhost' || address === '::1'
}

export function warRoomCdpOriginFromRuntime(runtime?: DesktopCdpRuntime | null): string | null {
  const port = Number(runtime?.cdpPort)
  if (!Number.isInteger(port) || port <= 0) return null
  const address = runtime?.cdpAddress || WAR_ROOM_CDP_ADDRESS
  if (!isLoopbackCdpAddress(address) || (runtime?.bind && !isLoopbackCdpAddress(runtime.bind))) return null
  return `http://${WAR_ROOM_CDP_ADDRESS}:${port}`
}

export async function probeCdpJson<T>(origin: string, pathname: string): Promise<T | null> {
  try {
    const res = await fetch(`${origin}${pathname}`, { signal: AbortSignal.timeout(1_200) })
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

export type CdpDiscoveryTarget = { type?: string; url?: string; title?: string; webSocketDebuggerUrl?: string }

export async function discoverWarRoomCdpOrigin(input?: {
  isAllowedTarget?: (target: CdpDiscoveryTarget) => boolean
  runtimeDirOverride?: string
}): Promise<{ origin: string; port: number; address: string; allocation?: string } | null> {
  const persisted = readDesktopCdpRuntime(input?.runtimeDirOverride)
  const ports = candidateWarRoomCdpPorts(input?.runtimeDirOverride)
  const allow = input?.isAllowedTarget
  for (const port of ports) {
    const origin = `http://${WAR_ROOM_CDP_ADDRESS}:${port}`
    const targets = await probeCdpJson<CdpDiscoveryTarget[]>(origin, '/json/list')
      ?? await probeCdpJson<CdpDiscoveryTarget[]>(origin, '/json')
    if (!Array.isArray(targets) || targets.length === 0) continue
    const pages = targets.filter(item => item.type === 'page' && item.webSocketDebuggerUrl)
    if (allow) {
      if (!pages.some(item => allow(item))) continue
    } else if (pages.some(item => /cursor/i.test(`${item.title ?? ''} ${item.url ?? ''}`)) && !pages.some(item => /127\.0\.0\.1:3848/.test(String(item.url ?? '')))) {
      continue
    }
    return {
      origin,
      port,
      address: WAR_ROOM_CDP_ADDRESS,
      allocation: persisted?.cdpPort === port ? persisted.allocation : undefined,
    }
  }
  const fallback = warRoomCdpOriginFromRuntime(persisted)
  if (fallback && persisted) {
    return { origin: fallback, port: persisted.cdpPort, address: WAR_ROOM_CDP_ADDRESS, allocation: persisted.allocation }
  }
  return null
}
