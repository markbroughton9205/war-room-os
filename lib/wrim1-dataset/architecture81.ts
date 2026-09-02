import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { totalmem } from 'node:os'

export type ArchitectureOption81 = {
  id: 'A' | 'B' | 'C'
  name: string
  parameters: number
  context: number
  hardware: string
  selectedForCurrentHardware: boolean
  uniqueTrainTokens: number
  epochs: number
  trainingTokens: number
  steps: number
  batch: number
  estimatedWallClockHours: { best: number; expected: number; high: number } | null
  peakMemoryBytes: { low: number; high: number } | null
  checkpointDiskBytes: number
  estimateClass: 'MEASURED' | 'DERIVED' | 'SPECULATIVE'
  notes: string
}

export function planEpochs(uniqueTrainTokens: number): number {
  if (uniqueTrainTokens <= 0) return 0
  if (uniqueTrainTokens < 500_000) return 4
  if (uniqueTrainTokens < 2_000_000) return 3
  if (uniqueTrainTokens < 6_000_000) return 2
  return 1
}

export function wrim1ArchitectureOptions81(input: { uniqueTrainTokens: number; epochs: number }): ArchitectureOption81[] {
  const checkpoint = existsSync(join(process.cwd(), 'model-lab/manifests/wrim0_checkpoints/checkpoint-final.json'))
    ? JSON.parse(readFileSync(join(process.cwd(), 'model-lab/manifests/wrim0_checkpoints/checkpoint-final.json'), 'utf8')) as { parameterCount: number }
    : { parameterCount: 19_217_152 }
  const batch = 8
  const ctx = 512
  const steps = input.uniqueTrainTokens > 0 ? Math.ceil(input.uniqueTrainTokens * input.epochs / (ctx * batch)) : 0
  const measuredSecondsPerStep = (38 * 60) / 500
  const optionA: ArchitectureOption81 = {
    id: 'A',
    name: 'Same ~19.2M native WRIM, ctx 512, M1 path',
    parameters: checkpoint.parameterCount,
    context: ctx,
    hardware: 'Apple M1 8GB unified memory (this host)',
    selectedForCurrentHardware: true,
    uniqueTrainTokens: input.uniqueTrainTokens,
    epochs: input.epochs,
    trainingTokens: input.uniqueTrainTokens * input.epochs,
    steps,
    batch,
    estimatedWallClockHours: {
      best: Number((steps * measuredSecondsPerStep / 3600).toFixed(2)),
      expected: Number((steps * measuredSecondsPerStep * 1.15 / 3600).toFixed(2)),
      high: Number((steps * measuredSecondsPerStep * 1.3 / 3600).toFixed(2)),
    },
    peakMemoryBytes: { low: 3_280_000_000, high: 3_430_000_000 },
    checkpointDiskBytes: checkpoint.parameterCount * 4,
    estimateClass: 'DERIVED',
    notes: `Peak RAM is MEASURED from Genesis WRIM-0 (3.28–3.43GB at ctx=512). Step time DERIVED from Genesis 500 steps / ~38 minutes. Host unified memory observed ${totalmem()} bytes. ctx=1024 remains unsafe on 8GB.`,
  }
  const optionB: ArchitectureOption81 = {
    id: 'B',
    name: 'Larger native width (not selected)',
    parameters: 31_000_000,
    context: 512,
    hardware: 'Apple M1 8GB — NOT BENCHMARKED at this width',
    selectedForCurrentHardware: false,
    uniqueTrainTokens: input.uniqueTrainTokens,
    epochs: input.epochs,
    trainingTokens: input.uniqueTrainTokens * input.epochs,
    steps: 0,
    batch,
    estimatedWallClockHours: null,
    peakMemoryBytes: null,
    checkpointDiskBytes: 31_000_000 * 4,
    estimateClass: 'SPECULATIVE',
    notes: 'NOT BENCHMARKED. No wall-clock or memory measurement exists at 31M. Do not compare as faster/lighter than measured WRIM-0.',
  }
  const optionC: ArchitectureOption81 = {
    id: 'C',
    name: 'Future RTX 5080 / CUDA path',
    parameters: 120_000_000,
    context: 2048,
    hardware: 'NVIDIA RTX 5080 — NOT PRESENT on this host',
    selectedForCurrentHardware: false,
    uniqueTrainTokens: input.uniqueTrainTokens,
    epochs: input.epochs,
    trainingTokens: input.uniqueTrainTokens * input.epochs,
    steps: 0,
    batch,
    estimatedWallClockHours: null,
    peakMemoryBytes: null,
    checkpointDiskBytes: 120_000_000 * 4,
    estimateClass: 'SPECULATIVE',
    notes: 'NOT PRESENT. NOT BENCHMARKED. Future architecture planning only.',
  }
  return [optionA, optionB, optionC]
}
