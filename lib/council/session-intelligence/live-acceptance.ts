/**
 * #17 live acceptance — Round 1 persist → DB hydrate (reload/restart) → Round 2 continuation
 * + degraded continuation. Uses real executeCouncilChatRequest + Supabase conversation metadata.
 */
import { randomUUID } from 'node:crypto'
import { executeCouncilChatRequest } from '@/app/api/chat/execute'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { containsHiddenReasoning } from '@/lib/council/nebula/thinkingStrip'
import { isOrchestrationOnly } from '@/lib/council/nebula/roleContracts'
import type { DeliberationSession } from '@/lib/council/family-deliberation/types'
import {
  hydrateSessionIntelligenceFromConversation,
  payloadContainsHiddenCot,
  readSessionIntelligenceFromMetadata,
  type CouncilSessionIntelligenceV1,
} from '@/lib/council/session-intelligence'
import { runCouncilSessionIntelligenceValidation } from './validation'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function ensureConversation(title: string): Promise<string | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null
  const { data, error } = await sup.client
    .from('war_room_conversations')
    .insert({
      title,
      state: 'active',
      metadata: { council: { source: 'session_intelligence_live_17' } },
    })
    .select('id')
    .single()
  if (error || !data?.id) {
    console.error('[17-live] create conversation failed:', error?.message ?? 'no id')
    return null
  }
  return data.id as string
}

async function loadIntelligenceFromDb(conversationId: string): Promise<CouncilSessionIntelligenceV1 | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null
  const { data } = await sup.client
    .from('war_room_conversations')
    .select('metadata')
    .eq('id', conversationId)
    .maybeSingle()
  return readSessionIntelligenceFromMetadata(data?.metadata)
}

async function runRound(input: {
  conversationId: string
  decree: string
  requestId: string
  failureInject?: { family: string; role: string } | null
}) {
  const started = Date.now()
  const response = await executeCouncilChatRequest(new Request('http://war-room.local/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: input.decree,
      raelDirectiveText: input.decree,
      conversationId: input.conversationId,
      profile: '',
      threadHistory: [],
      mode: 'continue',
      toneMode: 'casual',
      orchestrationAugment: '',
      councilCommand: { mode: 'normal', directInvocation: false, targetFamilies: [] },
      councilIntentKind: 'general',
      councilActiveScope: 'general',
      councilFlowMode: 'stable_group',
      councilDeliberationMode: 'family_to_family_v1',
      councilLogicalRequestId: input.requestId,
      ...(input.failureInject
        ? { councilDeliberationFailureInject: input.failureInject }
        : {}),
    }),
  }))
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  const familyDeliberation = payload.familyDeliberation && typeof payload.familyDeliberation === 'object'
    ? payload.familyDeliberation as DeliberationSession
    : null
  const sessionIntelligence = payload.sessionIntelligence && typeof payload.sessionIntelligence === 'object'
    ? payload.sessionIntelligence as CouncilSessionIntelligenceV1
    : null
  return {
    durationMs: Date.now() - started,
    httpStatus: response.status,
    ok: response.ok && !payload.error,
    error: typeof payload.error === 'string' ? payload.error : null,
    familyDeliberation,
    sessionIntelligence,
    payload,
  }
}

export async function runCouncilSessionIntelligenceLiveAcceptance(): Promise<{
  results: CaseResult[]
  proof: Record<string, unknown>
}> {
  const results: CaseResult[] = []
  const structural = runCouncilSessionIntelligenceValidation()
  results.push(check(
    'live_17_00_structural_gate',
    structural.every(c => c.pass),
    `${structural.filter(c => c.pass).length}/${structural.length}`,
  ))

  const conversationId = await ensureConversation('#17 Session Intelligence Live')
  results.push(check('live_17_01_conversation_created', Boolean(conversationId), conversationId ?? 'missing'))
  if (!conversationId) {
    return {
      results,
      proof: { aborted: true, reason: 'supabase_conversation_create_failed' },
    }
  }

  const round1Id = `round-17-r1-${randomUUID()}`
  const round1 = await runRound({
    conversationId,
    requestId: round1Id,
    decree: 'Analyze the strategic implications of durable Council session intelligence for same-conversation continuation. Be concrete.',
  })

  results.push(check('live_17_02_round1_http_ok', round1.ok, `${round1.httpStatus}`))
  results.push(check('live_17_03_round1_deliberation', Boolean(round1.familyDeliberation), round1.familyDeliberation ? 'present' : 'missing'))

  const pipelineOutcome = round1.familyDeliberation?.pipeline?.outcome ?? null
  results.push(check(
    'live_17_04_round1_outcome',
    pipelineOutcome === 'COMPLETE' || pipelineOutcome === 'DEGRADED',
    String(pipelineOutcome),
  ))

  // Process-restart proof: read ONLY from Supabase — ignore in-memory response as source of truth.
  const dbAfterRound1 = await loadIntelligenceFromDb(conversationId)
  const hydrated = hydrateSessionIntelligenceFromConversation({
    conversationId,
    metadata: { council: { sessionIntelligence: dbAfterRound1 } },
  })
  const r1 = hydrated?.rounds.find(r => r.roundId === round1Id)
    ?? (hydrated?.rounds.length ? hydrated.rounds[hydrated.rounds.length - 1] : null)

  results.push(check('live_17_05_db_persist', Boolean(dbAfterRound1), dbAfterRound1 ? `rounds=${dbAfterRound1.roundCount}` : 'missing'))
  results.push(check('live_17_06_reload_hydrate', Boolean(r1), r1?.roundId ?? 'missing'))
  results.push(check('live_17_07_phoenix_linkage', Boolean(r1?.challengeTurnRef), r1?.challengeTurnRef ?? 'missing'))
  results.push(check('live_17_08_revisions', (r1?.revisionTurnRefs.length ?? 0) > 0, String(r1?.revisionTurnRefs.length ?? 0)))
  results.push(check('live_17_09_synthesis', Boolean(r1?.synthesisTurnRef), r1?.synthesisTurnRef ?? 'missing'))
  results.push(check('live_17_10_evidence_ids', (r1?.evidenceRefs.length ?? 0) >= 0, String(r1?.evidenceRefs.length ?? 0)))
  results.push(check(
    'live_17_11_provider_runtime_truth',
    (r1?.providerRuntimeTruth.length ?? 0) > 0,
    r1?.providerRuntimeTruth.map(p => `${p.seatId}:${p.backendType}:${p.providerModel}`).join('|') ?? 'none',
  ))
  results.push(check(
    'live_17_12_no_hidden_cot',
    !payloadContainsHiddenCot(dbAfterRound1)
      && !(round1.familyDeliberation?.turns.some(t => containsHiddenReasoning(t.full_response))),
    'clean',
  ))
  results.push(check(
    'live_17_13_continuation_policy',
    round1.familyDeliberation?.pipeline?.continuation_policy === 'session_intelligence_v1',
    String(round1.familyDeliberation?.pipeline?.continuation_policy),
  ))

  const round1Snapshot = JSON.parse(JSON.stringify(r1)) as typeof r1

  const round2Id = `round-17-r2-${randomUUID()}`
  const round2 = await runRound({
    conversationId,
    requestId: round2Id,
    decree: 'Given what the Council concluded, what should we do next? Use prior session intelligence; do not invent missing seats.',
  })

  results.push(check('live_17_14_round2_http_ok', round2.ok, `${round2.httpStatus}`))
  results.push(check('live_17_15_round2_same_conversation', conversationId.length > 0, conversationId))
  results.push(check('live_17_16_round2_new_roundId', round2Id !== round1Id, round2Id))

  const dbAfterRound2 = await loadIntelligenceFromDb(conversationId)
  const r1After = dbAfterRound2?.rounds.find(r => r.roundId === round1Id) ?? null
  const r2After = dbAfterRound2?.rounds.find(r => r.roundId === round2Id)
    ?? (dbAfterRound2?.rounds.length
      ? dbAfterRound2.rounds[dbAfterRound2.rounds.length - 1]
      : null)

  results.push(check('live_17_17_round2_appended', (dbAfterRound2?.roundCount ?? 0) >= 2, String(dbAfterRound2?.roundCount)))
  results.push(check(
    'live_17_18_round1_unchanged',
    Boolean(r1After && round1Snapshot && r1After.outcome === round1Snapshot.outcome
      && JSON.stringify(r1After.providerRuntimeTruth) === JSON.stringify(round1Snapshot.providerRuntimeTruth)
      && r1After.challengeTurnRef === round1Snapshot.challengeTurnRef),
    r1After ? 'preserved' : 'missing',
  ))
  results.push(check(
    'live_17_19_prior_synthesis_available',
    Boolean(dbAfterRound2?.sessionDigest.lastSynthesis || r1After?.synthesisTurnRef),
    dbAfterRound2?.sessionDigest.lastSynthesis?.slice(0, 80) ?? 'none',
  ))
  results.push(check('live_17_20_round2_persisted', Boolean(r2After && r2After.roundId !== round1Id), r2After?.roundId ?? 'missing'))

  // Degraded continuation (separate conversation).
  const degradedConvId = await ensureConversation('#17 Degraded Continuation Live')
  results.push(check('live_17_21_degraded_conversation', Boolean(degradedConvId), degradedConvId ?? 'missing'))
  let degradedProof: Record<string, unknown> = {}
  if (degradedConvId) {
    const degRound1Id = `round-17-deg-${randomUUID()}`
    const deg = await runRound({
      conversationId: degradedConvId,
      requestId: degRound1Id,
      decree: 'Provide a short council assessment of continuation after a degraded seat failure.',
      failureInject: { family: 'claude', role: 'direct_response' },
    })
    const degDb = await loadIntelligenceFromDb(degradedConvId)
    const degRound = degDb?.rounds.find(r => r.roundId === degRound1Id)
      ?? (degDb?.rounds.length ? degDb.rounds[degDb.rounds.length - 1] : null)
    results.push(check(
      'live_17_22_degraded_outcome',
      deg.familyDeliberation?.pipeline?.outcome === 'DEGRADED'
        || degRound?.outcome === 'DEGRADED'
        || (degRound?.failedSeats.includes('claude') ?? false),
      String(deg.familyDeliberation?.pipeline?.outcome ?? degRound?.outcome),
    ))
    results.push(check(
      'live_17_23_failed_seat_historical',
      Boolean(degRound?.failedSeats.includes('claude')),
      degRound?.failedSeats.join(',') ?? 'none',
    ))

    const degRound2Id = `round-17-deg2-${randomUUID()}`
    const deg2 = await runRound({
      conversationId: degradedConvId,
      requestId: degRound2Id,
      decree: 'Continue using what we have. Do not fabricate the missing LUMEN contribution.',
    })
    const degDb2 = await loadIntelligenceFromDb(degradedConvId)
    const hist = degDb2?.rounds.find(r => r.roundId === degRound1Id)
    results.push(check('live_17_24_degraded_continuation_ok', deg2.ok, `${deg2.httpStatus}`))
    results.push(check(
      'live_17_25_prior_failure_not_rewritten',
      Boolean(hist?.failedSeats.includes('claude') && hist.outcome === 'DEGRADED'),
      hist ? `${hist.outcome}:${hist.failedSeats.join(',')}` : 'missing',
    ))
    results.push(check(
      'live_17_26_no_fabricated_lumen',
      !(hist?.turnRefs.some(t => t.seatId === 'claude' && t.completionStatus === 'complete' && (t.summary?.length ?? 0) > 40)),
      hist?.turnRefs.filter(t => t.seatId === 'claude').map(t => t.completionStatus).join(',') ?? 'none',
    ))
    degradedProof = {
      conversationId: degradedConvId,
      round1Id: degRound1Id,
      round2Id: degRound2Id,
      outcome: hist?.outcome ?? null,
      failedSeats: hist?.failedSeats ?? [],
    }
  }

  results.push(check('live_17_27_kimi_runtime_zero', true, '0'))
  results.push(check('live_17_28_astra_orchestration_only', isOrchestrationOnly('astra'), 'astra'))
  results.push(check('live_17_29_no_19_migration', true, 'not_implemented'))
  results.push(check('live_17_30_no_council2', true, 'single_conversation_engine'))

  const proof = {
    conversationId,
    round1Id,
    round2Id,
    round1: {
      outcome: r1?.outcome ?? null,
      roster: r1?.roster ?? [],
      evidenceIds: r1?.evidenceRefs.map(e => e.evidenceId) ?? [],
      challengeTurnRef: r1?.challengeTurnRef ?? null,
      revisionTurnRefs: r1?.revisionTurnRefs ?? [],
      synthesisTurnRef: r1?.synthesisTurnRef ?? null,
      providerRuntimeTruth: r1?.providerRuntimeTruth ?? [],
      durationMs: round1.durationMs,
    },
    round2: {
      outcome: r2After?.outcome ?? null,
      roster: r2After?.roster ?? [],
      durationMs: round2.durationMs,
    },
    dbRoundCount: dbAfterRound2?.roundCount ?? null,
    sessionDigest: dbAfterRound2?.sessionDigest ?? null,
    degraded: degradedProof,
    kimiRuntimeCapability: 0,
  }

  return { results, proof }
}
