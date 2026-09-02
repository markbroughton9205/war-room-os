import { createHash } from 'node:crypto'
import type {
  CapabilityNode, LearningEvidence, PredictionRecord, StudyMission,
  TrainingCandidate, TrainingCandidateManifest,
} from './types'

const stableId = (prefix: string, value: unknown) =>
  `${prefix}_${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20)}`

export function generateResearchQuestions(question: string, kind: string): string[] {
  const base = question.trim().replace(/\s+/g, ' ')
  if (!base) return []
  if (kind === 'conflicting_sources') return [
    `What primary evidence supports each side of: ${base}`,
    `Are the conflicting claims scoped to different times, places, or definitions?`,
    `What independent source can discriminate between the conflicting claims?`,
  ]
  if (kind === 'stale_knowledge') return [`What is the newest dated primary evidence for: ${base}`, `Has the prior answer been superseded or retracted?`]
  if (kind === 'capability_gap') return [`What objective task demonstrates competence in: ${base}`, `What deterministic pass/fail check measures that task?`]
  return [`What primary sources answer: ${base}`, `What independent evidence would falsify the leading answer?`]
}

export function planStudyMission(input: {
  gapId: string; question: string; gapType: string; projectId: string | null; userId: string | null
  generatorId: string; verifierId: string; evaluatorId: string
}): StudyMission {
  if (new Set([input.generatorId, input.verifierId, input.evaluatorId]).size !== 3) {
    throw new Error('generator, verifier, and evaluator must be separate identities')
  }
  const missionKind = input.gapType === 'conflicting_sources' ? 'targeted_verification'
    : input.gapType === 'capability_gap' ? 'code_skill' : 'research'
  const questions = generateResearchQuestions(input.question, input.gapType)
  return {
    id: stableId('mission', [input.gapId, questions]), projectId: input.projectId, userId: input.userId,
    gapId: input.gapId, objective: input.question, questions, missionKind,
    generatorId: input.generatorId, verifierId: input.verifierId, evaluatorId: input.evaluatorId,
    status: 'planned', evidenceIds: [],
  }
}

export function canResolveGap(evidence: LearningEvidence[]): boolean {
  const usable = evidence.filter(e => !e.poisoned && e.provenanceRefs.length > 0)
  return usable.some(e => e.kind === 'verification' && e.outcome === 'pass' && e.verifierId)
    && usable.some(e => e.kind === 'evaluation' && e.outcome === 'pass' && e.evaluatorId)
}

export function updateCapability(node: CapabilityNode, evidence: LearningEvidence): CapabilityNode {
  if (evidence.poisoned || !evidence.provenanceRefs.length || !['pass', 'fail'].includes(evidence.outcome)) return node
  if (!['code_operator_result', 'verification', 'prediction_outcome'].includes(evidence.kind)) return node
  const pass = evidence.outcome === 'pass' ? 1 : 0
  const fail = evidence.outcome === 'fail' ? 1 : 0
  const passCount = node.passCount + pass
  const failCount = node.failCount + fail
  return {
    ...node, passCount, failCount,
    level: Math.max(0, Math.min(1, (passCount + 1) / (passCount + failCount + 2))),
    confidence: Math.min(1, (passCount + failCount) / 5),
    evidenceIds: [...new Set([...node.evidenceIds, evidence.id])],
  }
}

export function trainingExclusionReasons(candidate: TrainingCandidate, now = new Date()): string[] {
  const reasons: string[] = []
  if (candidate.verificationState !== 'verified') reasons.push(`verification_state:${candidate.verificationState}`)
  if (!candidate.provenanceRefs.length) reasons.push('missing_provenance')
  if (candidate.evidenceIds.length < 2) reasons.push('insufficient_evidence')
  if (candidate.poisoned) reasons.push('poisoned')
  if (candidate.validUntil && new Date(candidate.validUntil) <= now) reasons.push('stale')
  if (candidate.recordType === 'correction' && !candidate.commanderCorrectionApplied) reasons.push('correction_not_applied')
  return reasons
}

export function buildTrainingCandidateManifest(candidates: TrainingCandidate[], now = new Date()): TrainingCandidateManifest {
  const eligible: TrainingCandidate[] = []
  const excluded: { recordId: string; reasons: string[] }[] = []
  for (const candidate of candidates) {
    const reasons = trainingExclusionReasons(candidate, now)
    if (reasons.length) excluded.push({ recordId: candidate.recordId, reasons })
    else eligible.push(candidate)
  }
  return {
    id: stableId('manifest', [now.toISOString(), candidates.map(c => c.recordId)]), createdAt: now.toISOString(),
    policyVersion: 'wave3-v1', modelLineage: 'wrim-1-candidate',
    eligibilityState: eligible.length > 0 ? 'eligible' : 'not_eligible',
    authorizationState: 'not_requested', trainingState: 'not_started', trainingAuthorized: false,
    commanderAuthorizedBy: null, commanderAuthorizedAt: null, candidates: eligible, excluded,
  }
}

/** Authorization is deliberately separate from evidence-derived eligibility. This function can
 * move an eligible manifest through Commander review, but it has no transition into training. */
export function transitionTrainingCandidateAuthorization(
  manifest: TrainingCandidateManifest,
  next: 'awaiting_commander_authorization' | 'authorized',
  actor: { kind: 'commander'; id: string } | { kind: 'automation'; id: string },
  now = new Date(),
): TrainingCandidateManifest {
  if (manifest.eligibilityState !== 'eligible') throw new Error('training candidate is not eligible')
  if (manifest.trainingState !== 'not_started') throw new Error('authorization cannot change after training starts')
  if (next === 'awaiting_commander_authorization') {
    if (manifest.authorizationState !== 'not_requested') throw new Error('Commander review was already requested')
    return { ...manifest, authorizationState: next }
  }
  if (actor.kind !== 'commander') throw new Error('only the Commander can authorize WRIM-1 training')
  if (manifest.authorizationState !== 'awaiting_commander_authorization') throw new Error('Commander authorization review is required first')
  return {
    ...manifest, authorizationState: 'authorized', trainingAuthorized: true,
    commanderAuthorizedBy: actor.id, commanderAuthorizedAt: now.toISOString(),
  }
}

export function verifyPrediction(prediction: PredictionRecord, evidence: LearningEvidence, now = new Date()): PredictionRecord {
  if (prediction.projectId !== evidence.projectId || prediction.userId !== evidence.userId) throw new Error('prediction evidence scope mismatch')
  if (now < new Date(prediction.verifyAfter)) return prediction
  if (evidence.kind !== 'prediction_outcome' || evidence.provenanceRefs.length === 0 || evidence.poisoned) return prediction
  return { ...prediction, status: evidence.outcome === 'pass' ? 'verified' : evidence.outcome === 'fail' ? 'falsified' : 'pending', verificationEvidenceIds: [...prediction.verificationEvidenceIds, evidence.id] }
}

export function terraEvidenceIsCurrent(evidence: LearningEvidence, now = new Date()): boolean {
  return evidence.kind === 'terra_observation' && Boolean(evidence.validUntil) && new Date(evidence.observedAt) <= now && new Date(evidence.validUntil!) > now
}

export function curriculumPriorityFromSignals(signals: LearningEvidence[]): { subjectRef: string; score: number; evidenceIds: string[] }[] {
  const grouped = new Map<string, { score: number; evidenceIds: string[] }>()
  for (const signal of signals) {
    if (!['failure', 'commander_correction'].includes(signal.kind) || signal.poisoned || !signal.provenanceRefs.length) continue
    const current = grouped.get(signal.subjectRef) ?? { score: 0, evidenceIds: [] }
    current.score += signal.kind === 'commander_correction' ? 3 : 1
    current.evidenceIds.push(signal.id)
    grouped.set(signal.subjectRef, current)
  }
  return [...grouped.entries()].map(([subjectRef, value]) => ({ subjectRef, ...value })).sort((a, b) => b.score - a.score || a.subjectRef.localeCompare(b.subjectRef))
}

export function codeOperatorEvidence(input: {
  id: string; projectId: string | null; userId: string | null; repairId: string; validationRefs: string[];
  passed: boolean; observedAt: string; capabilityKey: string
}): LearningEvidence {
  return {
    id: input.id, projectId: input.projectId, userId: input.userId, kind: 'code_operator_result',
    subjectRef: `capability:${input.capabilityKey}`, outcome: input.passed ? 'pass' : 'fail',
    observedAt: input.observedAt, validUntil: null,
    provenanceRefs: [`native-repair:${input.repairId}`, ...input.validationRefs],
    verifierId: 'native-builder-repair-verifier', evaluatorId: 'curriculum-evaluator', poisoned: false,
    metadata: { repairId: input.repairId, capabilityKey: input.capabilityKey },
  }
}
