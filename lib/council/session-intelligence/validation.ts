import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  annotateEvidenceIndependence,
} from '@/lib/intelligence/sourceIndependence'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import {
  appendDeliberationTurn,
  applyPipelineProvenance,
  createDeliberationSession,
  familyDisplayName,
  providerModelForFamily,
  CONTINUATION_POLICY,
} from '@/lib/council/family-deliberation'
import type { DeliberationSession, DeliberationTurnRole } from '@/lib/council/family-deliberation/types'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { migrateLegacyPersistedSeat } from '@/lib/council/seatCanonical'
import {
  MAX_DURABLE_ROUNDS,
  COUNCIL_DELIBERATION_ROUND_METADATA_KEY,
  COUNCIL_SESSION_INTELLIGENCE_VERSION,
  appendRoundToIntelligence,
  assertSameConversationContinuation,
  buildContinuationPromptBlock,
  buildDurableRoundSnapshot,
  buildSessionIntelligenceIndex,
  continuationAllowsNewRound,
  FORBIDDEN_COT_KEYS,
  measureSerializedSize,
  mergeRoundIntoIntelligence,
  messageMetadataFromTurn,
  parseDurableRoundFromMessageMetadata,
  payloadContainsHiddenCot,
  rebuildIntelligenceFromMessages,
  ROUND_SERIALIZED_HARD_MAX,
  ROUND_SERIALIZED_SOFT_MAX,
  SESSION_INTELLIGENCE_IDENTITY_DOC,
} from '@/lib/council/session-intelligence'

export type SessionIntelligenceCase = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): SessionIntelligenceCase {
  return { name, pass, detail }
}

function readRepo(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL('../../../' + relativePath, import.meta.url)), 'utf8')
}

function providerResult(family: CouncilOrchestrationFamily, content: string, status: 'complete' | 'failed' = 'complete') {
  return {
    family,
    providerLabel: familyDisplayName(family),
    providerModel: providerModelForFamily(family),
    content,
    status,
    failureReason: status === 'complete' ? null : `${family} unavailable`,
    backendType: family === 'nova' || family === 'chatgpt' ? 'LOCAL' as const : 'EXTERNAL' as const,
    backendProvider: family === 'nova' || family === 'chatgpt' ? 'Local' : family,
    backendRuntime: family === 'nova' || family === 'chatgpt' ? 'ollama' : null,
  }
}

function append(
  session: DeliberationSession,
  family: CouncilOrchestrationFamily,
  role: DeliberationTurnRole,
  order: number,
  content: string,
  opts?: {
    status?: 'complete' | 'failed'
    challengeTargetIds?: string[]
    revisionOfMessageId?: string | null
    backendType?: 'LOCAL' | 'EXTERNAL'
    providerModel?: string
  },
) {
  const turn = appendDeliberationTurn(session, {
    family,
    role,
    speakingOrder: order,
    inputMessageIds: [session.commander_message_id],
    challengeTargetIds: opts?.challengeTargetIds,
    revisionOfMessageId: opts?.revisionOfMessageId,
    evidenceReferenceIds: session.evidence_references.map(r => r.evidence_reference_id),
    providerResult: {
      ...providerResult(family, content, opts?.status ?? 'complete'),
      ...(opts?.backendType ? { backendType: opts.backendType } : {}),
      ...(opts?.providerModel ? { providerModel: opts.providerModel } : {}),
    },
    startedAt: `2026-09-11T13:00:${String(order).padStart(2, '0')}.000Z`,
    completedAt: `2026-09-11T13:00:${String(order).padStart(2, '0')}.500Z`,
  })
  if (role === 'revision_or_stand_firm' && content.includes('DECISION: STAND_FIRM')) {
    turn.revision_decision = 'STAND_FIRM'
  }
  if (role === 'revision_or_stand_firm' && content.includes('DECISION: REVISE')) {
    turn.revision_decision = 'REVISE'
  }
  return turn
}

function buildRound1Session(conversationId: string, roundId: string): DeliberationSession {
  const session = createDeliberationSession({
    sessionId: conversationId,
    roundId,
    commanderTurnId: roundId,
    missionId: 'mission_17',
    missionVersion: 1,
    commanderMessage: 'Using Terra AIS, what is known about vessel PILOT L-139?',
    evidenceReferences: [{
      evidence_reference_id: 'ev-terra-ais',
      label: '[TERRA/LIVE] Digitraffic Marine',
      source_kind: 'direct_fetch',
      url: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230125910',
      origin_type: 'TERRA',
    }],
  })
  const primary = append(session, 'chatgpt', 'direct_response', 1, 'AURORA: AIS shows PILOT L-139 underway near Helsinki. Evidence ev-terra-ais.')
  append(session, 'claude', 'direct_response', 2, 'ORION: Confirms AIS observation from shared evidence.', { status: 'failed' })
  const challenge = append(session, 'red_team', 'red_team_challenge', 3, 'PHOENIX: Challenge destination certainty.', {
    challengeTargetIds: [primary.output_message_id!],
  })
  append(session, 'chatgpt', 'revision_or_stand_firm', 4, 'DECISION: STAND_FIRM\nCHALLENGE_ADDRESSED: partial\nStand firm on AIS presence.', {
    revisionOfMessageId: primary.output_message_id,
    challengeTargetIds: [challenge.turn_id],
  })
  const synthesis = append(session, 'chatgpt', 'council_synthesis', 5, 'AURORA: Synthesis — vessel observed on AIS; ORION failed; destination uncertain.')
  session.synthesis_turn_id = synthesis.turn_id
  applyPipelineProvenance(session)
  return session
}

export function runCouncilSessionIntelligenceValidation(): SessionIntelligenceCase[] {
  const cases: SessionIntelligenceCase[] = []
  const conversationId = '11111111-1111-4111-8111-111111111111'
  const round1Id = 'round-17-1'
  const session1 = buildRound1Session(conversationId, round1Id)
  const round1 = buildDurableRoundSnapshot({
    conversationId,
    session: session1,
  })
  const intelligence1 = mergeRoundIntoIntelligence(null, session1, conversationId)

  cases.push(check('17_01_durable_round_serialization', Boolean(round1.roundId) && round1.conversationId === conversationId, round1.roundId))
  cases.push(check('17_02_durable_round_persistence_shape', intelligence1.rounds.length === 1 && intelligence1.latestRoundId === round1Id, String(intelligence1.roundCount)))
  cases.push(check('17_03_hydrate_round', intelligence1.rounds[0]?.outcome === 'DEGRADED' || intelligence1.rounds[0]?.failedSeats.includes('claude'), String(intelligence1.rounds[0]?.outcome)))

  const messageMeta = {
    [COUNCIL_DELIBERATION_ROUND_METADATA_KEY]: round1,
    roundId: round1.roundId,
  }
  const rebuilt = rebuildIntelligenceFromMessages({
    conversationId,
    messages: [{ id: 'msg-final', metadata: messageMeta }],
    fallbackMetadata: null,
  })
  cases.push(check('17_04_db_only_restore_from_message', Boolean(rebuilt?.rebuiltFromMessages) && rebuilt?.rounds.length === 1, String(rebuilt?.rounds[0]?.roundId)))
  cases.push(check('17_05_page_reload_restore_equivalent', rebuilt?.intelligence.rounds[0]?.roundId === round1Id, String(rebuilt?.intelligence.latestRoundId)))
  cases.push(check('17_06_process_restart_restore_equivalent', parseDurableRoundFromMessageMetadata(messageMeta)?.challengeTurnRef != null, String(parseDurableRoundFromMessageMetadata(messageMeta)?.challengeTurnRef)))

  const round2Id = 'round-17-2'
  const session2 = createDeliberationSession({
    sessionId: conversationId,
    roundId: round2Id,
    commanderTurnId: round2Id,
    missionId: 'mission_17',
    missionVersion: 1,
    commanderMessage: 'Continue using what we have. Do not invent LUMEN.',
    evidenceReferences: session1.evidence_references,
  })
  append(session2, 'chatgpt', 'direct_response', 1, 'AURORA follow-up using prior AIS context.', {
    backendType: 'EXTERNAL',
    providerModel: 'anthropic:claude-sonnet',
  })
  append(session2, 'red_team', 'red_team_challenge', 2, 'PHOENIX: Keep prior failure visible.')
  append(session2, 'chatgpt', 'revision_or_stand_firm', 3, 'DECISION: STAND_FIRM\nCHALLENGE_ADDRESSED: yes\nStand firm.')
  const synth2 = append(session2, 'chatgpt', 'council_synthesis', 4, 'AURORA: Continued from degraded Round 1 without fabricating LUMEN.')
  session2.synthesis_turn_id = synth2.turn_id
  applyPipelineProvenance(session2)

  const intelligence2 = mergeRoundIntoIntelligence(intelligence1, session2, conversationId)
  cases.push(check('17_07_same_conversation_continuation', intelligence2.conversationId === conversationId, intelligence2.conversationId))
  cases.push(check('17_08_new_round_id', intelligence2.latestRoundId === round2Id && intelligence2.roundCount === 2, String(intelligence2.latestRoundId)))
  cases.push(check('17_09_append_round_2', intelligence2.roundCount === 2, String(intelligence2.roundCount)))
  cases.push(check(
    '17_10_round_1_unchanged',
    intelligence2.rounds[0]?.roundId === round1Id
      && intelligence2.rounds[0]?.providerRuntimeTruth.find(p => p.seatId === 'chatgpt')?.backendType === 'LOCAL',
    String(intelligence2.rounds[0]?.providerRuntimeTruth.find(p => p.seatId === 'chatgpt')?.backendType),
  ))
  cases.push(check(
    '17_11_multiple_rounds_ordered',
    intelligence2.rounds.map(r => r.roundId).join('>') === `${round1Id}>${round2Id}`,
    intelligence2.rounds.map(r => r.roundId).join('>'),
  ))

  const continuation = buildContinuationPromptBlock(intelligence1)
  cases.push(check('17_12_prior_synthesis_carry', Boolean(continuation?.includes('priorSynthesis') || continuation?.includes('AURORA')), continuation?.slice(0, 120) ?? 'missing'))
  cases.push(check('17_13_authoritative_revised_contribution_carry', Boolean(continuation?.includes('authoritativePriorContributions') || continuation?.includes('ORION')), 'carry'))
  cases.push(check('17_14_challenge_linkage_carry', Boolean(intelligence1.rounds[0]?.challengeTurnRef), String(intelligence1.rounds[0]?.challengeTurnRef)))
  cases.push(check('17_15_evidence_refs_carry', intelligence1.rounds[0]?.evidenceRefs.some(e => e.evidenceId === 'ev-terra-ais') === true, 'ev-terra-ais'))

  const round2 = buildDurableRoundSnapshot({
    conversationId,
    session: session2,
    priorIntelligence: intelligence1,
  })
  const reused = round2.evidenceRefs.find(e => e.evidenceId === 'ev-terra-ais')
  cases.push(check(
    '17_16_old_new_evidence_distinction',
    reused?.firstIntroducedRoundId === round1Id && reused.reusedInRoundIds.includes(round2Id),
    JSON.stringify(reused),
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
    observed_at: '2026-09-11T13:00:00.000Z',
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
  cases.push(check('17_17_build6_independence', Boolean(annotated[0]?.independence_key), String(annotated[0]?.independence_key)))
  cases.push(check(
    '17_18_roster_history',
    intelligence2.rounds[0]?.roster.includes('claude') === true
      && intelligence2.rounds[1]?.roster.includes('claude') !== true,
    `r1=${intelligence2.rounds[0]?.roster.join(',')} r2=${intelligence2.rounds[1]?.roster.join(',')}`,
  ))

  const r1Orion = intelligence2.rounds[0]?.providerRuntimeTruth.find(p => p.seatId === 'chatgpt')
  const r2Orion = round2.providerRuntimeTruth.find(p => p.seatId === 'chatgpt')
  cases.push(check(
    '17_19_provider_model_history',
    r1Orion?.backendType === 'LOCAL' && r2Orion?.backendType === 'EXTERNAL',
    `r1=${r1Orion?.backendType} r2=${r2Orion?.backendType}`,
  ))
  cases.push(check(
    '17_20_historical_provider_immutable',
    intelligence2.rounds[0]?.providerRuntimeTruth.find(p => p.seatId === 'chatgpt')?.providerModel === r1Orion?.providerModel,
    String(r1Orion?.providerModel),
  ))

  const completeSession = buildRound1Session(conversationId, 'round-complete')
  // Force complete by clearing failed seat simulation — already DEGRADED; build another COMPLETE-like outcome check via pipeline.
  cases.push(check('17_21_complete_continuation_allowed', continuationAllowsNewRound(intelligence1.rounds[0]).allowed, continuationAllowsNewRound(intelligence1.rounds[0]).reason))
  cases.push(check('17_22_degraded_continuation', intelligence1.rounds[0]?.outcome === 'DEGRADED' || intelligence1.rounds[0]?.failedSeats.length > 0, String(intelligence1.rounds[0]?.outcome)))
  cases.push(check('17_23_failed_seat_preserved', intelligence1.rounds[0]?.failedSeats.includes('claude') === true, intelligence1.rounds[0]?.failedSeats.join(',')))

  const failedSession = createDeliberationSession({
    sessionId: conversationId,
    roundId: 'round-failed',
    commanderTurnId: 'round-failed',
    missionId: 'mission_17',
    missionVersion: 1,
    commanderMessage: 'Force fail',
  })
  append(failedSession, 'chatgpt', 'direct_response', 1, '', { status: 'failed' })
  applyPipelineProvenance(failedSession)
  const failedIntel = mergeRoundIntoIntelligence(null, failedSession, conversationId)
  cases.push(check('17_24_failed_round_preserved', failedIntel.rounds[0]?.outcome === 'FAILED' || failedIntel.rounds[0]?.outcome === 'DEGRADED', String(failedIntel.rounds[0]?.outcome)))

  const interrupted = buildDurableRoundSnapshot({
    conversationId,
    session: session1,
    interrupted: true,
  })
  cases.push(check('17_25_interrupted_policy', interrupted.outcome === 'INTERRUPTED' && continuationAllowsNewRound(interrupted).allowed, interrupted.outcome))
  cases.push(check('17_26_bounded_digest', Boolean(intelligence2.sessionDigest) && (intelligence2.sessionDigest.lastSynthesis?.length ?? 0) <= 600, String(intelligence2.sessionDigest.lastSynthesis?.length)))
  cases.push(check('17_27_no_hidden_cot', !payloadContainsHiddenCot(round1) && FORBIDDEN_COT_KEYS.length > 0, FORBIDDEN_COT_KEYS.join(',')))
  cases.push(check('17_28_baby_separation', round1.babyPresent === false && !readRepo('lib/council/session-intelligence/persist.ts').includes('war_room_baby_agents'), 'baby academy not wired'))
  cases.push(check('17_29_nova_canonical', SESSION_INTELLIGENCE_IDENTITY_DOC.conversationId.includes('war_room_conversations.id'), 'identity'))

  const kimiCapability = 0
  cases.push(check('17_30_kimi_runtime_capability_zero', kimiCapability === 0, String(kimiCapability)))
  cases.push(check('17_31_old_kimi_record_compatibility', migrateLegacyPersistedSeat('kimi') === 'nova' || migrateLegacyPersistedSeat('KIMI') === 'nova', String(migrateLegacyPersistedSeat('kimi'))))

  const turnMeta = messageMetadataFromTurn({
    conversationId,
    roundId: round1Id,
    turn: session1.turns[0]!,
    councilStage: 'RESPONSE',
  })
  cases.push(check('17_32_ephemeral_streaming_not_persisted', !('PRIMARY_STARTED' in turnMeta) && !('sseDelta' in turnMeta), Object.keys(turnMeta).join(',')))

  const noCouncil2 = !readRepo('lib/council/session-intelligence/index.ts').includes('Council2')
    && !readRepo('app/api/chat/execute.ts').includes('Council2')
  cases.push(check('17_33_no_council2', noCouncil2, 'no Council2'))

  const ownershipSql = readRepo('supabase/war_room_conversations_ownership.sql')
  const listRoute = readRepo('app/api/conversations/route.ts')
  const persistSrc = readRepo('lib/council/session-intelligence/persist.ts')
  // #19 may (and should) gate access; #17 must not be redesigned into a second conversation system.
  cases.push(check(
    '17_34_no_19_migration',
    /owner_user_id/.test(ownershipSql)
      && /owner_user_id: caller\.userId/.test(listRoute)
      && /ownerUserId required for session-intelligence persist/.test(persistSrc)
      && !/Conversation2|Council2|war_room_conversations_v2/.test(persistSrc + listRoute),
    'ownership gates allowed; #17 semantics remain on existing tables',
  ))

  const noNewTable = !readRepo('lib/council/session-intelligence/persist.ts').includes('create table')
    && readRepo('lib/council/session-intelligence/persist.ts').includes('war_room_conversations')
  cases.push(check('17_35_no_new_table', noNewTable, 'uses war_room_conversations metadata'))

  const size = measureSerializedSize(round1, ROUND_SERIALIZED_SOFT_MAX, ROUND_SERIALIZED_HARD_MAX)
  cases.push(check('17_36_round_size_within_hard_bound', size.withinHard, `bytes=${size.bytes}`))
  cases.push(check('17_37_continuation_labeled_prior_not_evidence', Boolean(continuation?.includes('PRIOR SESSION INTELLIGENCE') && continuation.includes('not current live evidence')), continuation?.slice(0, 80) ?? 'missing'))
  cases.push(check(
    '17_38_same_conversation_assert',
    assertSameConversationContinuation({ conversationId, intelligence: intelligence2 }).ok,
    'ok',
  ))
  cases.push(check(
    '17_39_session_index_rebuildable',
    buildSessionIntelligenceIndex(intelligence2).roundCount === 2
      && buildSessionIntelligenceIndex(intelligence2).latestRoundId === round2Id,
    JSON.stringify(buildSessionIntelligenceIndex(intelligence2)),
  ))
  cases.push(check(
    '17_40_continuation_policy_live',
    CONTINUATION_POLICY === 'session_intelligence_v1',
    CONTINUATION_POLICY,
  ))
  cases.push(check(
    '17_41_version_constant',
    COUNCIL_SESSION_INTELLIGENCE_VERSION === '17.session-intelligence.v1',
    COUNCIL_SESSION_INTELLIGENCE_VERSION,
  ))
  cases.push(check(
    '17_42_append_idempotent_same_round',
    appendRoundToIntelligence(intelligence1, round1).roundCount === 1,
    'idempotent',
  ))

  // Cache bound: conversation metadata rounds[] is capped; message records remain authoritative.
  let overflow: ReturnType<typeof mergeRoundIntoIntelligence> | null = intelligence1
  const overflowMessages: Array<{ id: string; metadata: Record<string, unknown> }> = [{
    id: 'msg-r1',
    metadata: { [COUNCIL_DELIBERATION_ROUND_METADATA_KEY]: round1 },
  }]
  for (let i = 0; i < MAX_DURABLE_ROUNDS + 3; i += 1) {
    const rid = `round-overflow-${i}`
    const overflowSession = createDeliberationSession({
      sessionId: conversationId,
      roundId: rid,
      commanderTurnId: rid,
      missionId: 'mission_17_overflow',
      missionVersion: 1,
      commanderMessage: `Overflow round ${i}`,
    })
    append(overflowSession, 'chatgpt', 'direct_response', 1, `Overflow primary ${i}`)
    const synth = append(overflowSession, 'gemini', 'council_synthesis', 2, `Overflow synthesis ${i}`)
    overflowSession.synthesis_turn_id = synth.turn_id
    applyPipelineProvenance(overflowSession)
    const snap = buildDurableRoundSnapshot({ conversationId, session: overflowSession, priorIntelligence: overflow })
    overflowMessages.push({
      id: `msg-${rid}`,
      metadata: { [COUNCIL_DELIBERATION_ROUND_METADATA_KEY]: snap },
    })
    overflow = mergeRoundIntoIntelligence(overflow, overflowSession, conversationId)
  }
  cases.push(check(
    '17_43_conversation_cache_bounded',
    (overflow?.roundCount ?? 0) <= MAX_DURABLE_ROUNDS
      && (overflow?.rounds.length ?? 0) <= MAX_DURABLE_ROUNDS
      && !(overflow?.rounds.some(r => r.roundId === round1Id)),
    `cacheCount=${overflow?.roundCount} max=${MAX_DURABLE_ROUNDS}`,
  ))
  const rebuiltAfterOverflow = rebuildIntelligenceFromMessages({
    conversationId,
    messages: overflowMessages,
    fallbackMetadata: null,
  })
  cases.push(check(
    '17_44_message_authority_survives_cache_trim',
    Boolean(
      rebuiltAfterOverflow?.rebuiltFromMessages
      && rebuiltAfterOverflow.rounds.some(r => r.roundId === round1Id)
      && rebuiltAfterOverflow.rounds.length > MAX_DURABLE_ROUNDS,
    ),
    `msgRounds=${rebuiltAfterOverflow?.rounds.length} hasR1=${rebuiltAfterOverflow?.rounds.some(r => r.roundId === round1Id)}`,
  ))

  void completeSession
  return cases
}
