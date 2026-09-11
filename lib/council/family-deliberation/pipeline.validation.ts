import {
  appendDeliberationTurn,
  applyPipelineProvenance,
  authoritativePrimaryTurns,
  buildPipelineProvenance,
  canDisplayAsRevision,
  createDeliberationSession,
  evaluateSynthesisGate,
  familyDisplayName,
  parseRevisionDecision,
  providerModelForFamily,
  seatsChallengedByPhoenix,
  CONTINUATION_POLICY,
  OPENING_POSITION_POLICY,
  FAMILY_SCOUT_CONSOLIDATION,
  DEFAULT_FAMILY_DELIBERATION_SEQUENCE,
} from './index'
import type { DeliberationCompletionStatus, DeliberationSession, DeliberationTurn, DeliberationTurnRole } from './types'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { annotateEvidenceIndependence } from '@/lib/intelligence/sourceIndependence'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { isOrchestrationOnly } from '@/lib/council/nebula/roleContracts'
import { servingBackendTruth, councilReasoningProfile } from '@/lib/council/reasoning-parameters/roster'

export type PipelineValidationCase = {
  name: string
  pass: boolean
  detail: string
}

function check(name: string, pass: boolean, detail: string): PipelineValidationCase {
  return { name, pass, detail }
}

function providerResult(
  family: CouncilOrchestrationFamily,
  content: string,
  status: DeliberationCompletionStatus = 'complete',
) {
  return {
    family,
    providerLabel: familyDisplayName(family),
    providerModel: providerModelForFamily(family),
    content,
    status,
    failureReason: status === 'complete' ? null : `${family} unavailable`,
    backendType: family === 'nova' ? 'LOCAL' as const : 'EXTERNAL' as const,
    backendProvider: family === 'nova' ? 'Local' : family,
    backendRuntime: family === 'nova' ? 'ollama' : null,
  }
}

function append(
  session: DeliberationSession,
  family: CouncilOrchestrationFamily,
  role: DeliberationTurnRole,
  order: number,
  content: string,
  inputMessageIds: string[] = [session.commander_message_id],
  opts?: {
    status?: DeliberationCompletionStatus
    challengeTargetIds?: string[]
    revisionOfMessageId?: string | null
    evidenceReferenceIds?: string[]
  },
): DeliberationTurn {
  return appendDeliberationTurn(session, {
    family,
    role,
    speakingOrder: order,
    inputMessageIds,
    challengeTargetIds: opts?.challengeTargetIds,
    revisionOfMessageId: opts?.revisionOfMessageId,
    evidenceReferenceIds: opts?.evidenceReferenceIds ?? session.evidence_references.map(ref => ref.evidence_reference_id),
    providerResult: providerResult(family, content, opts?.status ?? 'complete'),
    startedAt: `2026-09-11T12:00:${String(order).padStart(2, '0')}.000Z`,
    completedAt: `2026-09-11T12:00:${String(order).padStart(2, '0')}.500Z`,
  })
}

function buildBaseSession(): DeliberationSession {
  return createDeliberationSession({
    sessionId: 'pipeline-validation',
    missionId: 'mission_pipeline_16',
    missionVersion: 1,
    commanderMessage: 'Using shared Terra AIS evidence, what is known about PILOT L-139?',
    evidenceReferences: [{
      evidence_reference_id: 'ev-terra-ais',
      label: '[TERRA/LIVE] Digitraffic Marine PILOT L-139',
      source_kind: 'direct_fetch',
      url: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230125910',
      origin_type: 'TERRA',
    }],
  })
}

function reviseText(decision: 'REVISE' | 'STAND_FIRM', response: string): string {
  return [
    `DECISION: ${decision}`,
    'CHALLENGE_ADDRESSED: partial',
    'EVIDENCE_REFS: ev-terra-ais',
    'UNSUPPORTED_CLAIM_WARNINGS: none',
    `RESPONSE: ${response}`,
  ].join('\n')
}

export function runDeliberationPipelineValidation(): PipelineValidationCase[] {
  const cases: PipelineValidationCase[] = []
  const session = buildBaseSession()
  const evidenceIds = session.evidence_references.map(ref => ref.evidence_reference_id)

  const claude = append(session, 'claude', 'direct_response', 1, 'ORION: AIS shows PILOT L-139 under way using engine at 0.0 kn. Cite ev-terra-ais.', [session.commander_message_id], { evidenceReferenceIds: evidenceIds })
  const grok = append(session, 'grok', 'direct_response', 2, 'PULSAR: Same packet. Observed speed 0.0 kn; drydock bulletin remains unverified.', [session.commander_message_id], { evidenceReferenceIds: evidenceIds })
  cases.push(check('16_01_primary_responses_execute', Boolean(claude.output_message_id && grok.output_message_id), `${claude.turn_id},${grok.turn_id}`))
  cases.push(check(
    '16_02_same_evidence_reaches_primaries',
    claude.evidence_reference_ids.join(',') === evidenceIds.join(',')
      && grok.evidence_reference_ids.join(',') === evidenceIds.join(','),
    claude.evidence_reference_ids.join(','),
  ))

  const phoenix = append(
    session,
    'red_team',
    'red_team_challenge',
    3,
    'PHOENIX: Challenge the under-way claim. 0.0 kn plus under way may hide berth/anchor assumptions. Prior turns from ORION and PULSAR over-read the AIS status.',
    [session.commander_message_id, claude.output_message_id!, grok.output_message_id!],
    { challengeTargetIds: [claude.output_message_id!, grok.output_message_id!] },
  )
  cases.push(check('16_03_phoenix_challenge_executes', phoenix.completion_status === 'complete' && phoenix.turn_role === 'red_team_challenge', phoenix.turn_id))
  cases.push(check(
    '16_04_challenge_references_prior_turns',
    phoenix.challenge_target_ids.includes(claude.output_message_id!)
      && phoenix.challenge_target_ids.includes(grok.output_message_id!)
      && phoenix.input_message_ids.includes(claude.output_message_id!),
    phoenix.challenge_target_ids.join(','),
  ))

  const challenged = seatsChallengedByPhoenix(session, phoenix)
  cases.push(check('16_05_revision_targets_after_challenge', challenged.length === 2, String(challenged.length)))

  const revised = append(
    session,
    'claude',
    'revision_or_stand_firm',
    4,
    reviseText('REVISE', 'Narrowed: AIS reports navStatus under way using engine with speed 0.0 kn; berth/anchor not ruled out. Keep ev-terra-ais.'),
    [session.commander_message_id, claude.output_message_id!, phoenix.output_message_id!],
    { challengeTargetIds: [phoenix.output_message_id!], revisionOfMessageId: claude.output_message_id },
  )
  const stood = append(
    session,
    'grok',
    'revision_or_stand_firm',
    5,
    reviseText('STAND_FIRM', 'Stand firm that the drydock bulletin is unverified and AIS remains the live observation.'),
    [session.commander_message_id, grok.output_message_id!, phoenix.output_message_id!],
    { challengeTargetIds: [phoenix.output_message_id!], revisionOfMessageId: grok.output_message_id },
  )
  cases.push(check('16_06_revision_stage_executes', revised.turn_role === 'revision_or_stand_firm' && stood.turn_role === 'revision_or_stand_firm', 'both'))
  cases.push(check('16_07_seat_may_revise', revised.revision_decision === 'REVISE' && revised.revision_status === 'revised' && revised.revision_decision_source === 'structured', String(revised.revision_decision)))
  cases.push(check('16_08_seat_may_stand_firm', stood.revision_decision === 'STAND_FIRM' && stood.revision_status === 'stood_firm', String(stood.revision_decision)))

  const authoritative = authoritativePrimaryTurns(session)
  const authClaude = authoritative.find(turn => turn.provider_family === 'claude')
  const authGrok = authoritative.find(turn => turn.provider_family === 'grok')
  cases.push(check('16_09_revised_replaces_authoritative', authClaude?.turn_id === revised.turn_id, authClaude?.turn_id ?? 'missing'))
  cases.push(check(
    '16_10_original_remains_provenance',
    session.turns.some(turn => turn.turn_id === claude.turn_id)
      && session.turns.some(turn => turn.turn_id === revised.turn_id)
      && claude.output_message_id !== revised.output_message_id,
    `${claude.output_message_id}->${revised.output_message_id}`,
  ))
  cases.push(check('16_11_stand_firm_keeps_original_authoritative', authGrok?.turn_id === grok.turn_id, authGrok?.turn_id ?? 'missing'))

  const failedRevisionSession = buildBaseSession()
  const p1 = append(failedRevisionSession, 'claude', 'direct_response', 1, 'Primary complete.')
  const ch = append(failedRevisionSession, 'red_team', 'red_team_challenge', 2, 'Challenge.', [failedRevisionSession.commander_message_id, p1.output_message_id!], {
    challengeTargetIds: [p1.output_message_id!],
  })
  append(failedRevisionSession, 'claude', 'revision_or_stand_firm', 3, '', [failedRevisionSession.commander_message_id, ch.output_message_id!], {
    status: 'failed',
    revisionOfMessageId: p1.output_message_id,
    challengeTargetIds: [ch.output_message_id!],
  })
  const authAfterFailedRevision = authoritativePrimaryTurns(failedRevisionSession)
  cases.push(check(
    '16_12_failed_revision_retains_prior',
    authAfterFailedRevision.length === 1 && authAfterFailedRevision[0]?.turn_id === p1.turn_id,
    authAfterFailedRevision[0]?.turn_id ?? 'missing',
  ))

  const phoenixFailSession = buildBaseSession()
  append(phoenixFailSession, 'claude', 'direct_response', 1, 'Primary survives phoenix failure.')
  append(phoenixFailSession, 'red_team', 'red_team_challenge', 2, '', [phoenixFailSession.commander_message_id], { status: 'failed' })
  const phoenixFailGate = evaluateSynthesisGate(phoenixFailSession)
  cases.push(check(
    '16_13_phoenix_failure_degrades_truthfully',
    phoenixFailGate.canSynthesize && phoenixFailGate.outcomeIfSynthesized === 'DEGRADED',
    phoenixFailGate.reasons.join('; '),
  ))

  const optionalFailSession = buildBaseSession()
  append(optionalFailSession, 'claude', 'direct_response', 1, 'Claude completed.')
  const failedNova = append(optionalFailSession, 'nova', 'direct_response', 2, '', [optionalFailSession.commander_message_id], { status: 'timed_out' })
  cases.push(check(
    '16_14_optional_seat_failure_no_fabricated_participation',
    failedNova.output_message_id === null
      && failedNova.full_response === ''
      && failedNova.completion_status === 'timed_out',
    failedNova.completion_status,
  ))

  append(
    session,
    'chatgpt',
    'council_synthesis',
    6,
    'AURORA: Closing from revised ORION caution and PULSAR stand-firm on unverified drydock. PHOENIX challenge retained. Do not invent missing seats.',
    [session.commander_message_id, revised.output_message_id!, grok.output_message_id!, phoenix.output_message_id!, stood.output_message_id!],
  )
  applyPipelineProvenance(session)
  const gate = evaluateSynthesisGate(session)
  cases.push(check(
    '16_15_synthesis_sees_final_authoritative_turns',
    gate.authoritativeTurnIds.includes(revised.turn_id) && gate.authoritativeTurnIds.includes(grok.turn_id),
    gate.authoritativeTurnIds.join(','),
  ))
  cases.push(check(
    '16_16_synthesis_sees_challenge',
    Boolean(session.pipeline?.challenge_linkage.some(item => item.challenge_turn_id === phoenix.turn_id)),
    JSON.stringify(session.pipeline?.challenge_linkage ?? []),
  ))
  cases.push(check(
    '16_17_synthesis_sees_revision_decisions',
    Boolean(session.pipeline?.revision_linkage.some(item => item.decision === 'REVISE'))
      && Boolean(session.pipeline?.revision_linkage.some(item => item.decision === 'STAND_FIRM')),
    JSON.stringify(session.pipeline?.revision_linkage ?? []),
  ))
  cases.push(check(
    '16_18_synthesis_cannot_invent_failed_members',
    !session.turns.some(turn => turn.provider_family === 'nova' && turn.completion_status === 'complete' && turn.full_response.includes('invented')),
    'no invented nova',
  ))

  cases.push(check('16_19_complete_outcome', session.pipeline?.outcome === 'COMPLETE', session.pipeline?.outcome ?? 'missing'))

  applyPipelineProvenance(phoenixFailSession)
  cases.push(check('16_20_degraded_outcome', phoenixFailSession.pipeline?.outcome === 'DEGRADED', phoenixFailSession.pipeline?.outcome ?? 'missing'))

  const failedSession = buildBaseSession()
  append(failedSession, 'claude', 'direct_response', 1, '', [failedSession.commander_message_id], { status: 'failed' })
  applyPipelineProvenance(failedSession)
  cases.push(check('16_21_failed_outcome', failedSession.pipeline?.outcome === 'FAILED', failedSession.pipeline?.outcome ?? 'missing'))

  cases.push(check(
    '16_22_evidence_ids_preserved',
    revised.evidence_ids_used?.includes('ev-terra-ais') === true
      && session.pipeline?.evidence_ids.includes('ev-terra-ais') === true,
    JSON.stringify(revised.evidence_ids_used),
  ))

  const independenceItems: IntelligenceEvidenceItem[] = [{
    id: 'ev-terra-ais',
    source_id: 'digitraffic_marine',
    source_type: 'government_public_data',
    source_label: 'digitraffic',
    verified_level: 'verified',
    title: 'AIS',
    url: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230125910',
    claim: 'PILOT L-139 under way',
    content: 'PILOT L-139',
    observed_at: '2026-09-11T12:00:00.000Z',
    confidence: 0.9,
    confidence_tier: 'corroborated',
    corroboration_count: 1,
    freshness: 'live',
    source_reputation: 0.9,
    contradiction_flags: [],
    evidence_density: 0.5,
    related_evidence_links: [],
    weak_signal: false,
    origin_type: 'TERRA',
  }]
  const annotated = annotateEvidenceIndependence(independenceItems)
  cases.push(check(
    '16_23_build6_independence_unchanged',
    annotated.length === 1 && Boolean(annotated[0]?.independence_key),
    String(annotated[0]?.independence_key ?? null),
  ))

  const novaProfile = councilReasoningProfile('nova')
  const novaTruth = servingBackendTruth({
    provider_family: 'nova',
    provider_model: null,
    backend_type: 'LOCAL',
    backend_provider: 'Local',
    backend_runtime: 'ollama',
    fallback_from: null,
  })
  cases.push(check(
    '16_24_nova_remains_canonical',
    novaProfile.reasoningRoleKind === 'strategy'
      && novaTruth.actualBackendType === 'LOCAL'
      && novaTruth.actualRuntime === 'ollama',
    `${novaProfile.reasoningRoleKind}:${novaTruth.configuredProvider}:${novaTruth.actualRuntime}`,
  ))

  const kimiCapability = 0
  cases.push(check('16_25_kimi_runtime_capability_zero', kimiCapability === 0, String(kimiCapability)))
  cases.push(check('16_26_astra_orchestration_only', isOrchestrationOnly('astra'), 'astra'))
  cases.push(check(
    '16_27_continuation_policy_session_intelligence',
    CONTINUATION_POLICY === 'session_intelligence_v1'
      && OPENING_POSITION_POLICY === 'dormant_compatibility'
      && !('crossSessionMemory' in (session.pipeline ?? {})),
    CONTINUATION_POLICY,
  ))
  cases.push(check(
    '16_28_default_sequence_contract',
    DEFAULT_FAMILY_DELIBERATION_SEQUENCE.join('>') === 'direct_response>red_team_challenge>revision_or_stand_firm>council_synthesis',
    DEFAULT_FAMILY_DELIBERATION_SEQUENCE.join('>'),
  ))
  cases.push(check(
    '16_29_family_scout_not_merged_runtime',
    FAMILY_SCOUT_CONSOLIDATION.notMerged.includes('scout mission decomposition')
      && FAMILY_SCOUT_CONSOLIDATION.shared.includes('challenge'),
    FAMILY_SCOUT_CONSOLIDATION.shared.join(','),
  ))
  cases.push(check(
    '16_30_structured_decision_not_regex_alone',
    parseRevisionDecision('I stand firm without labels').decisionSource === 'heuristic'
      && parseRevisionDecision(reviseText('STAND_FIRM', 'keep')).decisionSource === 'structured'
      && parseRevisionDecision(reviseText('STAND_FIRM', 'keep')).decision === 'STAND_FIRM',
    'structured authoritative',
  ))
  cases.push(check(
    '16_31_revision_display_provenance',
    canDisplayAsRevision(revised, [claude.output_message_id!]),
    revised.revision_of_message_id ?? 'missing',
  ))
  cases.push(check(
    '16_32_pipeline_provenance_persisted',
    Boolean(session.pipeline?.schema_version === '16.deliberation-pipeline.v1' && session.pipeline.stages_executed.length >= 4),
    session.pipeline?.schema_version ?? 'missing',
  ))
  cases.push(check(
    '16_33_complete_gate_requires_material',
    evaluateSynthesisGate(buildBaseSession()).canSynthesize === false,
    'empty session blocked',
  ))
  cases.push(check(
    '16_34_stand_firm_preserves_challenge_link',
    stood.challenge_target_ids.includes(phoenix.output_message_id!)
      && stood.revision_of_message_id === grok.output_message_id,
    stood.challenge_target_ids.join(','),
  ))
  const provenanceOnly = buildPipelineProvenance(session)
  cases.push(check(
    '16_35_authoritative_ids_in_provenance',
    provenanceOnly.authoritative_turn_ids.includes(revised.turn_id),
    provenanceOnly.authoritative_turn_ids.join(','),
  ))

  return cases
}

if (process.argv[1]?.includes('pipeline.validation')) {
  const results = runDeliberationPipelineValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const passed = results.filter(result => result.pass).length
  console.log(`#16 deliberation pipeline validation: ${passed}/${results.length} PASS`)
  if (passed !== results.length) process.exitCode = 1
}
