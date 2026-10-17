import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { loopbackBaseUrl } from '../runtime/ollamaModel'

/**
 * Resource governance for starting a mission: the builder is partially offloaded (about 12 GB of GPU memory plus a few GB of RAM) and shares the machine with Council and the
 * desktop. A mission starts only when the memory it needs is actually free or already held by the resident builder; otherwise the command waits (WAITING_RESOURCES) with the numbers.
 */
export type ResourceReading = { gpuFreeMiB: number | null; gpuTotalMiB: number | null; ramAvailableMiB: number | null; residentModels: { name: string; vramMiB: number }[] }
export type ResourceVerdict = { ok: boolean; reason: string; reading: ResourceReading }

export const NEED = { gpuMiB: 9_000, ramMiB: 5_000 }

export async function readResources(ollamaBase?: string): Promise<ResourceReading> {
  let gpuFreeMiB: number | null = null, gpuTotalMiB: number | null = null
  try {
    const r = spawnSync('nvidia-smi', ['--query-gpu=memory.free,memory.total', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 5000 })
    if (r.status === 0) { const [f, t] = r.stdout.trim().split('\n')[0].split(',').map((x) => Number(x.trim())); if (Number.isFinite(f)) gpuFreeMiB = f; if (Number.isFinite(t)) gpuTotalMiB = t }
  } catch { /* no NVIDIA tooling */ }
  let ramAvailableMiB: number | null = null
  try { const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync('/proc/meminfo', 'utf8')); if (m) ramAvailableMiB = Math.floor(Number(m[1]) / 1024) } catch { /* not Linux */ }
  const residentModels: ResourceReading['residentModels'] = []
  try {
    const j = (await (await fetch(`${loopbackBaseUrl(ollamaBase)}/api/ps`, { signal: AbortSignal.timeout(3000) })).json()) as { models?: { name: string; size_vram?: number }[] }
    for (const m of j.models ?? []) residentModels.push({ name: m.name, vramMiB: Math.round((m.size_vram ?? 0) / 1048576) })
  } catch { /* runtime not reachable: reported by the capability probe */ }
  return { gpuFreeMiB, gpuTotalMiB, ramAvailableMiB, residentModels }
}

/** Pure decision from a reading. `builder` is the model the mission will use: memory it already holds counts as available. */
export function judgeResources(r: ResourceReading, builder: string | null): ResourceVerdict {
  const held = r.residentModels.filter((m) => m.name === builder).reduce((n, m) => n + m.vramMiB, 0)
  const other = r.residentModels.filter((m) => m.name !== builder).reduce((n, m) => n + m.vramMiB, 0)
  if (r.gpuFreeMiB !== null && r.gpuFreeMiB + held + other < NEED.gpuMiB) return { ok: false, reason: `GPU memory is short: ${r.gpuFreeMiB} MiB free (+${held} held by the builder), the builder needs about ${NEED.gpuMiB} MiB`, reading: r }
  if (r.ramAvailableMiB !== null && r.ramAvailableMiB < NEED.ramMiB) return { ok: false, reason: `RAM is short: ${r.ramAvailableMiB} MiB available, a mission needs about ${NEED.ramMiB} MiB`, reading: r }
  return { ok: true, reason: other > 0 ? `another model (${r.residentModels.filter((m) => m.name !== builder).map((m) => m.name).join(', ')}) is resident and will be unloaded by the runtime when the builder loads` : 'memory is available', reading: r }
}
