/**
 * Binds a recorded root-cause sentence to public symptom, constraints, and observed checks.
 * Does not read hidden verifiers and does not rewrite the model's sentence.
 * The claim shape is an evidence/claim record. It does not import or change FRK.
 */
export const ROOT_CAUSE_STATUSES = ['SUPPORTED', 'PARTIAL', 'UNSUPPORTED', 'CONTRADICTED'] as const
export type RootCauseStatus = (typeof ROOT_CAUSE_STATUSES)[number]

export type FoundryRootCauseClaim = {
  caseId: string
  symptom: string
  rootCause: string
  evidenceIds: string[]
  contradictingEvidenceIds: string[]
  repairImplication: string
  status: RootCauseStatus
  engineeringPass: boolean
  reasoningPass: boolean
  correctedFromEvidence: boolean
}

const STOP = new Set([
  'about', 'after', 'again', 'because', 'before', 'being', 'current', 'currently', 'defined',
  'every', 'fails', 'failure', 'function', 'implementation', 'input', 'must', 'properly',
  'return', 'should', 'still', 'their', 'there', 'these', 'this', 'using', 'value', 'which', 'would',
])

function tokens(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9]{4,}/g) ?? []).filter(token => !STOP.has(token)))]
}

function symptomDenial(symptom: string, claim: string): string | null {
  const symptomLower = symptom.toLowerCase()
  const match = claim.toLowerCase().match(/does not ([a-z]{4,})/)
  if (!match) return null
  const stem = match[1].slice(0, 6)
  if (stem.length >= 4 && symptomLower.includes(stem)) return `claim denies ${match[1]} while the symptom asserts it`
  return null
}

export function bindRootCauseClaim(input: {
  caseId: string
  trivial?: boolean
  symptom: string
  constraints: string[]
  rootCause: string
  problemModel?: string
  selectedApproach: string
  engineeringPass: boolean
  planToCodeStatus: string | null
  implementationFidelity?: string | null
  verifierEvidence: string
}): FoundryRootCauseClaim {
  const rootCause = input.rootCause.trim()
  const repairImplication = input.selectedApproach.trim()
  const evidenceIds = ['symptom']
  if (input.constraints.length) evidenceIds.push('constraints')
  if (input.verifierEvidence) evidenceIds.push(input.engineeringPass ? 'verifier-pass' : 'verifier-failure')
  if (input.planToCodeStatus) evidenceIds.push(`plan-${input.planToCodeStatus}`)
  const contradictingEvidenceIds: string[] = []
  const denial = rootCause ? symptomDenial(input.symptom, rootCause) : null
  if (denial) contradictingEvidenceIds.push('symptom-denial')
  const defect = new Set([...tokens(input.symptom), ...tokens(input.constraints.join(' '))])
  const claimTokens = tokens(rootCause)
  const overlap = claimTokens.filter(token => defect.has(token))
  const repairDenial = repairImplication ? symptomDenial(input.symptom, repairImplication) : null
  const planContradicted = input.planToCodeStatus === 'CONTRADICTED' || input.implementationFidelity === 'MISMATCH'
  if (planContradicted && input.engineeringPass) contradictingEvidenceIds.push('plan-mismatch-after-pass')
  let status: RootCauseStatus
  if (!rootCause) status = 'UNSUPPORTED'
  else if (denial) status = 'CONTRADICTED'
  else if (overlap.length >= 2 && !planContradicted) status = 'SUPPORTED'
  else if (overlap.length >= 1) status = 'PARTIAL'
  else status = 'UNSUPPORTED'
  const repairConsistent = Boolean(repairImplication)
    && !repairDenial
    && !planContradicted
    && overlap.length >= 1
  const reasoningPass = input.engineeringPass && status === 'SUPPORTED' && repairConsistent && !input.trivial
  return {
    caseId: input.caseId,
    symptom: input.symptom,
    rootCause,
    evidenceIds,
    contradictingEvidenceIds,
    repairImplication,
    status,
    engineeringPass: input.engineeringPass,
    reasoningPass,
    correctedFromEvidence: false,
  }
}

export function correctedClaimFromPublicEvidence(input: {
  caseId: string
  symptom: string
  constraints: string[]
  selectedApproach: string
  engineeringPass: boolean
  planToCodeStatus: string | null
  modelClaim: FoundryRootCauseClaim
}): FoundryRootCauseClaim | null {
  if (input.modelClaim.status === 'SUPPORTED' || !input.engineeringPass) return null
  const approachDenial = symptomDenial(input.symptom, input.selectedApproach)
  return {
    caseId: input.caseId,
    symptom: input.symptom,
    rootCause: input.symptom,
    evidenceIds: ['symptom', 'constraints', input.engineeringPass ? 'verifier-pass' : 'verifier-failure', `plan-${input.planToCodeStatus ?? 'UNCLEAR'}`],
    contradictingEvidenceIds: input.modelClaim.contradictingEvidenceIds,
    repairImplication: approachDenial ? '' : input.selectedApproach.trim(),
    status: 'SUPPORTED',
    engineeringPass: input.engineeringPass,
    reasoningPass: false,
    correctedFromEvidence: true,
  }
}
