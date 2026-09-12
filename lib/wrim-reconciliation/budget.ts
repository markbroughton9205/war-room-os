import type { NebulaHardware } from './hardware'
import { HISTORICAL_WRIM_0_PARAM_COUNT } from './identity'

export function estimateTrainingBudget(hw: NebulaHardware) {
  const params = HISTORICAL_WRIM_0_PARAM_COUNT
  const bytesPerParamFp32 = 4
  const modelBytes = params * bytesPerParamFp32
  const adamWBytes = modelBytes * 2
  const checkpointWithOptBytes = modelBytes + adamWBytes
  const vramMiB = hw.gpuVramMiB
  const ramGiB = hw.ramGiB
  const freeC = hw.volumes.find(v => v.letter.toUpperCase() === 'C')
  return {
    candidate: 'WRIM-G-20M-v1-option-A dense (same as WRIM-0)',
    parameterCount: params,
    weightsFp32Bytes: modelBytes,
    optimizerAdamWBytes: adamWBytes,
    checkpointWithOptimizerBytes: checkpointWithOptBytes,
    vramRequirement:
      vramMiB == null
        ? 'GPU VRAM not measured'
        : `19.2M fp32 + AdamW + activations at batch 8 / ctx 512 historically fit in ~3.3GB Metal. ${vramMiB} MiB NVIDIA VRAM is sufficient for this dense size. Exact CUDA occupancy NOT_MEASURED (PyTorch absent).`,
    ramRequirement: `${ramGiB} GiB host RAM measured. Shard mmap + Python process for 19.2M is expected to fit; not stress-tested this pass.`,
    storageRequirement: `model-only ~${Math.round(modelBytes / 1e6)} MB; with optimizer ~${Math.round(checkpointWithOptBytes / 1e6)} MB per checkpoint. C: free ${freeC?.freeGB ?? 'unknown'} GB.`,
    batchSize: 'Historical: 8. Nebula 16GB class GPU could raise batch; do not start a run to measure.',
    contextLength: 512,
    estimatedThroughput:
      'NOT_MEASURED on Nebula. Historical Mac MLX median 1693.7 tok/s on M1 8GB is NOT a CUDA forecast.',
    estimatedDuration:
      'NOT_MEASURED. Historical WRIM-0 500 steps / 2.048e6 tokens = 38.2 min on M1. Historical WRIM-1 1893 steps = 1.31 h on M1. Do not treat those as Nebula SLAs.',
    bf16Fp16: 'NOT_MEASURED — PyTorch not installed; no CUDA op probe.',
    hardwareMeasured: {
      cpu: hw.cpuName,
      ramGiB: hw.ramGiB,
      gpu: hw.gpuName,
      vramMiB: hw.gpuVramMiB,
      cudaUmd: hw.cudaUmd,
      nvme: hw.storage,
    },
  }
}
