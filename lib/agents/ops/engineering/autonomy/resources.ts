import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { loopbackBaseUrl } from '../runtime/ollamaModel'

/**
 * Resource governance for starting a mission: the builder is partially offloaded (about 12 GB of GPU memory plus a few GB of RAM) and shares the machine with Council and the
 * desktop. A mission starts only when the memory it needs is actually free or already held by the resident builder; otherwise the command waits (WAITING_RESOURCES) with the numbers.
 */
export type GpuProc = { pid: number; name: string; usedMiB: number }
export type ResourceReading = { /** GPU compute utilization right now (all processes), percent */ gpuUtilPct?: number | null; /** processes using the GPU, so a wait can say whose work it is waiting for */ gpuProcs?: GpuProc[]; gpuFreeMiB: number | null; gpuTotalMiB: number | null; ramAvailableMiB: number | null; residentModels: { name: string; vramMiB: number }[] }
export type ResourceVerdict = { ok: boolean; reason: string; reading: ResourceReading }

export const NEED = { gpuMiB: 9_000, ramMiB: 5_000, /** another workload using the GPU this hard is working: Foundry waits instead of loading a model on top of it */ busyUtilPct: 60 }

export async function readResources(ollamaBase?: string): Promise<ResourceReading> {
  let gpuFreeMiB: number | null = null, gpuTotalMiB: number | null = null
  try {
    const r = spawnSync('nvidia-smi', ['--query-gpu=memory.free,memory.total', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 5000 })
    if (r.status === 0) { const [f, t] = r.stdout.trim().split('\n')[0].split(',').map((x) => Number(x.trim())); if (Number.isFinite(f)) gpuFreeMiB = f; if (Number.isFinite(t)) gpuTotalMiB = t }
  } catch { /* no NVIDIA tooling */ }
  let gpuUtilPct: number | null = null
  const gpuProcs: GpuProc[] = []
  try {
    const u = spawnSync('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 5000 })
    if (u.status === 0) { const v = Number(u.stdout.trim().split('\n')[0]); if (Number.isFinite(v)) gpuUtilPct = v }
    const p = spawnSync('nvidia-smi', ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 5000 })
    if (p.status === 0) for (const line of p.stdout.trim().split('\n').filter(Boolean)) { const [pid, name, mem] = line.split(',').map((x) => x.trim()); if (Number.isFinite(Number(pid))) gpuProcs.push({ pid: Number(pid), name: name.split('/').pop() ?? name, usedMiB: Number(mem) || 0 }) }
  } catch { /* no NVIDIA tooling */ }
  let ramAvailableMiB: number | null = null
  try { const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync('/proc/meminfo', 'utf8')); if (m) ramAvailableMiB = Math.floor(Number(m[1]) / 1024) } catch { /* not Linux */ }
  const residentModels: ResourceReading['residentModels'] = []
  try {
    const j = (await (await fetch(`${loopbackBaseUrl(ollamaBase)}/api/ps`, { signal: AbortSignal.timeout(3000) })).json()) as { models?: { name: string; size_vram?: number }[] }
    for (const m of j.models ?? []) residentModels.push({ name: m.name, vramMiB: Math.round((m.size_vram ?? 0) / 1048576) })
  } catch { /* runtime not reachable: reported by the capability probe */ }
  return { gpuUtilPct, gpuProcs, gpuFreeMiB, gpuTotalMiB, ramAvailableMiB, residentModels }
}

/** Pure decision from a reading. `builder` is the model the mission will use: memory it already holds counts as available. */
export function judgeResources(r: ResourceReading, builder: string | null, opts: { /** a Foundry mission of ours is already running (its own load is not 'another workload') */ ownWorkRunning?: boolean } = {}): ResourceVerdict {
  // someone else is computing on the GPU right now (Council inference, speech synthesis, a render): starting a model load on top of it would slow or interrupt their work, so wait
  if (!opts.ownWorkRunning && typeof r.gpuUtilPct === 'number' && r.gpuUtilPct >= NEED.busyUtilPct) {
    const who = (r.gpuProcs ?? []).filter((p) => p.usedMiB > 0).map((p) => `${p.name} (${p.usedMiB} MiB)`).join(', ')
    return { ok: false, reason: `the GPU is busy with another workload (${r.gpuUtilPct}% utilization${who ? `: ${who}` : ''}); Foundry waits instead of interrupting it`, reading: r }
  }
  const held = r.residentModels.filter((m) => m.name === builder).reduce((n, m) => n + m.vramMiB, 0)
  const other = r.residentModels.filter((m) => m.name !== builder).reduce((n, m) => n + m.vramMiB, 0)
  if (r.gpuFreeMiB !== null && r.gpuFreeMiB + held + other < NEED.gpuMiB) return { ok: false, reason: `GPU memory is short: ${r.gpuFreeMiB} MiB free (+${held} held by the builder), the builder needs about ${NEED.gpuMiB} MiB`, reading: r }
  if (r.ramAvailableMiB !== null && r.ramAvailableMiB < NEED.ramMiB) return { ok: false, reason: `RAM is short: ${r.ramAvailableMiB} MiB available, a mission needs about ${NEED.ramMiB} MiB`, reading: r }
  return { ok: true, reason: other > 0 ? `another model (${r.residentModels.filter((m) => m.name !== builder).map((m) => m.name).join(', ')}) is resident and will be unloaded by the runtime when the builder loads` : 'memory is available', reading: r }
}
