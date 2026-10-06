/**
 * HVS compute policy. Execution backends are not project-format truth.
 * Current machine: CPU available; CUDA unproven/unavailable; NVENC not required.
 */
import { spawnSync } from 'node:child_process'
import { HVS_GPU_RUNTIME_POLICY, currentGpuBackend } from './gpu-runtime'

export type ComputeBackend = 'CPU' | 'CUDA' | 'WEBGPU' | 'REMOTE'

export type ComputeHealth = 'available' | 'unavailable' | 'unproven' | 'provider-specific'

export type ComputeProbe = {
  CPU: 'available'
  CUDA: ComputeHealth
  WEBGPU: 'unproven'
  REMOTE: 'provider-specific'
  selected: 'CPU'
  nvidiaSmi: 'unavailable' | 'present'
  detail: string
  projectFormatIndependent: true
}

let cached: ComputeProbe | null = null

export function probeNvidiaSmi(): { ok: boolean; detail: string } {
  try {
    const result = spawnSync('nvidia-smi', ['-L'], { encoding: 'utf8', timeout: 4000 })
    if (result.error || result.status !== 0) {
      const msg = (result.stderr || result.error?.message || 'nvidia-smi failed').trim().slice(0, 240)
      return { ok: false, detail: msg || 'nvidia-smi unavailable' }
    }
    return { ok: true, detail: (result.stdout || '').trim().slice(0, 240) }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'nvidia-smi probe failed' }
  }
}

export function probeCompute(force = false): ComputeProbe {
  if (cached && !force) return cached
  const nv = probeNvidiaSmi()
  cached = {
    CPU: 'available',
    CUDA: nv.ok ? 'unproven' : 'unavailable',
    WEBGPU: 'unproven',
    REMOTE: 'provider-specific',
    selected: 'CPU',
    nvidiaSmi: nv.ok ? 'present' : 'unavailable',
    detail: nv.detail,
    projectFormatIndependent: true,
  }
  return cached
}

export function selectComputeBackend(): 'CPU' {
  void currentGpuBackend()
  void HVS_GPU_RUNTIME_POLICY.vendorNeutralProjectFormat
  return 'CPU'
}
