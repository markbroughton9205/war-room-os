/**
 * Training PLANS only — this module never executes training. Every number here is a documented,
 * standard-formula estimate (labeled as such), never a fabricated dollar figure or a claim of
 * live pricing data this repo doesn't have.
 */
import { randomUUID } from 'node:crypto'
import type { HardwareCapabilityReport, TrainingExperiment, TrainingScaleClass } from './types'
import { TRAINING_SCALE_PARAMETER_RANGES } from './types'
import { classifyLocalExecutability, estimateTrainingMemory } from './trainingMemoryEstimator'

const BYTES_PER_PARAM_INFERENCE_FP16 = 2
/** Chinchilla-style "~20 tokens per parameter" compute-optimal heuristic — a widely cited
 * approximation, not a guarantee for any specific architecture/dataset. */
const TOKENS_PER_PARAM_HEURISTIC = 20

function midpointParams(scaleClass: TrainingScaleClass): number {
  const { minParams, maxParams } = TRAINING_SCALE_PARAMETER_RANGES[scaleClass]
  return Math.round((minParams + maxParams) / 2)
}

function runtimeClassFor(scaleClass: TrainingScaleClass, hardwareCanExecute: boolean | null): TrainingExperiment['estimatedRuntimeClass'] {
  if (hardwareCanExecute === false) return 'requires_distributed_compute'
  switch (scaleClass) {
    case 'micro':
      return 'hours'
    case 'tiny':
      return 'days'
    case 'small':
      return 'weeks'
    case 'research':
    default:
      return 'requires_distributed_compute'
  }
}

export function buildTrainingPlan(args: {
  scaleClass: TrainingScaleClass
  purpose: string
  datasetManifestId: string | null
  tokenizerExperimentId: string | null
  hardware: HardwareCapabilityReport | null
}): TrainingExperiment {
  const estimatedParameterCount = midpointParams(args.scaleClass)
  const estimatedTrainingTokens = estimatedParameterCount * TOKENS_PER_PARAM_HEURISTIC
  const estimatedCheckpointBytes = estimatedParameterCount * BYTES_PER_PARAM_INFERENCE_FP16

  const memoryEstimate = estimateTrainingMemory({
    paramCount: estimatedParameterCount,
    precision: 'fp32_training',
    optimizer: 'adamw',
    activationCheckpointing: false,
  })
  const estimatedRamBytesRequired = memoryEstimate.recommendedSafeEstimateBytes
  const estimatedVramBytesRequired = memoryEstimate.recommendedSafeEstimateBytes // same order-of-magnitude estimate; a real VRAM figure needs a fixed batch size/framework this phase does not define

  let currentHardwareCanExecute: boolean | null = null
  if (args.hardware) {
    const ramClassification = classifyLocalExecutability(memoryEstimate, args.hardware.totalRamBytes)
    const availableVram = args.hardware.gpuMemoryBytes
    const vramOk = availableVram === null ? null : availableVram >= estimatedVramBytesRequired
    currentHardwareCanExecute = vramOk === null ? ramClassification.executable : (ramClassification.executable || vramOk)
  }

  return {
    experimentId: randomUUID(),
    createdAt: new Date().toISOString(),
    scaleClass: args.scaleClass,
    estimatedParameterCount,
    estimatedTrainingTokens,
    estimatedCheckpointBytes,
    estimatedRamBytesRequired,
    estimatedVramBytesRequired,
    estimatedRuntimeClass: runtimeClassFor(args.scaleClass, currentHardwareCanExecute),
    currentHardwareCanExecute,
    externalComputeRequired: currentHardwareCanExecute === false,
    purpose: args.purpose,
    tokenizerExperimentId: args.tokenizerExperimentId,
    datasetManifestId: args.datasetManifestId,
    memoryEstimate,
  }
}
