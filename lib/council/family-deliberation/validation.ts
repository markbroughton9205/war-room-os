import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  appendDeliberationTurn,
  buildDeliberationPrompt,
  canDisplayAsResponse,
  canDisplayAsRevision,
  canSynthesize,
  canDisplayAsChallenge,
  createDeliberationSession,
  evidenceReferencesFromLiveResearch,
  familyDisplayName,
  formatDeliberationTurnForChat,
  outputMessageIdForTurn,
  providerModelForFamily,
} from './runtime'
import { createDeliberationProgressRecorder } from './progress'
import { createCouncilProgressRuntimeTracker } from '@/lib/council/progress-events/runtime'
import type { DeliberationCompletionStatus, DeliberationSession, DeliberationTurn, DeliberationTurnRole } from './types'
import type { LiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'

export type FamilyDeliberationValidationCase = {
  caseId: string
  description: string
  expected: 'valid' | 'invalid'
  observed: 'valid' | 'invalid'
  result: 'PASS' | 'FAIL'
  details: string[]
}

function caseResult(
  caseId: string,
  description: string,
  expected: 'valid' | 'invalid',
  ok: boolean,
  details: string[] = [],
): FamilyDeliberationValidationCase {
  const observed = ok ? 'valid' : 'invalid'
  return {
    caseId,
    description,
    expected,
    observed,
    result: observed === expected ? 'PASS' : 'FAIL',
    details,
  }
}

function providerResult(family: CouncilOrchestrationFamily, content: string, status: DeliberationCompletionStatus = 'complete') {
  return {
    family,
    providerLabel: familyDisplayName(family),
    providerModel: providerModelForFamily(family),
    content,
    status,
    failureReason: status === 'complete' ? null : `${family} unavailable`,
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
    evidenceReferenceIds: opts?.evidenceReferenceIds,
    providerResult: providerResult(family, content, opts?.status ?? 'complete'),
    startedAt: `2026-07-19T00:00:0${order}.000Z`,
    completedAt: `2026-07-19T00:00:0${order}.500Z`,
  })
}

function buildCompleteSession() {
  const evidencePacket: LiveResearchEvidencePacket = {
    usedLiveResearch: true,
    generatedAt: '2026-07-19T00:00:00.000Z',
    sources: [{
      kind: 'tavily',
      ok: true,
      queriedAt: '2026-07-19T00:00:00.000Z',
      urls: ['https://example.com/real-source'],
    }],
    findings: 'Source-backed finding from actual evidence pipeline.',
    confidence: 0.8,
    freshness: 'recent',
    contradictions: [],
    unresolvedQuestions: [],
  }
  const evidence = evidenceReferencesFromLiveResearch(evidencePacket)
  const session = createDeliberationSession({
    sessionId: 'validation-session',
    missionId: 'mission_validation',
    missionVersion: 1,
    commanderMessage: 'How should the Council handle this?',
    evidenceReferences: evidence,
  })
  const a = append(session, 'chatgpt', 'opening_position', 1, 'ChatGPT opening position. This is a full paragraph with usable reasoning and a recommendation.', [session.commander_message_id], { evidenceReferenceIds: evidence.map(ref => ref.evidence_reference_id) })
  const b = append(session, 'claude', 'direct_response', 2, 'Claude responds directly to ChatGPT. It agrees with the direction but adds implementation constraints.', [session.commander_message_id, a.output_message_id!])
  const red = append(session, 'red_team', 'red_team_challenge', 3, 'Red Team challenges both prior messages and asks for proof of assumptions.', [session.commander_message_id, a.output_message_id!, b.output_message_id!], {
    challengeTargetIds: [a.output_message_id!, b.output_message_id!],
  })
  const revision = append(session, 'chatgpt', 'revision_or_stand_firm', 4, 'ChatGPT revises its original position after Red Team challenge and narrows the recommendation.', [session.commander_message_id, red.output_message_id!], {
    challengeTargetIds: [red.output_message_id!],
    revisionOfMessageId: a.output_message_id,
  })
  const synthesis = append(session, 'chatgpt', 'council_synthesis', 5, 'Final Council synthesis based on the completed exchange only.', [session.commander_message_id, a.output_message_id!, b.output_message_id!, red.output_message_id!, revision.output_message_id!])
  return { session, evidence, a, b, red, revision, synthesis }
}

function makeProgressTracker(seed = 'validation-family-deliberation') {
  const tracker = createCouncilProgressRuntimeTracker({
    requestIdSeed: seed,
    commanderTurnRef: 'family-deliberation-validation',
    flowMode: 'stable_group',
    executionStrategy: 'server_sequential_streaming_future',
    expectedFamilies: ['chatgpt', 'claude', 'red_team'],
    selectedFamilies: ['chatgpt', 'claude', 'red_team'],
    selectionAuthority: 'system_selected',
    createdAt: '2026-07-19T02:00:00.000Z',
  })
  tracker.record({ eventType: 'request_created', source: 'server_orchestrator', occurredAt: '2026-07-19T02:00:01.000Z' })
  tracker.record({
    eventType: 'request_selection_resolved',
    source: 'server_orchestrator',
    occurredAt: '2026-07-19T02:00:02.000Z',
    payload: { selectedFamilies: ['chatgpt', 'claude', 'red_team'], expectedFamilies: ['chatgpt', 'claude', 'red_team'] },
  })
  tracker.record({ eventType: 'request_started', source: 'server_orchestrator', occurredAt: '2026-07-19T02:00:03.000Z' })
  return tracker
}

function buildTrackedCompleteSession() {
  const { session, a, b, red, revision } = buildCompleteSession()
  const tracker = makeProgressTracker('validation-family-deliberation-complete')
  const progress = createDeliberationProgressRecorder(tracker)
  progress.recordTurnStarted('chatgpt', 'opening_position', [])
  progress.recordTurnCompleted(a)
  progress.recordTurnStarted('claude', 'direct_response', [a])
  progress.recordTurnCompleted(b, { finalFamilyTurn: true })
  progress.recordTurnStarted('red_team', 'red_team_challenge', [a, b])
  progress.recordTurnCompleted(red, { finalFamilyTurn: true })
  progress.recordTurnStarted('chatgpt', 'revision_or_stand_firm', [red])
  progress.recordTurnCompleted(revision, { finalFamilyTurn: true })
  const close = progress.closeIfTerminal()
  return { session, tracker, close }
}

function buildTrackedPartialSession() {
  const tracker = makeProgressTracker('validation-family-deliberation-partial')
  const progress = createDeliberationProgressRecorder(tracker)
  const session = createDeliberationSession({
    sessionId: 'partial-progress',
    missionId: 'mission_validation',
    missionVersion: 1,
    commanderMessage: 'Partial progress',
  })
  const a = append(session, 'chatgpt', 'opening_position', 1, 'ChatGPT opening succeeds with usable content.')
  progress.recordTurnStarted('chatgpt', 'opening_position', [])
  progress.recordTurnCompleted(a)
  const b = append(session, 'claude', 'direct_response', 2, '', [session.commander_message_id, a.output_message_id!], { status: 'failed' })
  progress.recordTurnStarted('claude', 'direct_response', [a])
  progress.recordTurnCompleted(b, { finalFamilyTurn: true })
  progress.recordFamilyNotReached('red_team', 'claude_failed_before_red_team')
  progress.recordTurnCompleted(a, { finalFamilyTurn: true })
  const close = progress.closeIfTerminal()
  return { session, tracker, close }
}

function buildTrackedFailureSession() {
  const tracker = makeProgressTracker('validation-family-deliberation-failure')
  const progress = createDeliberationProgressRecorder(tracker)
  const session = createDeliberationSession({
    sessionId: 'failure-progress',
    missionId: 'mission_validation',
    missionVersion: 1,
    commanderMessage: 'Failure progress',
  })
  const a = append(session, 'chatgpt', 'opening_position', 1, '', [session.commander_message_id], { status: 'failed' })
  progress.recordTurnStarted('chatgpt', 'opening_position', [])
  progress.recordTurnCompleted(a, { finalFamilyTurn: true })
  progress.recordFamilyNotReached('claude', 'opening_failed')
  progress.recordFamilyNotReached('red_team', 'opening_failed')
  const close = progress.closeIfTerminal()
  return { session, tracker, close }
}

function buildTrackedTimeoutOnlySession() {
  const tracker = makeProgressTracker('validation-family-deliberation-timeout')
  const progress = createDeliberationProgressRecorder(tracker)
  const session = createDeliberationSession({
    sessionId: 'timeout-progress',
    missionId: 'mission_validation',
    missionVersion: 1,
    commanderMessage: 'Timeout progress',
  })
  for (const [index, family] of (['chatgpt', 'claude', 'red_team'] as const).entries()) {
    const turn = append(
      session,
      family,
      family === 'chatgpt' ? 'opening_position' : family === 'claude' ? 'direct_response' : 'red_team_challenge',
      index + 1,
      '',
      [session.commander_message_id],
      { status: 'timed_out' },
    )
    progress.recordTurnStarted(family, turn.turn_role, [])
    progress.recordTurnCompleted(turn, { finalFamilyTurn: true })
  }
  const close = progress.closeIfTerminal()
  return { session, tracker, close }
}

export function runFamilyDeliberationValidation(): FamilyDeliberationValidationCase[] {
  const { session, evidence, a, b, red, revision, synthesis } = buildCompleteSession()
  const originalAndRevisionStored = Boolean(
    session.turns.find(turn => turn.output_message_id === a.output_message_id)
    && session.turns.find(turn => turn.output_message_id === revision.output_message_id)
    && a.output_message_id !== revision.output_message_id,
  )

  const independent = createDeliberationSession({
    missionId: 'mission_validation',
    missionVersion: 1,
    commanderMessage: 'Independent test',
  })
  const independentA = append(independent, 'chatgpt', 'opening_position', 1, 'A independent output.')
  const independentB = append(independent, 'claude', 'direct_response', 2, 'B independent output without A input.', [independent.commander_message_id])
  const invalidRevision = append(independent, 'chatgpt', 'revision_or_stand_firm', 3, 'A bad revision claim without causal Red Team input.', [independent.commander_message_id], {
    revisionOfMessageId: independentA.output_message_id,
  })
  const invalidChallenge = append(independent, 'red_team', 'red_team_challenge', 4, 'A bad challenge without target linkage.', [independent.commander_message_id], {
    challengeTargetIds: [independentA.output_message_id!],
  })

  const failed = createDeliberationSession({
    missionId: 'mission_validation',
    missionVersion: 1,
    commanderMessage: 'Failure test',
  })
  const failedTurn = append(failed, 'claude', 'opening_position', 1, '', [failed.commander_message_id], { status: 'failed' })

  const noSynthesis = createDeliberationSession({
    missionId: 'mission_validation',
    missionVersion: 1,
    commanderMessage: 'Wait test',
  })
  append(noSynthesis, 'chatgpt', 'opening_position', 1, 'Only first response complete.')

  const fullParagraph = 'First paragraph with enough content to preserve. Second sentence remains in storage.\n\nSecond paragraph remains intact and should not be truncated by the deliberation record.'
  const paragraphSession = createDeliberationSession({
    missionId: 'mission_validation',
    missionVersion: 1,
    commanderMessage: 'Paragraph test',
  })
  const paragraphTurn = append(paragraphSession, 'chatgpt', 'opening_position', 1, fullParagraph)
  const rendered = formatDeliberationTurnForChat(a, evidence)
  const promptForB = buildDeliberationPrompt({
    role: 'direct_response',
    commanderMessage: session.commander_message,
    evidenceReferences: evidence,
    priorTurns: [a],
  })
  const promptForRed = buildDeliberationPrompt({
    role: 'red_team_challenge',
    commanderMessage: session.commander_message,
    evidenceReferences: evidence,
    priorTurns: [a, b],
  })
  const promptForRevision = buildDeliberationPrompt({
    role: 'revision_or_stand_firm',
    commanderMessage: session.commander_message,
    evidenceReferences: evidence,
    priorTurns: [a, b, red],
    targetTurn: a,
  })
  const trackedComplete = buildTrackedCompleteSession()
  const trackedPartial = buildTrackedPartialSession()
  const trackedFailure = buildTrackedFailureSession()
  const trackedTimeout = buildTrackedTimeoutOnlySession()
  const completeSnapshot = trackedComplete.tracker.snapshot()
  const partialSnapshot = trackedPartial.tracker.snapshot()
  const failureSnapshot = trackedFailure.tracker.snapshot()
  const timeoutSnapshot = trackedTimeout.tracker.snapshot()
  const completeFamiliesByOutcome = new Map(
    completeSnapshot.state.familyExecutions.map(record => [record.family, record.outcome]),
  )
  const partialFamiliesByOutcome = new Map(
    partialSnapshot.state.familyExecutions.map(record => [record.family, record.outcome]),
  )

  return [
    caseResult('deliberation_01_family_b_receives_a_id_and_content', 'Family B receives Family A message ID and content.', 'valid', Boolean(b.input_message_ids.includes(a.output_message_id!) && promptForB.includes(a.output_message_id!) && promptForB.includes(a.full_response))),
    caseResult('deliberation_02_red_team_receives_both_prior_messages', 'Red Team receives both prior family messages.', 'valid', Boolean(red.input_message_ids.includes(a.output_message_id!) && red.input_message_ids.includes(b.output_message_id!) && promptForRed.includes(a.full_response) && promptForRed.includes(b.full_response))),
    caseResult('deliberation_03_revision_receives_targeted_challenge', 'Revision receives the targeted challenge.', 'valid', Boolean(revision.input_message_ids.includes(red.output_message_id!) && revision.challenge_target_ids.includes(red.output_message_id!) && promptForRevision.includes(red.full_response))),
    caseResult('deliberation_04_original_and_revised_positions_stored', 'Original and revised positions are both stored separately.', 'valid', originalAndRevisionStored),
    caseResult('deliberation_05_independent_message_not_renderable_as_response', 'UI cannot label independent message as response without input provenance.', 'invalid', canDisplayAsResponse(independentB, independentA.output_message_id!)),
    caseResult('deliberation_06_revision_requires_revision_provenance', 'UI cannot label a message as revised without revision provenance.', 'invalid', canDisplayAsRevision(invalidRevision, [independentA.output_message_id!].filter(Boolean))),
    caseResult('deliberation_07_synthesis_waits_for_required_terminal_turns', 'Synthesis waits for all required turns to become terminal.', 'invalid', canSynthesize(noSynthesis, ['opening_position', 'direct_response', 'red_team_challenge', 'revision_or_stand_firm'])),
    caseResult('deliberation_08_provider_failure_no_fabricated_dialogue', 'Provider failure does not create fabricated dialogue.', 'valid', failedTurn.completion_status === 'failed' && failedTurn.output_message_id === null && failedTurn.full_response === ''),
    caseResult('deliberation_09_parallel_outputs_not_sequential_debate', 'Independent parallel outputs cannot be rendered as sequential debate.', 'invalid', canDisplayAsResponse(independentB, outputMessageIdForTurn(independentA.turn_id))),
    caseResult('deliberation_10_source_links_map_to_real_evidence', 'Source links map to real evidence references only.', 'valid', a.evidence_reference_ids.every(id => evidence.some(ref => ref.evidence_reference_id === id && ref.url?.startsWith('https://')))),
    caseResult('deliberation_11_full_paragraph_preserved', 'Full paragraph response is preserved without truncation in storage.', 'valid', paragraphTurn.full_response === fullParagraph),
    caseResult('deliberation_12_diagnostics_do_not_replace_conversation', 'Formatted primary message contains family conversation, not raw diagnostics.', 'valid', rendered.includes('Provider: ChatGPT') && rendered.includes('Executive position:') && !rendered.includes('raw provider log')),
    caseResult('deliberation_13_synthesis_after_required_terminal', 'Synthesis may be generated after required prior turns are terminal.', 'valid', canSynthesize(session, ['opening_position', 'direct_response', 'red_team_challenge', 'revision_or_stand_firm']) && synthesis.completion_status === 'complete'),
    caseResult('deliberation_14_real_turns_emit_lifecycle_events', 'Every lifecycle-accounted deliberation family emits queued/dispatched/started/terminal events.', 'valid', ['chatgpt', 'claude', 'red_team'].every(family => {
      const familyEvents = completeSnapshot.events.filter(event => event.family === family)
      return familyEvents.some(event => event.eventType === 'family_queued')
        && familyEvents.some(event => event.eventType === 'family_dispatched')
        && familyEvents.some(event => event.eventType === 'family_response_started')
        && familyEvents.some(event => ['family_response_completed', 'family_failed', 'family_timed_out', 'family_not_reached'].includes(event.eventType))
    })),
    caseResult('deliberation_15_successful_deliberation_closes_completed', 'Successful deliberation closes request_completed.', 'valid', Boolean(trackedComplete.close?.ok && completeSnapshot.status === 'closed' && completeSnapshot.events.at(-1)?.eventType === 'request_completed')),
    caseResult('deliberation_16_partial_success_closes_completed', 'Terminal partial success closes request_completed when at least one usable response exists.', 'valid', Boolean(trackedPartial.close?.ok && partialSnapshot.status === 'closed' && partialSnapshot.events.at(-1)?.eventType === 'request_completed')),
    caseResult('deliberation_17_complete_failure_closes_failed', 'Complete failure closes request_failed.', 'valid', Boolean(trackedFailure.close?.ok && failureSnapshot.status === 'closed' && failureSnapshot.events.at(-1)?.eventType === 'request_failed')),
    caseResult('deliberation_18_timeout_only_closes_timed_out', 'Timeout-only terminal state closes request_timed_out.', 'valid', Boolean(trackedTimeout.close?.ok && timeoutSnapshot.status === 'closed' && timeoutSnapshot.events.at(-1)?.eventType === 'request_timed_out')),
    caseResult('deliberation_19_blocked_remaining_turns_not_reached', 'Remaining selected families become not_reached after an earlier blocking failure.', 'valid', partialFamiliesByOutcome.get('red_team') === 'not_reached'),
    caseResult('deliberation_20_progress_not_left_waiting', 'Progress tracker does not leave selected families waiting after branch completion.', 'valid', completeSnapshot.state.completionSummary.missingTerminalFamilies.length === 0 && partialSnapshot.state.completionSummary.missingTerminalFamilies.length === 0),
    caseResult('deliberation_21_tracker_matches_session_terminal_outcomes', 'Tracker family states match deliberation terminal outcomes for selected families.', 'valid', completeFamiliesByOutcome.get('chatgpt') === 'complete' && completeFamiliesByOutcome.get('claude') === 'complete' && completeFamiliesByOutcome.get('red_team') === 'complete'),
    caseResult('deliberation_22_response_label_requires_matching_input', 'A response label cannot render without matching input_message_ids.', 'invalid', canDisplayAsResponse(independentB, independentA.output_message_id!)),
    caseResult('deliberation_23_challenge_label_requires_valid_targets', 'A challenge label cannot render unless challenge targets are valid inputs.', 'invalid', canDisplayAsChallenge(invalidChallenge, [independentA.output_message_id!].filter(Boolean))),
    caseResult('deliberation_24_invalid_relationship_does_not_fabricate_debate', 'Invalid relationship metadata does not create output message content by itself.', 'valid', invalidChallenge.full_response.includes('bad challenge') && !canDisplayAsChallenge(invalidChallenge, [independentA.output_message_id!].filter(Boolean))),
    caseResult('deliberation_25_revision_provenance_branch_exercised', 'deliberation_06 reaches actual revision provenance comparison branch.', 'valid', invalidRevision.turn_role === 'revision_or_stand_firm' && Boolean(invalidRevision.revision_of_message_id) && !invalidRevision.input_message_ids.includes(independentA.output_message_id!)),
  ]
}

export function runFamilyDeliberationProgressProbe() {
  const tracked = buildTrackedCompleteSession()
  const snapshot = tracked.tracker.snapshot()
  return {
    requestStatus: snapshot.status,
    closeEventType: snapshot.events.at(-1)?.eventType ?? null,
    missingTerminalFamilies: snapshot.state.completionSummary.missingTerminalFamilies,
    familyStates: snapshot.state.familyExecutions.map(record => ({
      family: record.family,
      lifecycle: record.lifecycle,
      outcome: record.outcome,
      priorResponseLineageCount: record.priorResponseLineage.length,
      respondingToFamilyExecutionIds: record.respondingToFamilyExecutionIds,
    })),
    sessionTurns: tracked.session.turns.map(turn => ({
      role: turn.turn_role,
      family: turn.provider_family,
      status: turn.completion_status,
      outputMessageId: turn.output_message_id,
      inputMessageIds: turn.input_message_ids,
      challengeTargetIds: turn.challenge_target_ids,
      revisionOfMessageId: turn.revision_of_message_id,
    })),
  }
}

if (process.argv[1]?.endsWith('validation.ts')) {
  const results = runFamilyDeliberationValidation()
  for (const result of results) {
    console.log(`${result.result} ${result.caseId}: ${result.description} (${result.observed})`)
    if (result.result === 'FAIL') {
      for (const detail of result.details) console.log(`  ${detail}`)
    }
  }
  const passed = results.filter(result => result.result === 'PASS').length
  console.log(`Family deliberation validation: ${passed}/${results.length} PASS`)
  if (passed !== results.length) process.exitCode = 1
}
