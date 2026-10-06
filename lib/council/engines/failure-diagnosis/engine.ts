import { recoverFromToolFailure } from '@/lib/council/gi/failureRecovery'
import { experienceFromMission } from '@/lib/council/intelligence/adaptiveIntelligence'
import type { MissionExperienceRecord } from '@/lib/council/intelligence/adaptiveIntelligence'
import { createEngineReceipt } from '../receipts'
import type { FailureCategory, FailureDiagnosis, FailureDiagnosisInput, FailureDiagnosisResult } from './types'

const CAUSE_BRANCHES: Record<string, string[]> = {
  'AURORA missing': ['server final missing', 'client parser dropped final', 'session stale guard rejected result', 'render gate hid message', 'renderer crashed'],
}

function classify(input: FailureDiagnosisInput): FailureCategory {
  const blob = `${input.symptom} ${input.exception ?? ''} ${input.receipts?.map(row => `${row.capability} ${row.error ?? ''}`).join(' ') ?? ''} ${input.tool_health ?? ''}`
  if (/hydrat|session.?ident|sidebar|pane owner/i.test(blob)) return 'SESSION_IDENTITY_FAILURE'
  if (/render|#418|cannot read properties|PAGEERROR/i.test(blob)) return 'RENDER_FAILURE'
  if (/stale.?guard|stale_generation|AbortError/i.test(blob)) return 'STALE_RESULT_DISCARD'
  if (/DATE_UNKNOWN|OUT_OF_WINDOW|REJECT_STALE/i.test(blob)) return 'FRESHNESS_FAILURE'
  if (/REJECT_OFF_TOPIC|relevance/i.test(blob)) return 'RELEVANCE_REJECTION'
  if (/REJECT_WRONG_AUTHORITY|authority/i.test(blob)) return 'AUTHORITY_FAILURE'
  if (/extract|opened no usable/i.test(blob)) return 'EXTRACTION_FAILURE'
  if (/timeout|ETIMEDOUT/i.test(blob) || input.timeout) return 'TOOL_TIMEOUT'
  if (/401|auth/i.test(blob)) return 'AUTH_FAILURE'
  if (/DEAD|unavailable|CHROMIUM_DISCONNECTED/i.test(blob)) return 'TOOL_UNAVAILABLE'
  if (/discover|no candidates/i.test(blob)) return 'DISCOVERY_FAILURE'
  if (/broker\.fetch|NAVIGATE_FAILED|retrieval/i.test(blob)) return 'RETRIEVAL_FAILURE'
  if (/budget/i.test(blob)) return 'BUDGET_EXHAUSTED'
  if (/lumen|verif/i.test(blob)) return 'VERIFICATION_FAILURE'
  if (/synth|aurora final/i.test(blob)) return 'SYNTHESIS_FAILURE'
  if (/corrupt checkpoint|integrity hash|incompatible schema/i.test(blob)) return 'CHECKPOINT_CORRUPT'
  if (/resume fail|resume rejected|checkpoint missing/i.test(blob)) return 'RESUME_FAILURE'
  if (/stale.?memory|contamination/i.test(blob)) return 'STALE_MEMORY_CONTAMINATION'
  if (/temporal conflict|supersession vs contradiction/i.test(blob)) return 'TEMPORAL_CONFLICT'
  if (/restart recovery/i.test(blob)) return 'RESTART_RECOVERY_FAILURE'
  if (/persist|sqlite|transcript/i.test(blob)) return 'PERSISTENCE_FAILURE'
  if (/plan|replan/i.test(blob)) return 'PLAN_FAILURE'
  if (/context packet|token budget/i.test(blob)) return 'CONTEXT_FAILURE'
  return 'UNKNOWN'
}

export function diagnoseFailure(input: FailureDiagnosisInput): FailureDiagnosisResult {
  const started = Date.now()
  const category = classify(input)
  const branches = CAUSE_BRANCHES[input.symptom] ?? []
  const supporting = (input.receipts ?? []).filter(row => !row.success).map(row => row.receipt_id)
  const contradicting = (input.receipts ?? []).filter(row => row.success).map(row => row.receipt_id)
  const eliminated: string[] = []
  const remaining = [...branches]

  const drop = (cause: string, why: boolean) => {
    if (!why) return
    const idx = remaining.indexOf(cause)
    if (idx >= 0) remaining.splice(idx, 1)
    if (!eliminated.includes(cause)) eliminated.push(cause)
  }

  if (category === 'RENDER_FAILURE') {
    drop('server final missing', (input.receipts ?? []).some(row => /aurora|synth/i.test(row.capability) && row.success))
    drop('client parser dropped final', /PAGEERROR|cannot read properties/i.test(input.symptom))
    drop('session stale guard rejected result', !/stale/i.test(input.symptom))
  }
  if (category === 'RETRIEVAL_FAILURE') {
    drop('renderer crashed', true)
    drop('render gate hid message', true)
    drop('server final missing', true)
  }
  if (category === 'SESSION_IDENTITY_FAILURE') {
    drop('server final missing', true)
    drop('renderer crashed', !/crash|PAGEERROR/i.test(input.symptom))
  }
  if (category === 'SYNTHESIS_FAILURE') {
    drop('renderer crashed', true)
    drop('session stale guard rejected result', input.session_identity?.sidebar === input.session_identity?.pane)
  }

  const uniqueRemaining = remaining.length ? remaining : (branches.length && eliminated.length === branches.length ? [] : branches.length ? remaining : [category])
  const uncertain = uniqueRemaining.length !== 1 && supporting.length === 0
  const confidence = uniqueRemaining.length === 1 && supporting.length > 0 ? 'PROVEN' : uncertain ? 'UNCERTAIN' : 'HYPOTHESIS'
  const candidate = uniqueRemaining[0] || category
  const recovery = recoverFromToolFailure({
    tool_name: input.receipts?.find(row => !row.success)?.capability || 'unknown',
    ok: false,
    remaining_ok: contradicting.length,
  })

  let recommendation: FailureDiagnosis['recovery']['recommendation'] = 'stop_honestly'
  if (category === 'TOOL_TIMEOUT' || category === 'TOOL_UNAVAILABLE') recommendation = 'retry'
  else if (category === 'RETRIEVAL_FAILURE' && recovery.alternate) recommendation = 'alternate_tool'
  else if (category === 'PLAN_FAILURE') recommendation = 'replan'
  else if (category === 'AUTHORITY_FAILURE') recommendation = 'request_commander'
  else if (category === 'RENDER_FAILURE' || category === 'SESSION_IDENTITY_FAILURE') recommendation = 'repair_required'
  else if (category === 'BUDGET_EXHAUSTED') recommendation = 'reduce_scope'

  const nextTest = uncertain
    ? (category === 'SYNTHESIS_FAILURE' || /AURORA missing/i.test(input.symptom)
      ? 'capture one existing stream rather than send five new mutating requests'
      : 'inspect one existing receipt/timestamp pair to distinguish remaining causes')
    : 'none required; remaining cause is uniquely supported'

  const diagnosis: FailureDiagnosis = {
    symptom: input.symptom,
    category,
    candidate_cause: candidate,
    supporting_receipts: supporting,
    contradicting_receipts: contradicting,
    confidence_state: confidence,
    next_discriminating_check: nextTest,
    eliminated,
    remaining: uniqueRemaining,
    recovery: { recommendation, grants_authority: false },
    persist_as_proven: confidence === 'PROVEN',
  }

  return {
    diagnosis,
    receipt: createEngineReceipt({
      engine: 'failure-diagnosis',
      mission_id: input.mission_id,
      task_id: input.task_id,
      input_refs: supporting,
      output_refs: [category, confidence],
      started_at: started,
      decision_count: eliminated.length + uniqueRemaining.length,
      decision: confidence,
      failure_state: confidence === 'UNCERTAIN' ? 'uncertain_diagnosis' : 'none',
    }),
  }
}

export function mayPersistFailurePattern(diagnosis: FailureDiagnosis): boolean {
  return diagnosis.persist_as_proven && diagnosis.confidence_state === 'PROVEN' && diagnosis.supporting_receipts.length > 0
}

export function experienceFailureModes(diagnosis: FailureDiagnosis): string[] {
  if (!mayPersistFailurePattern(diagnosis)) return []
  return [`${diagnosis.category}:${diagnosis.candidate_cause}`]
}

/** Speculative diagnoses never enter MissionExperienceRecord as proven fact. */
export function persistProvenFailureExperience(input: {
  diagnosis: FailureDiagnosis
  mission_id: string
}): MissionExperienceRecord | null {
  if (!mayPersistFailurePattern(input.diagnosis)) return null
  return experienceFromMission({
    missionId: input.mission_id,
    missionClass: 'DIAGNOSE',
    strategy: 'DIAGNOSE',
    assembly: ['ORION', 'SENTINEL'],
    tasks: [],
    parallelism: 0,
    models: [],
    tools: [],
    replans: 0,
    conflicts: 0,
    completion: 'FAILED',
    latency_ms: 0,
    evidenceCount: input.diagnosis.supporting_receipts.length,
    verified: 0,
    evaluation: [`proven:${input.diagnosis.category}`],
    corrections: 0,
    failure_modes: experienceFailureModes(input.diagnosis),
  })
}
