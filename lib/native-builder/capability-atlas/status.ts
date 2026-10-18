import type { CapabilityStatus, EvaluationRecord, SkillRecord, SourceRecord } from './types'
import { MATURE_STATUSES } from './types'

export class CapabilityStatusError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityStatusError'
  }
}

const RANK: Record<string, number> = Object.fromEntries(MATURE_STATUSES.map((status, index) => [status, index]))

export function isCapabilityStatus(value: string): value is CapabilityStatus {
  return RANK[value] !== undefined || value === 'STALE' || value === 'FAILED' || value === 'UNSUPPORTED'
}

export function computeCapabilityStatus(input: {
  skill: Pick<SkillRecord, 'skillId' | 'unsupportedReason' | 'supportedToolBrokerTools' | 'officialSources' | 'openSourceSources' | 'productionProofMissions' | 'evidence'>
  evaluations: EvaluationRecord[]
  sources: SourceRecord[]
}): CapabilityStatus {
  const { skill, evaluations, sources } = input
  if (skill.unsupportedReason) return 'UNSUPPORTED'
  const skillEvals = evaluations.filter(item => item.skillId === skill.skillId)
  const failed = skillEvals.some(item => item.outcome === 'FAIL')
  const passed = skillEvals.filter(item => item.outcome === 'PASS')
  const productionPass = passed.some(item => item.production || item.level === 'PRODUCTION_EVAL')
  const integrationPass = passed.some(item => item.level === 'INTEGRATION_EVAL')
  const anyOutcome = skillEvals.some(item => item.outcome === 'PASS' || item.outcome === 'FAIL' || item.outcome === 'PARTIAL')
  const pending = skillEvals.some(item => item.outcome === 'NOT_RUN')
  const attachedSources = sources.filter(source => source.skillIds.includes(skill.skillId) && !source.stale)
  const staleSources = sources.filter(source => source.skillIds.includes(skill.skillId) && source.stale)
  if (failed && !passed.length) return 'FAILED'
  if (staleSources.length > 0) return 'STALE'
  if (skill.productionProofMissions.length > 0 && productionPass) return 'PRODUCTION_PROVEN'
  if (integrationPass) return 'PROVEN'
  if (anyOutcome) return 'EVALUATED'
  if (pending) return 'EVALUATION_PENDING'
  const tools = skill.supportedToolBrokerTools.length > 0 || skill.evidence.brokerTools.length > 0
  const impl = skill.evidence.implementationFiles.length > 0
  if (tools && impl) return 'AVAILABLE'
  if (attachedSources.length > 0) return impl ? 'AVAILABLE' : 'LEARNABLE'
  if (skill.officialSources.length + skill.openSourceSources.length > 0) return 'SOURCE_BACKED'
  return 'DISCOVERED'
}

export function assertCanAssignStatus(status: CapabilityStatus, input: {
  evaluations: EvaluationRecord[]
  productionProofMissions: string[]
}): void {
  if (status === 'PROVEN') {
    const pass = input.evaluations.some(item => item.outcome === 'PASS' && item.level === 'INTEGRATION_EVAL')
    if (!pass) {
      throw new CapabilityStatusError('PROVEN requires a passing INTEGRATION_EVAL. CODE_EVAL, DEBUG_EVAL, and KNOWLEDGE_EVAL are not mastery.')
    }
  }
  if (status === 'PRODUCTION_PROVEN') {
    const pass = input.evaluations.some(item => item.outcome === 'PASS' && (item.production || item.level === 'PRODUCTION_EVAL'))
    if (!pass || input.productionProofMissions.length === 0) {
      throw new CapabilityStatusError('PRODUCTION_PROVEN requires a passing PRODUCTION_EVAL and named production proof missions.')
    }
  }
}

export function applyDerivedStatus(skill: SkillRecord, evaluations: EvaluationRecord[], sources: SourceRecord[]): SkillRecord {
  const next = computeCapabilityStatus({ skill, evaluations, sources })
  return {
    ...skill,
    capabilityStatus: next,
    confidence: next === 'PRODUCTION_PROVEN' || next === 'PROVEN' ? 'high'
      : next === 'AVAILABLE' || next === 'EVALUATED' ? 'medium'
        : next === 'FAILED' || next === 'STALE' || next === 'UNSUPPORTED' ? 'low'
          : 'none',
  }
}
