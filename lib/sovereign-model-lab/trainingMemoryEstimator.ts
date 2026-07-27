/**
 * Corrected training memory estimator (Part 11). Replaces trainingPlanner.ts's flat
 * 14-bytes/param constant with an itemized breakdown across every listed cost center. No real
 * training framework or architecture is fixed yet for WRM-001, so activation/attention-workspace/
 * framework-overhead figures are honestly labeled as architecture-inferred rules of thumb, not
 * measured values — see knownOmissions on every result. Never classifies a plan as locally
 * executable merely because the checkpoint bytes fit in RAM.
 */
import type { OptimizerKind, TrainingMemoryEstimate, TrainingMemoryLineItem, TrainingMemoryUncertaintyClass, TrainingPrecision } from './types'

const WINDOWS_OS_RESERVE_BYTES = 3 * 1024 ** 3
const SERVER_RESERVE_BYTES = 1 * 1024 ** 3
const UNCERTAINTY_MARGIN_FRACTION = 0.2

export type TrainingMemoryConfig = {
  paramCount: number
  precision: TrainingPrecision
  optimizer: OptimizerKind | null
  activationCheckpointing: boolean
  batchSize?: number
  sequenceLength?: number
}

/** Rough transformer parameter-count relation (params ≈ 12 * layers * hidden^2, ignoring
 * embeddings/vocab/norm) — a standard rule of thumb used only because no real architecture config
 * exists yet for WRM-001. Not derived from any measured model. */
function inferArchitectureShape(paramCount: number): { hiddenSize: number; numLayers: number } {
  const numLayers = paramCount < 50_000_000 ? 6 : paramCount < 500_000_000 ? 12 : paramCount < 5_000_000_000 ? 24 : 48
  const hiddenSize = Math.max(64, Math.round(Math.sqrt(paramCount / (12 * numLayers))))
  return { hiddenSize, numLayers }
}

function bytesPerWeightElement(precision: TrainingPrecision): number {
  return precision === 'fp32_inference' || precision === 'fp32_training' ? 4 : 2
}

export function estimateTrainingMemory(config: TrainingMemoryConfig): TrainingMemoryEstimate {
  const { paramCount, precision, optimizer, activationCheckpointing } = config
  const batchSize = config.batchSize ?? 1
  const sequenceLength = config.sequenceLength ?? 512
  const isTraining = precision !== 'fp32_inference'
  const isMixedPrecision = precision === 'bf16_training' || precision === 'fp16_training'
  const { hiddenSize, numLayers } = inferArchitectureShape(paramCount)

  const lineItems: TrainingMemoryLineItem[] = []

  const weightBytes = paramCount * bytesPerWeightElement(precision)
  lineItems.push({
    label: 'Model parameters',
    bytes: weightBytes,
    formula: `paramCount * ${bytesPerWeightElement(precision)} bytes/param`,
    assumptions: `Weight storage precision: ${precision}.`,
  })

  if (isMixedPrecision) {
    const masterBytes = paramCount * 4
    lineItems.push({
      label: 'Master parameters (fp32 copy for mixed precision)',
      bytes: masterBytes,
      formula: 'paramCount * 4 bytes/param',
      assumptions: 'Mixed-precision training keeps an fp32 master copy of every weight for optimizer updates — standard practice, not optional.',
    })
  }

  if (isTraining) {
    const gradientBytesPerParam = isMixedPrecision ? 4 : bytesPerWeightElement(precision)
    const gradientBytes = paramCount * gradientBytesPerParam
    lineItems.push({
      label: 'Gradients',
      bytes: gradientBytes,
      formula: `paramCount * ${gradientBytesPerParam} bytes/param`,
      assumptions: isMixedPrecision ? 'Gradients accumulated in fp32 for numerical stability, the standard mixed-precision practice.' : `Gradients stored at the same precision as weights (${precision}).`,
    })

    if (optimizer === 'adamw') {
      const momentBytes = paramCount * 4
      lineItems.push({ label: 'Optimizer first moment (AdamW m)', bytes: momentBytes, formula: 'paramCount * 4 bytes/param (fp32)', assumptions: 'AdamW keeps two fp32 moment tensors regardless of weight precision.' })
      lineItems.push({ label: 'Optimizer second moment (AdamW v)', bytes: momentBytes, formula: 'paramCount * 4 bytes/param (fp32)', assumptions: 'AdamW keeps two fp32 moment tensors regardless of weight precision.' })
    } else if (optimizer === 'sgd') {
      const momentumBytes = paramCount * 4
      lineItems.push({ label: 'Optimizer momentum (SGD)', bytes: momentumBytes, formula: 'paramCount * 4 bytes/param (fp32)', assumptions: 'Assumes SGD with momentum; plain SGD without momentum would need zero bytes here.' })
    }

    const bytesPerActivationElement = precision === 'fp32_training' ? 4 : 2
    const perLayerActivationElements = batchSize * sequenceLength * hiddenSize * 16
    const rawActivationBytes = perLayerActivationElements * numLayers * bytesPerActivationElement
    const activationBytes = activationCheckpointing ? Math.ceil(rawActivationBytes / Math.max(1, Math.sqrt(numLayers))) : rawActivationBytes
    lineItems.push({
      label: 'Activations',
      bytes: activationBytes,
      formula: activationCheckpointing
        ? 'batch*seq*hidden*16*layers*bytesPerElement / sqrt(layers) (checkpointing trades compute for ~sqrt(L) memory reduction — standard result)'
        : 'batch*seq*hidden*16*layers*bytesPerElement',
      assumptions: `Architecture inferred from paramCount only (hiddenSize=${hiddenSize}, numLayers=${numLayers}) — no real WRM-001 architecture config exists yet. batchSize=${batchSize}, sequenceLength=${sequenceLength}.`,
    })

    const numHeads = Math.max(1, Math.round(hiddenSize / 64))
    const attentionWorkspaceBytes = batchSize * numHeads * sequenceLength * sequenceLength * 4 * numLayers
    lineItems.push({
      label: 'Attention workspace',
      bytes: attentionWorkspaceBytes,
      formula: 'batch*heads*seq^2*4bytes*layers',
      assumptions: `head_dim assumed 64 (numHeads=${numHeads}) — a typical default, not a measured value.`,
    })
  }

  const frameworkOverheadBytes = 750 * 1024 ** 2
  lineItems.push({ label: 'Framework overhead', bytes: frameworkOverheadBytes, formula: 'flat 750 MiB', assumptions: 'Typical PyTorch/CUDA context and allocator overhead range (300 MiB–1.5 GiB) — no specific framework is installed/fixed yet for WRM-001, so this is a placeholder, not a measurement.' })

  const dataloaderOverheadBytes = 200 * 1024 ** 2
  lineItems.push({ label: 'Dataloader overhead', bytes: dataloaderOverheadBytes, formula: 'flat 200 MiB', assumptions: 'Assumes single-process data loading with small in-memory batches — a real multi-worker dataloader would need more.' })

  const checkpointBytes = paramCount * bytesPerWeightElement(precision === 'fp32_inference' ? 'fp32_inference' : 'fp32_training')
  const checkpointWritingOverheadBytes = Math.ceil(checkpointBytes * 0.2)
  lineItems.push({ label: 'Checkpoint-writing overhead', bytes: checkpointWritingOverheadBytes, formula: '20% of a full fp32 checkpoint size (transient serialization staging buffer)', assumptions: 'Conservative rule of thumb — real overhead depends on the serialization library.' })

  const osReserveBytes = WINDOWS_OS_RESERVE_BYTES
  const serverReserveBytes = SERVER_RESERVE_BYTES
  lineItems.push({ label: 'Operating system reserve', bytes: osReserveBytes, formula: 'fixed 3 GiB', assumptions: 'Minimum reserve for Windows to remain responsive.' })
  lineItems.push({ label: 'War Room server + Node reserve', bytes: serverReserveBytes, formula: 'fixed 1 GiB', assumptions: 'Minimum reserve for the running War Room Node process itself.' })

  const subtotalBeforeMargin = lineItems.reduce((sum, item) => sum + item.bytes, 0)
  const uncertaintyMarginBytes = Math.ceil(subtotalBeforeMargin * UNCERTAINTY_MARGIN_FRACTION)
  lineItems.push({ label: 'Uncertainty margin', bytes: uncertaintyMarginBytes, formula: `${Math.round(UNCERTAINTY_MARGIN_FRACTION * 100)}% of subtotal`, assumptions: 'Covers memory fragmentation and the architecture/framework unknowns listed in knownOmissions.' })

  const totalBytes = subtotalBeforeMargin + uncertaintyMarginBytes
  const minimumEstimateBytes = subtotalBeforeMargin - osReserveBytes - serverReserveBytes - uncertaintyMarginBytes
  const recommendedSafeEstimateBytes = totalBytes

  const knownOmissions = [
    'Activation and attention-workspace figures are inferred from paramCount only — WRM-001 has no fixed real architecture config yet.',
    'Framework overhead is a typical-range placeholder, not measured for a specific installed training framework.',
    'Dataloader overhead assumes single-process loading.',
    'Does not account for OS memory fragmentation beyond the flat uncertainty margin.',
  ]

  const uncertaintyClass: TrainingMemoryUncertaintyClass = isTraining ? 'high' : 'medium'

  return {
    paramCount,
    precision,
    optimizer,
    activationCheckpointing,
    lineItems,
    totalBytes,
    minimumEstimateBytes: Math.max(0, minimumEstimateBytes),
    recommendedSafeEstimateBytes,
    knownOmissions,
    uncertaintyClass,
    osReserveBytes,
    serverReserveBytes,
    uncertaintyMarginBytes,
  }
}

export function classifyLocalExecutability(estimate: TrainingMemoryEstimate, availableRamBytes: number | null): { executable: boolean; reason: string } {
  if (availableRamBytes === null) {
    return { executable: false, reason: 'Available RAM is unknown (hardware probe did not report a value) — cannot classify as locally executable.' }
  }
  // Deliberately never checks checkpoint bytes alone — always the full recommended-safe estimate,
  // which already includes OS/server reserves and the uncertainty margin.
  if (availableRamBytes >= estimate.recommendedSafeEstimateBytes) {
    return { executable: true, reason: `Available RAM (${(availableRamBytes / 1024 ** 3).toFixed(1)} GiB) covers the recommended safe estimate (${(estimate.recommendedSafeEstimateBytes / 1024 ** 3).toFixed(1)} GiB), which already includes OS/server reserves and a ${Math.round((estimate.uncertaintyMarginBytes / (estimate.totalBytes - estimate.uncertaintyMarginBytes)) * 100)}% uncertainty margin.` }
  }
  return { executable: false, reason: `Available RAM (${(availableRamBytes / 1024 ** 3).toFixed(1)} GiB) is below the recommended safe estimate (${(estimate.recommendedSafeEstimateBytes / 1024 ** 3).toFixed(1)} GiB).` }
}
