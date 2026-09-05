import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { evaluateContinuousEvidence } from './engine'
import type { ContinuousEvidenceInput, ContinuousEvidenceRecord, EvidenceRejection } from './types'

/** Default durable capture boundary for observable terminal events. Callers report outcomes they
 * already produced; this function performs no mission, research, prediction, or training action. */
export async function captureContinuousEvidence(input: ContinuousEvidenceInput): Promise<{ record: ContinuousEvidenceRecord | null; rejection: EvidenceRejection | null }> {
  const evaluated = evaluateContinuousEvidence(input)
  const root = resolveBaseRepoRoot(); const directory = path.join(root, '.war-room', 'continuous-evidence', evaluated.record ? 'admitted' : 'rejected')
  await mkdir(directory, { recursive: true })
  const id = evaluated.record?.evidence.id ?? evaluated.rejection!.evidenceId
  await writeFile(path.join(directory, `${id}.json`), `${JSON.stringify({ input, ...evaluated }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  return evaluated
}

export const captureResearchVerification = (input: Omit<ContinuousEvidenceInput, 'source'>) => captureContinuousEvidence({ ...input, source: 'research_engine' })
export const captureWorldLearningResolution = (input: Omit<ContinuousEvidenceInput, 'source'>) => captureContinuousEvidence({ ...input, source: 'world_learning' })
export const captureTerraPredictionOutcome = (input: Omit<ContinuousEvidenceInput, 'source'>) => captureContinuousEvidence({ ...input, source: 'terra' })
export const captureCommanderCorrectionOutcome = (input: Omit<ContinuousEvidenceInput, 'source'>) => captureContinuousEvidence({ ...input, source: 'commander_correction' })
export const captureToolUseOutcome = (input: Omit<ContinuousEvidenceInput, 'source'>) => captureContinuousEvidence({ ...input, source: 'tool_use' })
