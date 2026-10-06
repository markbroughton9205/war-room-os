/**
 * GPU / VRAM policy for heavy local generation.
 * Reuses compute-policy.ts (nvidia-smi presence probe) and adds two bounded, fixed-argument nvidia-smi
 * queries. No shell, no user-supplied arguments, 4 s timeout, output truncated.
 *
 * Honesty: upstream Wan2.2 documents the 5B single-GPU low-memory command for >=24 GB VRAM.
 * A 16 GB card is below that and is UNTESTED. The policy therefore requires (by default) almost the whole
 * card to be free before admitting a job, and never claims 16 GB compatibility.
 */
import { spawnSync } from 'node:child_process'
import { probeNvidiaSmi } from '../compute-policy'
import { currentGpuBackend } from '../gpu-runtime'
import type { HvsGpuState, HvsModelLifecycleState } from './types'

export type GpuProcessHolder = { pid: number; processName: string; usedMiB: number }

export type GpuSnapshot = {
  present: boolean
  name: string | null
  totalMiB: number | null
  usedMiB: number | null
  freeMiB: number | null
  driverVersion: string | null
  holders: GpuProcessHolder[]
  backend: 'CUDA' | 'NONE'
  hvsGpuRuntimeBackend: string
  detail: string
}

export type VramPolicy = {
  /** Minimum free VRAM to admit a Wan2.2 TI2V-5B job. Env HVS_WAN22_MIN_FREE_VRAM_MIB, bounded 6000..49152. */
  minFreeMiB: number
  minFreeSource: 'env' | 'default'
  officialMinTotalMiB: 24576
  compatibility: 'OFFICIAL_24GB_PLUS' | 'UNTESTED_BELOW_OFFICIAL_24GB' | 'UNKNOWN'
}

export type GpuAdmission = {
  state: HvsGpuState
  snapshot: GpuSnapshot
  policy: VramPolicy
  admitted: boolean
  reason: string
}

export const DEFAULT_WAN22_MIN_FREE_VRAM_MIB = 14_000

function boundedQuery(args: string[]): { ok: boolean; stdout: string; detail: string } {
  try {
    const result = spawnSync('nvidia-smi', args, { encoding: 'utf8', timeout: 4000, maxBuffer: 256 * 1024 })
    if (result.error || result.status !== 0) {
      return { ok: false, stdout: '', detail: (result.stderr || result.error?.message || 'nvidia-smi failed').trim().slice(0, 240) }
    }
    return { ok: true, stdout: String(result.stdout || '').slice(0, 64 * 1024), detail: 'ok' }
  } catch (error) {
    return { ok: false, stdout: '', detail: error instanceof Error ? error.message.slice(0, 240) : 'nvidia-smi failed' }
  }
}

export const NVIDIA_SMI_GPU_QUERY = ['--query-gpu=name,memory.total,memory.used,memory.free,driver_version', '--format=csv,noheader,nounits'] as const
export const NVIDIA_SMI_APPS_QUERY = ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits'] as const

export function parseGpuQuery(stdout: string): Pick<GpuSnapshot, 'name' | 'totalMiB' | 'usedMiB' | 'freeMiB' | 'driverVersion'> | null {
  const line = stdout.split('\n').map(s => s.trim()).find(Boolean)
  if (!line) return null
  const parts = line.split(',').map(s => s.trim())
  if (parts.length < 5) return null
  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : null)
  return { name: parts[0] || null, totalMiB: num(parts[1]), usedMiB: num(parts[2]), freeMiB: num(parts[3]), driverVersion: parts[4] || null }
}

export function parseAppsQuery(stdout: string): GpuProcessHolder[] {
  const rows: GpuProcessHolder[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const first = line.indexOf(',')
    const last = line.lastIndexOf(',')
    if (first < 0 || last <= first) continue
    const pid = Number(line.slice(0, first).trim())
    const usedMiB = Number(line.slice(last + 1).trim())
    // Keep only the executable path; drop argv (may be long / carry flags).
    const processName = line.slice(first + 1, last).trim().split(/\s+/)[0]?.slice(0, 160) ?? ''
    if (Number.isFinite(pid) && Number.isFinite(usedMiB)) rows.push({ pid, processName, usedMiB })
    if (rows.length >= 32) break
  }
  return rows.sort((a, b) => b.usedMiB - a.usedMiB)
}

export function snapshotGpu(): GpuSnapshot {
  const presence = probeNvidiaSmi()
  const base: GpuSnapshot = {
    present: false,
    name: null,
    totalMiB: null,
    usedMiB: null,
    freeMiB: null,
    driverVersion: null,
    holders: [],
    backend: 'NONE',
    hvsGpuRuntimeBackend: currentGpuBackend(),
    detail: presence.detail,
  }
  if (!presence.ok) return base
  const gpu = boundedQuery([...NVIDIA_SMI_GPU_QUERY])
  const parsed = gpu.ok ? parseGpuQuery(gpu.stdout) : null
  if (!parsed) return { ...base, detail: gpu.detail }
  const apps = boundedQuery([...NVIDIA_SMI_APPS_QUERY])
  return {
    ...base,
    ...parsed,
    present: true,
    backend: 'CUDA',
    holders: apps.ok ? parseAppsQuery(apps.stdout) : [],
    detail: 'nvidia-smi bounded query',
  }
}

export function resolveVramPolicy(snapshot: GpuSnapshot | null, env: NodeJS.ProcessEnv = process.env): VramPolicy {
  const raw = Number(env.HVS_WAN22_MIN_FREE_VRAM_MIB)
  const valid = Number.isFinite(raw) && raw >= 6000 && raw <= 49_152
  return {
    minFreeMiB: valid ? Math.round(raw) : DEFAULT_WAN22_MIN_FREE_VRAM_MIB,
    minFreeSource: valid ? 'env' : 'default',
    officialMinTotalMiB: 24_576,
    compatibility: snapshot?.totalMiB == null ? 'UNKNOWN' : snapshot.totalMiB >= 24_576 ? 'OFFICIAL_24GB_PLUS' : 'UNTESTED_BELOW_OFFICIAL_24GB',
  }
}

/** Pure decision so it can be validated with synthetic snapshots. */
export function decideGpuAdmission(input: {
  snapshot: GpuSnapshot
  lifecycle: HvsModelLifecycleState
  heavyLockHeld: boolean
  env?: NodeJS.ProcessEnv
}): GpuAdmission {
  const policy = resolveVramPolicy(input.snapshot, input.env)
  const snap = input.snapshot
  if (!snap.present || snap.backend !== 'CUDA' || snap.totalMiB == null || snap.freeMiB == null) {
    return { state: 'GPU_UNAVAILABLE', snapshot: snap, policy, admitted: false, reason: `No usable NVIDIA GPU (${snap.detail}).` }
  }
  if (input.heavyLockHeld || input.lifecycle === 'LOADING' || input.lifecycle === 'GENERATING' || input.lifecycle === 'UNLOADING') {
    return { state: 'MODEL_BUSY', snapshot: snap, policy, admitted: false, reason: 'A heavy generation already holds the model lock.' }
  }
  if (snap.totalMiB < policy.minFreeMiB || snap.freeMiB < policy.minFreeMiB) {
    const holders = snap.holders.slice(0, 4).map(h => `${h.processName.split('/').pop()}(pid ${h.pid}) ${h.usedMiB} MiB`).join(', ')
    return {
      state: 'INSUFFICIENT_VRAM',
      snapshot: snap,
      policy,
      admitted: false,
      reason: `${snap.name ?? 'GPU'}: ${snap.freeMiB} MiB free of ${snap.totalMiB} MiB; policy needs ${policy.minFreeMiB} MiB free (upstream documents >=24 GB cards). Held by: ${holders || 'unknown'}.`,
    }
  }
  if (input.lifecycle === 'READY') {
    return { state: 'AVAILABLE', snapshot: snap, policy, admitted: true, reason: 'Model resident and GPU free.' }
  }
  return {
    state: 'MODEL_NOT_LOADED',
    snapshot: snap,
    policy,
    admitted: true,
    reason: `GPU has ${snap.freeMiB} MiB free; model loads per job in the worker (${policy.compatibility}).`,
  }
}
