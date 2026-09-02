import { createHash } from 'node:crypto'
import type { CheckpointCandidate, DatasetSplit, EvalManifest, M1TrainingEstimate, PromotionRecommendation, Wave4AdmittedRecord, Wave4DatasetManifest, Wave4DatasetRecord, Wave4ExclusionReason } from './types'

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
export const contentHash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
const normalizedContentHash = (content: string) => contentHash(content.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase())
const splitFor = (lineages: string[]): DatasetSplit => {
  const bucket = parseInt(contentHash([...lineages].sort()).slice(0, 8), 16) % 100
  return bucket < 80 ? 'train' : bucket < 90 ? 'validation' : 'test'
}

export function exclusionReasons(record: Wave4DatasetRecord, now: Date): Wave4ExclusionReason[] {
  const reasons: Wave4ExclusionReason[] = []
  if (!record.wave3Eligible || record.verificationState !== 'verified') reasons.push('wave3_not_eligible')
  if (!record.provenanceRefs.length) reasons.push('missing_provenance')
  if (record.provenanceRefs.some(ref => /^(unknown|unverified|imported)(:|$)/i.test(ref))) reasons.push('provenance_poor')
  if (!record.sourceLineageIds.length) reasons.push('provenance_poor')
  if (record.containsHiddenCot) reasons.push('hidden_cot')
  if (record.containsSecret) reasons.push('secret_detected')
  if (record.validUntil && new Date(record.validUntil) <= now) reasons.push('stale')
  if (record.verificationState === 'retracted') reasons.push('retracted')
  if (record.verificationState === 'contested') reasons.push('contested')
  if (record.poisoned) reasons.push('poisoned')
  if (record.recordType === 'correction' && !record.commanderCorrection?.applied) reasons.push('correction_not_applied')
  return [...new Set(reasons)]
}

export function buildDatasetManifest(records: Wave4DatasetRecord[], parentCandidateManifestIds: string[], now = new Date()): Wave4DatasetManifest {
  const exclusions: Wave4DatasetManifest['exclusions'] = []
  const eligible: { record: Wave4DatasetRecord; hash: string }[] = []
  const seenContent = new Set<string>()
  for (const record of [...records].sort((a, b) => a.recordId.localeCompare(b.recordId))) {
    const reasons = exclusionReasons(record, now)
    const hash = normalizedContentHash(record.content)
    if (seenContent.has(hash)) reasons.push('duplicate_content')
    if (reasons.length) exclusions.push({ recordId: record.recordId, reasons: [...new Set(reasons)] })
    else { seenContent.add(hash); eligible.push({ record, hash }) }
  }
  const lineageSplit = new Map<string, DatasetSplit>()
  const admitted: Wave4AdmittedRecord[] = []
  for (const { record, hash } of eligible) {
    const split = splitFor(record.sourceLineageIds)
    const collision = record.sourceLineageIds.some(id => lineageSplit.has(id) && lineageSplit.get(id) !== split)
    if (collision) { exclusions.push({ recordId: record.recordId, reasons: ['source_lineage_leakage'] }); continue }
    record.sourceLineageIds.forEach(id => lineageSplit.set(id, split))
    admitted.push({ ...record, contentHash: hash, split })
  }
  const hashPayload = admitted.map(r => ({ recordId: r.recordId, contentHash: r.contentHash, split: r.split, provenanceRefs: [...r.provenanceRefs].sort(), sourceLineageIds: [...r.sourceLineageIds].sort(), commanderCorrection: r.commanderCorrection, curriculumTags: [...r.curriculumTags].sort(), capabilityTags: [...r.capabilityTags].sort() }))
  const datasetHash = contentHash({ policyVersion: 'wave4-v1', parents: [...parentCandidateManifestIds].sort(), records: hashPayload })
  const splitCounts = { train: 0, validation: 0, test: 0 }
  admitted.forEach(r => { splitCounts[r.split] += 1 })
  return { manifestId: `w4ds_${datasetHash.slice(0, 24)}`, policyVersion: 'wave4-v1', createdAt: now.toISOString(), parentCandidateManifestIds: [...parentCandidateManifestIds].sort(), records: admitted, exclusions, splitCounts, datasetHash, immutable: true, trainingStarted: false }
}

export function registerCheckpointCandidate(input: Omit<CheckpointCandidate, 'checkpointCandidateId' | 'modelId' | 'createdAt' | 'status' | 'rollbackCheckpointId' | 'trainingStarted'>, now = new Date()): CheckpointCandidate {
  if (!input.parentCheckpointId.startsWith('WRIM-0:')) throw new Error('WRIM-1 candidate must descend from an explicitly identified WRIM-0 checkpoint')
  if (!/^[a-f0-9]{64}$/.test(input.parentCheckpointHash)) throw new Error('parent checkpoint hash is required and immutable')
  const id = contentHash(input)
  return { ...input, checkpointCandidateId: `w4ckpt_${id.slice(0, 24)}`, modelId: 'WRIM-1-candidate', createdAt: now.toISOString(), status: 'registered', rollbackCheckpointId: input.parentCheckpointId, trainingStarted: false }
}

export function buildEvalManifest(checkpointCandidateId: string, benchmarkRefs: string[], metrics: EvalManifest['metrics']): EvalManifest {
  if (!benchmarkRefs.length || !metrics.length) throw new Error('eval evidence and capability metrics are required')
  const hash = contentHash({ checkpointCandidateId, benchmarkRefs: [...benchmarkRefs].sort(), metrics: [...metrics].sort((a, b) => a.capabilityKey.localeCompare(b.capabilityKey)) })
  return { evalManifestId: `w4eval_${hash.slice(0, 24)}`, checkpointCandidateId, benchmarkRefs: [...benchmarkRefs].sort(), metrics, contentHash: hash }
}

export function evaluateRegressionGates(manifest: EvalManifest): PromotionRecommendation {
  const reasons = manifest.metrics.flatMap(metric => {
    const out: string[] = []
    if (metric.candidateScore < metric.minimumScore) out.push(`${metric.capabilityKey}:below_minimum`)
    if (metric.baselineScore - metric.candidateScore > metric.maximumRegression) out.push(`${metric.capabilityKey}:regression_gate_failed`)
    return out
  })
  return { recommendation: reasons.length ? 'reject' : 'recommend', reasons, commanderAuthorization: 'not_requested', promotionExecuted: false }
}

export function estimateM1TrainingPlan(input: { chip: string; unifiedMemoryBytes: number; availableMemoryBytes: number; freeDiskBytes: number; parameterCount: number; datasetTokens: number; epochs: number; sequenceLength: number; effectiveBatchSize: number }): M1TrainingEstimate {
  const steps = Math.ceil(input.datasetTokens * input.epochs / (input.sequenceLength * input.effectiveBatchSize))
  const peakLow = Math.ceil(input.parameterCount * 12 + input.sequenceLength * input.effectiveBatchSize * 1024 * 32)
  const peakHigh = Math.ceil(peakLow * 1.8)
  const checkpointDiskBytes = input.parameterCount * 4
  const isAppleM1 = /apple m1/i.test(input.chip)
  return {
    hardware: { chip: input.chip, unifiedMemoryBytes: input.unifiedMemoryBytes, availableMemoryBytes: input.availableMemoryBytes, freeDiskBytes: input.freeDiskBytes },
    parameterCount: input.parameterCount, datasetTokens: input.datasetTokens, epochs: input.epochs, estimatedSteps: steps,
    estimatedWallClockHours: isAppleM1 ? { low: Number((steps * 0.4 / 3600).toFixed(2)), high: Number((steps * 4 / 3600).toFixed(2)) } : null,
    peakMemoryBytes: { low: peakLow, high: peakHigh }, checkpointDiskBytes,
    locallyFeasible: peakHigh <= input.availableMemoryBytes * 0.8 && checkpointDiskBytes * 3 <= input.freeDiskBytes,
    confidence: 'low', assumptions: ['Planning estimate only; no benchmark was run.', 'M1 throughput range is deliberately broad and must be calibrated with an approved bounded dry benchmark.', 'Memory includes parameter, gradient, optimizer, activation, and uncertainty approximations.', 'No training process is launched by this estimator.'], trainingStarted: false,
  }
}
