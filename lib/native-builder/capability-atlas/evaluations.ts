import type { EvaluationLevel, EvaluationOutcome, EvaluationRecord, ConfidenceLevel } from './types'
import { EVALUATION_LEVELS } from './types'
import { assertCanAssignStatus, CapabilityStatusError } from './status'
import { persistEvaluation, persistSkill, type CapabilityAtlas } from './store'

export function isEvaluationLevel(value: string): value is EvaluationLevel {
  return (EVALUATION_LEVELS as readonly string[]).includes(value)
}

export function createEvaluation(input: Omit<EvaluationRecord, 'outcome' | 'evaluatedAt'> & {
  outcome?: EvaluationOutcome
  evaluatedAt?: string | null
}): EvaluationRecord {
  if (!isEvaluationLevel(input.level)) throw new CapabilityStatusError(`Unknown evaluation level: ${input.level}`)
  if (!input.requiredSteps.length) throw new CapabilityStatusError(`Evaluation ${input.evaluationId} needs requiredSteps`)
  return {
    ...input,
    outcome: input.outcome ?? 'NOT_RUN',
    evaluatedAt: input.evaluatedAt ?? null,
    production: input.production || input.level === 'PRODUCTION_EVAL',
    command: input.command ?? null,
    resultSummary: input.resultSummary ?? '',
    environment: input.environment ?? null,
    limitations: input.limitations ?? '',
    confidence: input.confidence ?? 'low',
  }
}

export function recordEvaluationOutcome(
  evaluation: EvaluationRecord,
  outcome: EvaluationOutcome,
  evidencePaths: string[],
  at = new Date().toISOString(),
): EvaluationRecord {
  if (outcome === 'PASS' && evidencePaths.length === 0 && evaluation.evidencePaths.length === 0) {
    throw new CapabilityStatusError('PASS requires evaluation evidence paths')
  }
  return {
    ...evaluation,
    outcome,
    evidencePaths: evidencePaths.length ? evidencePaths : evaluation.evidencePaths,
    evaluatedAt: at,
  }
}

export function recordSkillEvaluation(
  atlas: CapabilityAtlas,
  input: {
    evaluationId: string
    skillId: string
    level: EvaluationLevel
    title: string
    requiredSteps: string[]
    evidencePaths: string[]
    outcome: EvaluationOutcome
    production?: boolean
    missionId?: string | null
    notes?: string
    command?: string | null
    resultSummary?: string
    environment?: string | null
    limitations?: string
    confidence?: ConfidenceLevel
  },
): void {
  const skill = atlas.skills.get(input.skillId)
  if (!skill) throw new Error(`Unknown skill: ${input.skillId}`)
  let evaluation = createEvaluation({
    evaluationId: input.evaluationId,
    skillId: input.skillId,
    level: input.level,
    title: input.title,
    requiredSteps: input.requiredSteps,
    evidencePaths: input.evidencePaths,
    missionId: input.missionId ?? null,
    notes: input.notes ?? '',
    production: Boolean(input.production) || input.level === 'PRODUCTION_EVAL',
    command: input.command ?? null,
    resultSummary: input.resultSummary ?? '',
    environment: input.environment ?? `${process.platform} ${process.version}`,
    limitations: input.limitations ?? '',
    confidence: input.confidence ?? (input.outcome === 'PASS' ? 'medium' : 'low'),
  })
  if (input.outcome !== 'NOT_RUN') {
    evaluation = recordEvaluationOutcome(evaluation, input.outcome, input.evidencePaths)
  }
  const nextMissions = (input.production || input.level === 'PRODUCTION_EVAL') && input.outcome === 'PASS' && input.missionId
    ? [...new Set([...skill.productionProofMissions, input.missionId])]
    : skill.productionProofMissions
  if (input.outcome === 'PASS' && (input.production || input.level === 'PRODUCTION_EVAL')) {
    assertCanAssignStatus('PRODUCTION_PROVEN', {
      evaluations: [evaluation],
      productionProofMissions: nextMissions,
    })
  } else if (input.outcome === 'PASS' && input.level === 'INTEGRATION_EVAL') {
    assertCanAssignStatus('PROVEN', {
      evaluations: [evaluation],
      productionProofMissions: nextMissions,
    })
  }
  skill.productionProofMissions = nextMissions
  skill.lastCapabilityEvaluated = evaluation.evaluatedAt
  persistSkill(atlas, skill)
  persistEvaluation(atlas, evaluation)
}
