/**
 * SENTINEL — operational / security risk. Distinct from PHOENIX (claim support).
 * NEVER grants authority. Commander remains the authority source.
 */

import { SENTINEL_REVIEW_SCHEMA, type AtlasPlanGraph, type JanusAnalysis, type MissionContractV1, type SentinelAction, type SentinelCategory, type SentinelReview, type SentinelRisk, type SentinelSeverity } from './types'

const DESTRUCTIVE =
  /\b(delete production(?: database)?|drop table|rm -rf|wipe (?:the )?install|destroy data)\b/i
const SECRET = /\b(secret|api[_-]?key|service.role|private key|\.env)\b/i
const FINANCIAL = /\b(spend|payment|wager|settlement)\b|\btrades?\b(?!-off)/i
const PROD = /\b(production deploy|\/opt\/War Room OS|live deploy|transition_to_active)\b/i
const IRREV = /\b(irreversible|no undo|cannot roll back)\b/i
const AUTO_DEPLOY = /\b(deploy automatically|automatic deploy|auto-deploy|foundry deploy automatically)\b/i

function risk(partial: Omit<SentinelRisk, 'likelihood_class' | 'impact_class' | 'detectability' | 'reversibility' | 'time_to_harm' | 'residual_risk'> & Partial<SentinelRisk>): SentinelRisk {
  const severity = partial.severity
  const impact = severity === 'MED' ? 'MEDIUM' : severity
  return Object.freeze({
    likelihood_class: impact,
    impact_class: impact,
    detectability: partial.blocking ? 'HIGH' : 'MEDIUM',
    reversibility: partial.category === 'IRREVERSIBILITY' || partial.category === 'DATA_LOSS' ? 'IRREVERSIBLE' : 'REVERSIBLE',
    time_to_harm: partial.blocking ? 'IMMEDIATE' : 'UNKNOWN',
    residual_risk: partial.blocking ? 'HIGH' : 'LOW',
    ...partial,
  })
}

function actionFor(blocking: boolean, approval: boolean, warn: boolean): SentinelAction {
  if (blocking) return 'BLOCK'
  if (approval) return 'REQUIRE_APPROVAL'
  if (warn) return 'WARN'
  return 'ALLOW_WITHIN_EXISTING_AUTHORITY'
}

function scanText(text: string, stepIds: string[]): SentinelRisk[] {
  const risks: SentinelRisk[] = []
  if (DESTRUCTIVE.test(text)) {
    risks.push(risk({
      risk_id: 'r-data-loss',
      category: 'DATA_LOSS',
      severity: 'CRITICAL',
      description: 'Plan or objective includes destructive data/production deletion.',
      affected_steps: stepIds,
      evidence_ids: [],
      mitigation: 'Refuse execution. Require explicit Commander override if ever permitted.',
      approval_required: true,
      blocking: true,
      action: 'BLOCK',
      status: 'BLOCKED',
    }))
  }
  if (SECRET.test(text)) {
    risks.push(risk({
      risk_id: 'r-secret',
      category: 'SECRET_EXPOSURE',
      severity: 'CRITICAL',
      description: 'Secret or credential material is in scope.',
      affected_steps: stepIds,
      evidence_ids: [],
      mitigation: 'Do not print, copy, or store secrets in receipts or memory.',
      approval_required: true,
      blocking: true,
      action: 'BLOCK',
      status: 'BLOCKED',
    }))
  }
  if (FINANCIAL.test(text)) {
    risks.push(risk({
      risk_id: 'r-financial',
      category: 'FINANCIAL_ACTION',
      severity: 'CRITICAL',
      description: 'Financial or wagering action implied.',
      affected_steps: stepIds.filter(id => /auth-finance|spend|trade|wager/.test(id)),
      evidence_ids: [],
      mitigation: 'DENY unless Commander authorization exists. No real financial call.',
      approval_required: true,
      blocking: true,
      action: 'BLOCK',
      status: 'BLOCKED',
    }))
  }
  if (AUTO_DEPLOY.test(text) || PROD.test(text)) {
    risks.push(risk({
      risk_id: 'r-prod',
      category: 'PRODUCTION_MUTATION',
      severity: 'HIGH',
      description: 'Production mutation or /opt overlay implied.',
      affected_steps: stepIds,
      evidence_ids: [],
      mitigation: 'Require Commander approval. Additive per-user install is the authorized path.',
      approval_required: true,
      blocking: true,
      action: 'BLOCK',
      status: 'BLOCKED',
    }))
  }
  if (IRREV.test(text)) {
    risks.push(risk({
      risk_id: 'r-irrev',
      category: 'IRREVERSIBILITY',
      severity: 'HIGH',
      description: 'Irreversible external effect implied.',
      affected_steps: stepIds,
      evidence_ids: [],
      mitigation: 'REQUIRE_APPROVAL. Do not self-approve.',
      approval_required: true,
      blocking: false,
      action: 'REQUIRE_APPROVAL',
      status: 'OPEN',
    }))
  }
  return risks
}

export function reviewWithSentinel(input: {
  contract: MissionContractV1
  plan?: AtlasPlanGraph | null
  scenarios?: JanusAnalysis | null
  now?: string
}): SentinelReview {
  const steps = input.plan?.steps ?? []
  const stepIds = steps.map(item => item.step_id)
  const blob = [
    input.contract.objective,
    input.contract.commander_wording,
    ...steps.map(item => `${item.title} ${item.purpose}`),
    ...(input.scenarios?.scenarios ?? []).map(item => item.option),
  ].join('\n')
  const risks: SentinelRisk[] = [
    ...scanText(blob, stepIds),
  ]
  for (const planStep of steps) {
    if (planStep.status === 'BLOCKED_BY_AUTHORITY') {
      risks.push(risk({
        risk_id: `r-auth-${planStep.step_id}`,
        category: 'AUTHORITY_VIOLATION',
        severity: 'HIGH',
        description: `ATLAS step ${planStep.step_id} is blocked by authority and must not execute.`,
        affected_steps: [planStep.step_id],
        evidence_ids: [],
        mitigation: 'Tool Governor DENY unless Commander override is explicitly recorded.',
        approval_required: true,
        blocking: true,
        action: 'BLOCK',
        status: 'BLOCKED',
      }))
    }
    if (!planStep.reversible && planStep.required_capabilities.some(cap => /commit|push|deploy|delete|write/.test(cap))) {
      risks.push(risk({
        risk_id: `r-irrev-${planStep.step_id}`,
        category: 'IRREVERSIBILITY',
        severity: 'HIGH',
        description: `Step ${planStep.step_id} is not reversible.`,
        affected_steps: [planStep.step_id],
        evidence_ids: [],
        mitigation: 'Require Commander approval before any execution attempt.',
        approval_required: true,
        blocking: false,
        action: 'REQUIRE_APPROVAL',
        status: 'OPEN',
      }))
    }
  }
  if (!input.contract.authority.commit) {
    risks.push(risk({
      risk_id: 'r-model-uncertainty',
      category: 'MODEL_UNCERTAINTY',
      severity: 'LOW',
      description: 'Planner output is not proof. Execution remains gated.',
      affected_steps: [],
      evidence_ids: [],
      mitigation: 'Do not treat ATLAS/JANUS prose as authority.',
      approval_required: false,
      blocking: false,
      action: 'WARN',
      status: 'OPEN',
    }))
  }
  const uniq = new Map<string, SentinelRisk>()
  for (const item of risks) uniq.set(item.risk_id, item)
  return Object.freeze({
    schema: SENTINEL_REVIEW_SCHEMA,
    mission_id: input.contract.mission_id,
    role: 'SENTINEL',
    provider_kind: 'deterministic',
    invoked: true,
    skip_reason: null,
    risks: [...uniq.values()],
    grants_authority: false,
    created_at: input.now ?? new Date().toISOString(),
  })
}

export function skippedSentinel(missionId: string, reason: string, now?: string): SentinelReview {
  return Object.freeze({
    schema: SENTINEL_REVIEW_SCHEMA,
    mission_id: missionId,
    role: 'SENTINEL',
    provider_kind: 'deterministic',
    invoked: false,
    skip_reason: reason,
    risks: [],
    grants_authority: false,
    created_at: now ?? new Date().toISOString(),
  })
}

export function sentinelNeverGrantsAuthority(review: SentinelReview): boolean {
  return review.grants_authority === false && !review.risks.some(item => item.action === 'ALLOW_WITHIN_EXISTING_AUTHORITY' && item.blocking)
}

export function blockingRisksForStep(review: SentinelReview, stepId: string): SentinelRisk[] {
  return review.risks.filter(item => item.blocking && (item.affected_steps.includes(stepId) || item.affected_steps.length === 0 && item.category !== 'MODEL_UNCERTAINTY'))
}

export function sentinelSeverityRank(severity: SentinelSeverity): number {
  return { LOW: 1, MED: 2, HIGH: 3, CRITICAL: 4 }[severity]
}

export function sentinelCategoryList(): readonly SentinelCategory[] {
  return [
    'DATA_LOSS',
    'SECRET_EXPOSURE',
    'AUTHORITY_VIOLATION',
    'PRODUCTION_MUTATION',
    'FINANCIAL_ACTION',
    'IRREVERSIBILITY',
    'SECURITY',
    'PRIVACY',
    'AVAILABILITY',
    'DEPENDENCY',
    'RESOURCE_EXHAUSTION',
    'MODEL_UNCERTAINTY',
    'EXTERNAL_SIDE_EFFECT',
  ]
}
