import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { estimateM1TrainingPlan } from '@/lib/training-checkpoint/engine'
import { totalmem } from 'node:os'

export type ArchitectureOption = {
  id: 'A' | 'B' | 'C'
  name: string
  parameters: number
  context: number
  hardware: string
  selectedForCurrentHardware: boolean
  trainingTokensAfterEpochReuse: number
  uniqueSourceTokens: number
  steps: number
  estimatedWallClockHours: { low: number; high: number } | null
  peakMemoryBytes: { low: number; high: number }
  checkpointDiskBytes: number
  notes: string
}

export function wrim1ArchitectureOptions(input: { uniqueSourceTokens: number; epochs: number }): ArchitectureOption[] {
  const memory = totalmem()
  const checkpoint = existsSync(join(process.cwd(), 'model-lab/manifests/wrim0_checkpoints/checkpoint-final.json'))
    ? JSON.parse(readFileSync(join(process.cwd(), 'model-lab/manifests/wrim0_checkpoints/checkpoint-final.json'), 'utf8')) as { parameterCount: number }
    : { parameterCount: 19_217_152 }
  const optionAParams = checkpoint.parameterCount
  const optionBParams = 31_000_000
  const optionCParams = 120_000_000
  const mk = (id: ArchitectureOption['id'], name: string, parameters: number, context: number, hardware: string, selected: boolean, notes: string): ArchitectureOption => {
    const plan = estimateM1TrainingPlan({
      chip: hardware.includes('M1') ? 'Apple M1' : hardware,
      unifiedMemoryBytes: memory,
      availableMemoryBytes: Math.floor(memory * 0.55),
      freeDiskBytes: 50 * 1024 ** 3,
      parameterCount: parameters,
      datasetTokens: input.uniqueSourceTokens,
      epochs: input.epochs,
      sequenceLength: context,
      effectiveBatchSize: 8,
    })
    return {
      id, name, parameters, context, hardware, selectedForCurrentHardware: selected,
      uniqueSourceTokens: input.uniqueSourceTokens,
      trainingTokensAfterEpochReuse: input.uniqueSourceTokens * input.epochs,
      steps: plan.estimatedSteps,
      estimatedWallClockHours: plan.estimatedWallClockHours,
      peakMemoryBytes: plan.peakMemoryBytes,
      checkpointDiskBytes: plan.checkpointDiskBytes,
      notes,
    }
  }
  const options = [
    mk('A', 'Same ~19M architecture, better data', optionAParams, 512, 'Apple M1 8GB (measured WRIM-0 host)', true, 'Matches WRIM-0 G-20M-v1. Peak memory uses Genesis measured 3.28–3.43GB, not the planning formula. Step-time scaled from 500 steps in ~38 minutes.'),
    mk('B', 'Moderate larger native architecture still aimed at M1', optionBParams, 512, 'Apple M1 8GB (unmeasured at this width)', false, 'Not selected: no live memory benchmark at 31M. Planning only. ctx=1024 remains unsafe on 8GB per Genesis.'),
    mk('C', 'Future RTX 5080 / CUDA configuration', optionCParams, 2048, 'NVIDIA RTX 5080 (not present)', false, 'Not selected: this host is Apple M1, not CUDA. Future hardware only.'),
  ]
  const measuredSecondsPerStep = (38 * 60) / 500
  options[0].peakMemoryBytes = { low: 3_280_000_000, high: 3_430_000_000 }
  options[0].estimatedWallClockHours = {
    low: Number((options[0].steps * measuredSecondsPerStep / 3600).toFixed(2)),
    high: Number((options[0].steps * measuredSecondsPerStep * 1.3 / 3600).toFixed(2)),
  }
  return options
}
