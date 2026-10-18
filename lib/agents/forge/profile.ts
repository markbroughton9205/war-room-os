import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { loopbackBaseUrl } from '@/lib/agents/ops/engineering/runtime/ollamaModel'
import type { Basis, Residency, ResourceProfile } from './types'

/** Classify residency from the runtime's own byte accounting. Never inferred from artifact size alone. */
export function classifyResidency(size: number | null, sizeVram: number | null): { residency: Residency; basis: Basis } {
  if (size === null || sizeVram === null || size <= 0) return { residency: 'UNKNOWN', basis: 'UNKNOWN' }
  if (sizeVram >= size * 0.98) return { residency: 'FULL_GPU', basis: 'MEASURED' }
  if (sizeVram <= 0) return { residency: 'CPU_ASSISTED', basis: 'MEASURED' }
  return { residency: 'PARTIAL_OFFLOAD', basis: 'MEASURED' }
}
/** Pre-load feasibility from artifact size only: always ESTIMATED, never MEASURED. */
export function estimateFeasibility(artifactBytes: number, vramBytes: number, ramBytes: number): { residency: Residency; basis: Basis; note: string } {
  const GiB = 1024 ** 3
  if (artifactBytes <= vramBytes * 0.9) return { residency: 'UNKNOWN', basis: 'ESTIMATED', note: `artifact ${(artifactBytes / GiB).toFixed(1)} GiB is below VRAM ${(vramBytes / GiB).toFixed(1)} GiB, but KV cache and context are not counted: measure after load` }
  if (artifactBytes <= (vramBytes + ramBytes) * 0.85) return { residency: 'PARTIAL_OFFLOAD', basis: 'ESTIMATED', note: 'fits only with CPU offload (slower)' }
  return { residency: 'REQUIRES_OFFLOAD', basis: 'ESTIMATED', note: `artifact ${(artifactBytes / GiB).toFixed(1)} GiB exceeds practical RAM+VRAM residency (${((vramBytes + ramBytes) / GiB).toFixed(1)} GiB): would stream from disk; may CAN_RUN_SLOW, unmeasured` }
}
export const gpuUsedMiB = (): number | 'UNKNOWN' => { try { const o = execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { timeout: 5000 }).toString().trim().split('\n')[0]; const n = Number(o); return Number.isFinite(n) ? n : 'UNKNOWN' } catch { return 'UNKNOWN' } }
export const ramUsedMiB = (): number | 'UNKNOWN' => { try { const m = readFileSync('/proc/meminfo', 'utf8'); const g = (k: string) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(m)?.[1]); const t = g('MemTotal'), a = g('MemAvailable'); return Number.isFinite(t) && Number.isFinite(a) ? Math.round((t - a) / 1024) : 'UNKNOWN' } catch { return 'UNKNOWN' } }

/** Load the model with a real streamed generation and record what the runtime reports. */
export async function measureProfile(ref: string, contextTokens = 8192, base = loopbackBaseUrl()): Promise<ResourceProfile> {
  const gpuBefore = gpuUsedMiB(), ramBefore = ramUsedMiB()
  const t0 = Date.now(); let firstTokenMs: number | 'UNKNOWN' = 'UNKNOWN'
  let load: number | null = null, evalCount: number | null = null, evalDur: number | null = null
  const res = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: ref, prompt: 'Write a JavaScript function that reverses a string, with a one-line comment.', stream: true, think: false, keep_alive: '5m', options: { num_ctx: contextTokens, num_predict: 160, temperature: 0.1 } }) })
  if (!res.ok || !res.body) throw new Error(`generate HTTP ${res.status}`)
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
  for (;;) {
    const { done, value } = await reader.read(); if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      const j = JSON.parse(line) as { response?: string; done?: boolean; load_duration?: number; eval_count?: number; eval_duration?: number }
      if (firstTokenMs === 'UNKNOWN' && j.response) firstTokenMs = Date.now() - t0
      if (j.done) { load = j.load_duration ?? null; evalCount = j.eval_count ?? null; evalDur = j.eval_duration ?? null }
    }
  }
  const ps = (await (await fetch(`${base}/api/ps`)).json()) as { models?: { name?: string; model?: string; size?: number; size_vram?: number; context_length?: number }[] }
  const m = ps.models?.find((x) => x.name === ref || x.model === ref)
  const cls = classifyResidency(m?.size ?? null, m?.size_vram ?? null)
  const gpuAfter = gpuUsedMiB(), ramAfter = ramUsedMiB()
  return {
    modelRef: ref, at: new Date().toISOString(), basis: cls.basis, residency: cls.residency,
    artifactBytes: m?.size ?? 'UNKNOWN', vramBytesLoaded: m?.size_vram ?? 'UNKNOWN',
    gpuUsedMiBAfterLoad: gpuAfter, systemRamUsedMiBAfterLoad: ramAfter, contextTokens: m?.context_length ?? contextTokens,
    loadMs: load === null ? 'UNKNOWN' : Math.round(load / 1e6), firstTokenMs,
    tokensPerSecond: evalCount && evalDur ? Math.round((evalCount / (evalDur / 1e9)) * 10) / 10 : 'UNKNOWN',
    note: `runtime-reported (/api/ps) size vs size_vram; GPU before=${gpuBefore} MiB, after=${gpuAfter} MiB; RAM used before=${ramBefore} MiB, after=${ramAfter} MiB; context ${m?.context_length ?? contextTokens}`,
  }
}
