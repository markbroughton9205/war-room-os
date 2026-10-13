import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statfsSync } from 'node:fs'
import os from 'node:os'
import { loopbackBaseUrl } from '@/lib/agents/ops/engineering/runtime/ollamaModel'
import type { ModelClient } from '@/lib/agents/ops/engineering/runtime/ports'
import type { ResidentModel } from './governor'
import { MODEL_ROLES } from './roles'
import type { InstalledModel, NodeRecord } from './nodeRecord'
import { governedClientForRef } from './poolRuntime'
import type { ResidencyGovernor } from './governor'
import type { ModelEntry } from './types'

/**
 * The LOCAL node as a full NodeRecord, measured from the machine and the loopback runtime (read-only: /api/tags, /api/ps, /api/version, nvidia-smi,
 * /proc, statfs). Nothing is loaded or called. Anything that cannot be read stays UNKNOWN-as-absent: an unreadable runtime makes the node UNREACHABLE
 * (heartbeat epoch), never "healthy by default".
 */
export type LocalProbeDeps = {
  fetchImpl?: typeof fetch
  now?: () => Date
  gpus?: () => { model: string; vramMiB: number; usedMiB: number; utilPct: number }[]
  ram?: () => { totalMiB: number; usedMiB: number } | null
  cpu?: () => { model: string; cores: number; threads: number }
  disk?: () => { totalBytes: number; freeBytes: number } | null
  networkMbps?: () => number | 'UNKNOWN'
  hostname?: () => string
}

const readGpus: NonNullable<LocalProbeDeps['gpus']> = () => {
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total,memory.used,utilization.gpu', '--format=csv,noheader,nounits'], { timeout: 5000 }).toString().trim()
    return out.split('\n').filter(Boolean).map((l) => { const [name, total, used, util] = l.split(',').map((s) => s.trim()); return { model: name, vramMiB: Number(total), usedMiB: Number(used), utilPct: Number(util) || 0 } }).filter((g) => Number.isFinite(g.vramMiB) && g.vramMiB > 0)
  } catch { return [] }
}
const readRam: NonNullable<LocalProbeDeps['ram']> = () => {
  try { const m = readFileSync('/proc/meminfo', 'utf8'); const g = (k: string) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(m)?.[1]); const t = g('MemTotal'), a = g('MemAvailable'); return Number.isFinite(t) && Number.isFinite(a) ? { totalMiB: Math.round(t / 1024), usedMiB: Math.round((t - a) / 1024) } : null } catch { return null }
}
const readCpu: NonNullable<LocalProbeDeps['cpu']> = () => { const c = os.cpus(); return { model: c[0]?.model?.trim() ?? 'UNKNOWN', cores: Math.max(1, Math.round(c.length / 2)), threads: Math.max(1, c.length) } }
const readDisk: NonNullable<LocalProbeDeps['disk']> = () => { try { const s = statfsSync(os.homedir()); return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize } } catch { return null } }
const readNet: NonNullable<LocalProbeDeps['networkMbps']> = () => {
  // fastest wired/virtual link the kernel reports a speed for (negative / unreadable speeds are skipped); UNKNOWN when none
  try {
    const speeds = readdirSync('/sys/class/net').filter((i) => i !== 'lo').map((i) => { try { return Number(readFileSync(`/sys/class/net/${i}/speed`, 'utf8').trim()) } catch { return NaN } }).filter((n) => Number.isFinite(n) && n > 0)
    return speeds.length ? Math.max(...speeds) : 'UNKNOWN'
  } catch { return 'UNKNOWN' }
}

export type LocalProbe = { record: NodeRecord; quantizations: Record<string, string>; runtimeVersion: string | 'UNKNOWN'; reachable: boolean }

export async function probeLocalNode(opts: { id?: string; base?: string; deps?: LocalProbeDeps } = {}): Promise<LocalProbe> {
  const d = opts.deps ?? {}
  const f = d.fetchImpl ?? fetch
  const now = (d.now ?? (() => new Date()))()
  const base = loopbackBaseUrl(opts.base)
  const quantizations: Record<string, string> = {}
  let installed: InstalledModel[] = [], resident: ResidentModel[] = [], reachable = false, version: string | 'UNKNOWN' = 'UNKNOWN'
  try {
    const tags = await f(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) })
    if (tags.ok) {
      reachable = true
      const j = (await tags.json()) as { models?: { name?: string; model?: string; size?: number; digest?: string; details?: { quantization_level?: string } }[] }
      installed = (j.models ?? []).flatMap((m) => { const ref = String(m.name ?? m.model ?? ''); if (!ref || typeof m.size !== 'number') return []; if (m.details?.quantization_level) quantizations[ref] = m.details.quantization_level; return [{ ref, digest: m.digest ? `sha256:${m.digest}` : 'UNKNOWN', sizeBytes: m.size }] })
    }
    const ps = await f(`${base}/api/ps`, { signal: AbortSignal.timeout(4000) })
    if (ps.ok) { const j = (await ps.json()) as { models?: { name?: string; model?: string; size?: number; size_vram?: number }[] }; resident = (j.models ?? []).map((m) => ({ ref: String(m.name ?? m.model ?? ''), sizeBytes: typeof m.size === 'number' ? m.size : ('UNKNOWN' as const), vramBytes: typeof m.size_vram === 'number' ? m.size_vram : ('UNKNOWN' as const) })).filter((m) => m.ref) }
    const v = await f(`${base}/api/version`, { signal: AbortSignal.timeout(4000) })
    if (v.ok) version = String(((await v.json()) as { version?: string }).version ?? 'UNKNOWN')
  } catch { reachable = false }
  const gpus = (d.gpus ?? readGpus)(), ram = (d.ram ?? readRam)(), disk = (d.disk ?? readDisk)(), cpu = (d.cpu ?? readCpu)()
  const t = now.toISOString()
  const record: NodeRecord = {
    nodeId: opts.id ?? 'local', hostname: (d.hostname ?? os.hostname)(), kind: 'LOCAL', endpoint: base,
    cpu, ramMiB: ram?.totalMiB ?? 0, gpu: gpus.map((g) => ({ model: g.model, vramMiB: g.vramMiB })), storage: disk ?? { totalBytes: 0, freeBytes: 0 }, networkMbps: (d.networkMbps ?? readNet)(),
    load: { cpuPct: 0, gpuPct: gpus[0]?.utilPct ?? 0, vramUsedMiB: gpus.reduce((a, g) => a + g.usedMiB, 0), ramUsedMiB: ram?.usedMiB ?? 0, queued: 0, at: t },
    resident, installedModels: installed, availableModels: [], health: reachable ? 'HEALTHY' : 'DEGRADED',
    lastHeartbeat: reachable ? t : new Date(0).toISOString(),
    capabilities: { concurrency: Math.max(1, gpus.length), runtimes: reachable ? ['ollama'] : [], roles: [...MODEL_ROLES] },
    identity: null,
  }
  return { record, quantizations, runtimeVersion: version, reachable }
}

/** The local node's model clients: same governor lease and keep-alive discipline as the pool, behind the NodeClient-era vocabulary. */
export class LocalNodeClient {
  constructor(readonly governor: ResidencyGovernor) {}
  get nodeId() { return this.governor.node.id }
  clientFor(ref: string, role: string, residency: 'RESIDENT' | 'TRANSIENT', keepAlive: string, keep: string[] = [], entry?: ModelEntry): ModelClient { return governedClientForRef(this.governor, ref, role, residency, keepAlive, keep, entry) }
}
