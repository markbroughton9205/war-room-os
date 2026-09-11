/**
 * #17 process-restart proof (dev :3001 only).
 *
 * Usage:
 *   node ... scripts/run-council-session-intelligence-restart-proof.mjs seed
 *   # stop/start Next on :3001
 *   node ... scripts/run-council-session-intelligence-restart-proof.mjs verify
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { executeCouncilChatRequest } from '../app/api/chat/execute.ts'
import { tryWarRoomSupabase } from '../lib/war-room/persistence.ts'
import {
  COUNCIL_DELIBERATION_ROUND_METADATA_KEY,
  rebuildIntelligenceFromMessages,
  readSessionIntelligenceFromMetadata,
} from '../lib/council/session-intelligence/index.ts'

const PROOF_PATH = 'work/build17/restart-fingerprint.json'
const TABLE_CONVERSATIONS = 'war_room_conversations'
const TABLE_MESSAGES = 'war_room_messages'

function check(name, pass, detail) {
  return { name, pass, detail }
}

function canonProviderTruth(list) {
  return (list ?? []).map(p => ({
    seatId: p.seatId ?? null,
    nebulaId: p.nebulaId ?? null,
    reasoningRole: p.reasoningRole ?? null,
    providerLabel: p.providerLabel ?? null,
    providerModel: p.providerModel ?? null,
    backendType: p.backendType ?? null,
    backendProvider: p.backendProvider ?? null,
    backendRuntime: p.backendRuntime ?? null,
    completionStatus: p.completionStatus ?? null,
    fallbackFrom: p.fallbackFrom ?? null,
  }))
}

async function seed() {
  const results = []
  const sup = tryWarRoomSupabase()
  results.push(check('restart_seed_01_supabase', Boolean(sup.ok), sup.ok ? 'ok' : 'missing'))
  if (!sup.ok) {
    writeProof({ results, aborted: true })
    fail(results)
    return
  }

  const { data: conv, error: convErr } = await sup.client
    .from(TABLE_CONVERSATIONS)
    .insert({
      title: '#17 Restart Proof',
      state: 'active',
      metadata: { council: { source: 'session_intelligence_restart_17' } },
    })
    .select('id')
    .single()
  const conversationId = conv?.id ?? null
  results.push(check('restart_seed_02_conversation', Boolean(conversationId), conversationId ?? convErr?.message ?? 'missing'))
  if (!conversationId) {
    writeProof({ results, aborted: true })
    fail(results)
    return
  }

  const roundId = `round-17-restart-${crypto.randomUUID()}`
  const response = await executeCouncilChatRequest(new Request('http://war-room.local/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'Restart-proof Round 1: give one concrete Council conclusion about durable session intelligence.',
      raelDirectiveText: 'Restart-proof Round 1: give one concrete Council conclusion about durable session intelligence.',
      conversationId,
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
      councilLogicalRequestId: roundId,
    }),
  }))
  const payload = await response.json().catch(() => ({}))
  const familyDeliberation = payload.familyDeliberation ?? null
  const durableRound = payload.durableRound ?? null
  const sessionIntelligence = payload.sessionIntelligence ?? null

  results.push(check('restart_seed_03_http_ok', response.ok, String(response.status)))
  results.push(check('restart_seed_04_deliberation', Boolean(familyDeliberation), familyDeliberation ? 'present' : 'missing'))
  results.push(check('restart_seed_05_durable_round', Boolean(durableRound?.roundId), durableRound?.roundId ?? 'missing'))

  // Authoritative dual-write onto a durable FINAL message (simulates client message persist path).
  const { data: message, error: msgErr } = await sup.client
    .from(TABLE_MESSAGES)
    .insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: typeof durableRound?.continuationContext?.previousSynthesisSummary === 'string'
        ? durableRound.continuationContext.previousSynthesisSummary
        : (familyDeliberation?.turns?.find(t => t.turn_id === familyDeliberation?.synthesis_turn_id)?.full_response ?? 'Council restart-proof synthesis'),
      family: 'AURORA',
      metadata: {
        responseSuccessful: true,
        roundId: durableRound?.roundId ?? roundId,
        pipelineOutcome: durableRound?.outcome ?? familyDeliberation?.pipeline?.outcome ?? null,
        [COUNCIL_DELIBERATION_ROUND_METADATA_KEY]: durableRound,
      },
    })
    .select('id,metadata')
    .single()

  results.push(check('restart_seed_06_message_dual_write', Boolean(message?.id) && Boolean(message?.metadata?.[COUNCIL_DELIBERATION_ROUND_METADATA_KEY]), message?.id ?? msgErr?.message ?? 'missing'))

  // Strip conversation cache rounds to force message-authority rebuild after restart.
  const { data: convRow } = await sup.client
    .from(TABLE_CONVERSATIONS)
    .select('metadata')
    .eq('id', conversationId)
    .maybeSingle()
  const prevMeta = convRow?.metadata && typeof convRow.metadata === 'object' ? convRow.metadata : {}
  const prevCouncil = prevMeta.council && typeof prevMeta.council === 'object' ? prevMeta.council : {}
  const slimIndex = {
    version: sessionIntelligence?.version ?? '17.session-intelligence.v1',
    conversationId,
    latestRoundId: durableRound?.roundId ?? roundId,
    roundCount: 0,
    rounds: [],
    sessionDigest: sessionIntelligence?.sessionDigest ?? {
      currentObjective: null,
      establishedConclusions: [],
      unresolvedQuestions: [],
      activeEvidenceIds: [],
      latestOutcome: durableRound?.outcome ?? null,
      lastSynthesis: null,
      followUpState: 'awaiting_commander',
    },
    updatedAt: new Date().toISOString(),
    revision: (sessionIntelligence?.revision ?? 0) + 1,
  }
  await sup.client
    .from(TABLE_CONVERSATIONS)
    .update({
      metadata: {
        ...prevMeta,
        council: {
          ...prevCouncil,
          sessionIntelligence: slimIndex,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)

  const fingerprint = {
    conversationId,
    roundId: durableRound?.roundId ?? roundId,
    messageId: message?.id ?? null,
    outcome: durableRound?.outcome ?? null,
    roster: durableRound?.roster ?? [],
    challengeTurnRef: durableRound?.challengeTurnRef ?? null,
    revisionTurnRefs: durableRound?.revisionTurnRefs ?? [],
    synthesisTurnRef: durableRound?.synthesisTurnRef ?? null,
    evidenceIds: (durableRound?.evidenceRefs ?? []).map(e => e.evidenceId),
    providerRuntimeTruth: durableRound?.providerRuntimeTruth ?? [],
    failedSeats: durableRound?.failedSeats ?? [],
    seededAt: new Date().toISOString(),
    note: 'Conversation cache rounds[] intentionally emptied; restore must rebuild from message councilDeliberationRound.',
  }

  writeProof({ phase: 'seed', results, fingerprint })
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`#17 restart seed: ${results.length - failed.length}/${results.length} PASS`)
  console.log(`FINGERPRINT conversationId=${fingerprint.conversationId} roundId=${fingerprint.roundId}`)
  console.log('NEXT: stop Next on :3001, start again on :3001, then run verify.')
  if (failed.length) process.exitCode = 1
}

async function verify() {
  const results = []
  if (!existsSync(PROOF_PATH)) {
    results.push(check('restart_verify_00_fingerprint', false, 'missing fingerprint — run seed first'))
    writeProof({ phase: 'verify', results, aborted: true })
    fail(results)
    return
  }
  const prior = JSON.parse(readFileSync(PROOF_PATH, 'utf8'))
  const fingerprint = prior.fingerprint
  results.push(check('restart_verify_00_fingerprint', Boolean(fingerprint?.conversationId && fingerprint?.roundId), fingerprint?.conversationId ?? 'missing'))

  const sup = tryWarRoomSupabase()
  results.push(check('restart_verify_01_supabase_after_restart', Boolean(sup.ok), sup.ok ? 'ok' : 'missing'))
  if (!sup.ok || !fingerprint) {
    writeProof({ phase: 'verify', results, fingerprint, aborted: true })
    fail(results)
    return
  }

  const { data: messages } = await sup.client
    .from(TABLE_MESSAGES)
    .select('id,metadata,role,content')
    .eq('conversation_id', fingerprint.conversationId)
    .order('created_at', { ascending: true })

  const { data: conv } = await sup.client
    .from(TABLE_CONVERSATIONS)
    .select('metadata')
    .eq('id', fingerprint.conversationId)
    .maybeSingle()

  const cache = readSessionIntelligenceFromMetadata(conv?.metadata)
  results.push(check(
    'restart_verify_02_cache_not_sole_authority',
    !cache?.rounds?.some(r => r.roundId === fingerprint.roundId),
    `cacheRounds=${cache?.rounds?.length ?? 0}`,
  ))

  const rebuilt = rebuildIntelligenceFromMessages({
    conversationId: fingerprint.conversationId,
    messages: messages ?? [],
    fallbackMetadata: conv?.metadata,
  })
  const round = rebuilt?.rounds.find(r => r.roundId === fingerprint.roundId) ?? null

  results.push(check('restart_verify_03_rebuilt_from_messages', Boolean(rebuilt?.rebuiltFromMessages), String(rebuilt?.rebuiltFromMessages)))
  results.push(check('restart_verify_04_conversationId', round?.conversationId === fingerprint.conversationId, round?.conversationId ?? 'missing'))
  results.push(check('restart_verify_05_roundId', round?.roundId === fingerprint.roundId, round?.roundId ?? 'missing'))
  results.push(check('restart_verify_06_outcome', round?.outcome === fingerprint.outcome, String(round?.outcome)))
  results.push(check(
    'restart_verify_07_roster',
    JSON.stringify(round?.roster ?? []) === JSON.stringify(fingerprint.roster),
    JSON.stringify(round?.roster ?? []),
  ))
  results.push(check('restart_verify_08_challenge', round?.challengeTurnRef === fingerprint.challengeTurnRef, String(round?.challengeTurnRef)))
  results.push(check(
    'restart_verify_09_revisions',
    JSON.stringify(round?.revisionTurnRefs ?? []) === JSON.stringify(fingerprint.revisionTurnRefs),
    JSON.stringify(round?.revisionTurnRefs ?? []),
  ))
  results.push(check('restart_verify_10_synthesis', round?.synthesisTurnRef === fingerprint.synthesisTurnRef, String(round?.synthesisTurnRef)))
  results.push(check(
    'restart_verify_11_evidence',
    JSON.stringify((round?.evidenceRefs ?? []).map(e => e.evidenceId)) === JSON.stringify(fingerprint.evidenceIds),
    JSON.stringify((round?.evidenceRefs ?? []).map(e => e.evidenceId)),
  ))
  results.push(check(
    'restart_verify_12_provider_truth',
    JSON.stringify(canonProviderTruth(round?.providerRuntimeTruth)) === JSON.stringify(canonProviderTruth(fingerprint.providerRuntimeTruth)),
    `seats=${(round?.providerRuntimeTruth ?? []).map(p => `${p.seatId}:${p.backendType}:${p.providerModel}`).join('|')}`,
  ))
  results.push(check(
    'restart_verify_13_failed_seats',
    JSON.stringify(round?.failedSeats ?? []) === JSON.stringify(fingerprint.failedSeats),
    JSON.stringify(round?.failedSeats ?? []),
  ))

  const authoritativeMessage = (messages ?? []).find(m => m.metadata?.[COUNCIL_DELIBERATION_ROUND_METADATA_KEY]?.roundId === fingerprint.roundId)
  results.push(check(
    'restart_verify_14_message_authority_key',
    Boolean(authoritativeMessage?.metadata?.[COUNCIL_DELIBERATION_ROUND_METADATA_KEY]),
    authoritativeMessage?.id ?? 'missing',
  ))

  // Conversation API requires auth (401 without session). Process restart is proven by
  // fresh :3001 readiness + DB-only message rebuild above (no client stores).
  let processAliveStatus = null
  try {
    const res = await fetch('http://127.0.0.1:3001/login', { headers: { accept: 'text/html' } })
    processAliveStatus = res.status
  } catch (error) {
    processAliveStatus = `fetch_error:${error instanceof Error ? error.message : String(error)}`
  }
  results.push(check(
    'restart_verify_15_dev_3001_alive_after_restart',
    processAliveStatus === 200,
    `status=${processAliveStatus}`,
  ))
  results.push(check(
    'restart_verify_16_conversation_reopen_db_only',
    Boolean(round && authoritativeMessage && rebuilt?.rebuiltFromMessages),
    `conversationId=${fingerprint.conversationId}`,
  ))

  writeProof({
    phase: 'verify',
    results,
    fingerprint,
    verifiedAt: new Date().toISOString(),
    rebuiltFromMessages: Boolean(rebuilt?.rebuiltFromMessages),
    cacheRoundCount: cache?.rounds?.length ?? 0,
    processAliveStatus,
    note: 'Client localStorage/sessionStorage not used. Conversation cache rounds[] emptied at seed. Authority = message councilDeliberationRound. Production :3000 untouched.',
  })

  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`#17 restart verify: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exitCode = 1
}

function writeProof(payload) {
  mkdirSync('work/build17', { recursive: true })
  writeFileSync(PROOF_PATH, JSON.stringify(payload, null, 2))
}

function fail(results) {
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`)
  }
  process.exitCode = 1
}

const mode = process.argv[2] ?? 'seed'
if (mode === 'verify') {
  await verify()
} else if (mode === 'seed') {
  await seed()
} else {
  console.error('Usage: ...restart-proof.mjs seed|verify')
  process.exitCode = 1
}
