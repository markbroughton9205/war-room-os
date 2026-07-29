/**
 * Local checkpoint metadata and integrity handling. Phase 1 never produces a real trained
 * checkpoint (training_plan_ready is the state-machine ceiling), so this module exists as real,
 * tested infrastructure with no live data yet — honest, not fabricated. No encryption is
 * implemented or claimed here; if a caller asks, this module says so explicitly.
 */
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import type { TrainingCheckpoint } from './types'

export const CHECKPOINT_ENCRYPTION_IMPLEMENTED = false

export function buildCheckpointRecord(args: {
  contentHash: string
  trainingExperimentId: string
  datasetManifestId: string
  tokenizerExperimentId: string | null
  architectureConfig: Record<string, unknown>
  trainingCodeVersion: string
  parentCheckpointId: string | null
}): TrainingCheckpoint {
  return {
    checkpointId: randomUUID(),
    createdAt: new Date().toISOString(),
    contentHash: args.contentHash,
    trainingExperimentId: args.trainingExperimentId,
    datasetManifestId: args.datasetManifestId,
    tokenizerExperimentId: args.tokenizerExperimentId,
    architectureConfig: args.architectureConfig,
    trainingCodeVersion: args.trainingCodeVersion,
    parentCheckpointId: args.parentCheckpointId,
    verificationStatus: 'unverified',
  }
}

/** Verifies a checkpoint's declared hash against real bytes. Never marks 'hash_verified' without
 * actually recomputing and comparing — no shortcut trust. */
export function verifyCheckpointHash(checkpoint: TrainingCheckpoint, actualBytes: Buffer): TrainingCheckpoint {
  const recomputed = createHash('sha256').update(actualBytes).digest('hex')
  return {
    ...checkpoint,
    verificationStatus: recomputed === checkpoint.contentHash ? 'hash_verified' : 'failed',
  }
}
