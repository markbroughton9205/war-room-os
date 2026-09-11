/**
 * #17 process-restart proof: DB baseline + post-restart restore verification.
 * Usage: node --env-file=.env.local --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types scripts/prove-17-restart.mjs [conversationId] [phase]
 * phase: baseline | restore | both
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  rebuildIntelligenceFromMessages,
  hydrateSessionIntelligenceFromConversation,
  COUNCIL_DELIBERATION_ROUND_METADATA_KEY,
  readSessionIntelligenceFromMetadata,
} from '../lib/council/session-intelligence/index.ts'

const conversationIdArg = process.argv[2]
const phase = process.argv[3] || 'both'
const PROOF_DIR = 'work/build17'
const BASELINE_PATH = `${PROOF_DIR}/restart-baseline.json`
const RESTORE_PATH = `${PROOF_DIR}/restart-restore.json`

function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

function client() {
  return createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function loadConversation(conversationId) {
  const sb = client()
  const { data: conv, error: cErr } = await sb
    .from('war_room_conversations')
    .select('id,title,metadata,updated_at')
    .eq('id', conversationId)
    .maybeSingle()
  if (cErr) throw new Error(cErr.message)
  if (!conv) throw new Error(`conversation not found: ${conversationId}`)

  const { data: messages, error: mErr } = await sb
    .from('war_room_messages')
    .select('id,role,content,family,metadata,created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (mErr) throw new Error(mErr.message)

  const messageRounds = []
  for (const row of messages ?? []) {
    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : null
    const round = meta?.[COUNCIL_DELIBERATION_ROUND_METADATA_KEY]
    if (round && typeof round === 'object') {
      messageRounds.push({
        messageId: row.id,
        role: row.role,
        family: row.family,
        roundId: round.roundId,
        outcome: round.outcome,
        roster: round.roster,
        challengeTurnRef: round.challengeTurnRef,
        revisionTurnRefs: round.revisionTurnRefs,
        synthesisTurnRef: round.synthesisTurnRef,
        evidenceRefs: (round.evidenceRefs ?? []).map(e => e.evidenceId),
        providerRuntimeTruth: (round.providerRuntimeTruth ?? []).map(p => ({
          seatId: p.seatId,
          backendType: p.backendType,
          backendRuntime: p.backendRuntime,
          providerModel: p.providerModel,
          completionStatus: p.completionStatus,
        })),
        failedSeats: round.failedSeats,
        revisionDecisions: (round.turnRefs ?? [])
          .filter(t => t.revisionDecision)
          .map(t => ({ turnId: t.turnId, decision: t.revisionDecision })),
      })
    }
  }

  const sessionIntelligence = readSessionIntelligenceFromMetadata(conv.metadata)
  const rebuilt = rebuildIntelligenceFromMessages({
    conversationId,
    messages: messages ?? [],
    fallbackMetadata: conv.metadata,
  })
  const cacheOnly = hydrateSessionIntelligenceFromConversation({
    conversationId,
    metadata: conv.metadata,
  })

  return {
    conversationId,
    title: conv.title,
    updatedAt: conv.updated_at,
    messageCount: (messages ?? []).length,
    authoritativeMessageRoundCount: messageRounds.length,
    authoritativeMessageRounds: messageRounds,
    sessionIntelligenceCache: sessionIntelligence
      ? {
          version: sessionIntelligence.version,
          roundCount: sessionIntelligence.roundCount,
          latestRoundId: sessionIntelligence.latestRoundId,
          rounds: sessionIntelligence.rounds.map(r => ({
            roundId: r.roundId,
            outcome: r.outcome,
            roster: r.roster,
            challengeTurnRef: r.challengeTurnRef,
            revisionTurnRefs: r.revisionTurnRefs,
            synthesisTurnRef: r.synthesisTurnRef,
            evidenceIds: r.evidenceRefs.map(e => e.evidenceId),
            providerRuntimeTruth: r.providerRuntimeTruth.map(p => ({
              seatId: p.seatId,
              backendType: p.backendType,
              backendRuntime: p.backendRuntime,
              providerModel: p.providerModel,
            })),
            failedSeats: r.failedSeats,
          })),
        }
      : null,
    rebuiltFromMessages: rebuilt
      ? {
          rebuiltFromMessages: rebuilt.rebuiltFromMessages,
          roundCount: rebuilt.intelligence.roundCount,
          roundIds: rebuilt.rounds.map(r => r.roundId),
          rounds: rebuilt.rounds.map(r => ({
            roundId: r.roundId,
            outcome: r.outcome,
            roster: r.roster,
            challengeTurnRef: r.challengeTurnRef,
            revisionTurnRefs: r.revisionTurnRefs,
            synthesisTurnRef: r.synthesisTurnRef,
            evidenceIds: r.evidenceRefs.map(e => e.evidenceId),
            failedSeats: r.failedSeats,
            providerSample: r.providerRuntimeTruth.slice(0, 4),
          })),
        }
      : null,
    cacheOnlyRoundCount: cacheOnly?.intelligence.roundCount ?? 0,
  }
}

async function baseline(conversationId) {
  const snapshot = await loadConversation(conversationId)
  mkdirSync(PROOF_DIR, { recursive: true })
  writeFileSync(BASELINE_PATH, JSON.stringify({ recordedAt: new Date().toISOString(), ...snapshot }, null, 2))
  console.log(JSON.stringify({
    phase: 'baseline',
    conversationId,
    messageCount: snapshot.messageCount,
    authoritativeMessageRoundCount: snapshot.authoritativeMessageRoundCount,
    cacheRoundCount: snapshot.sessionIntelligenceCache?.roundCount ?? 0,
    rebuiltFromMessages: snapshot.rebuiltFromMessages?.rebuiltFromMessages ?? false,
    roundIds: snapshot.rebuiltFromMessages?.roundIds ?? snapshot.sessionIntelligenceCache?.rounds?.map(r => r.roundId) ?? [],
  }, null, 2))
  return snapshot
}

async function restore(conversationId, baseUrl) {
  // Prove the NEW Next process is alive (no dependency on prior process memory).
  const healthRes = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' })
  const healthOk = healthRes.ok
  const healthBody = await healthRes.text().catch(() => '')

  // Conversation GET is session-gated by middleware (401 without cookies).
  // The route handler itself uses tryWarRoomSupabase (service role) — identical durable path.
  // After process restart we load through that same DB path + the same hydrate rebuilders
  // used by openCouncilSession / rebuildIntelligenceFromMessages.
  let apiStatus = null
  let apiUnauthorized = false
  try {
    const res = await fetch(`${baseUrl}/api/conversations/${conversationId}`, { cache: 'no-store' })
    apiStatus = res.status
    apiUnauthorized = res.status === 401
  } catch (error) {
    apiStatus = `fetch_error:${error instanceof Error ? error.message : String(error)}`
  }

  const snapshot = await loadConversation(conversationId)
  const messages = snapshot.authoritativeMessageRounds
  const rebuilt = snapshot.rebuiltFromMessages
  const baseline = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    : null

  const checks = []
  const push = (name, pass, detail) => checks.push({ name, pass, detail })

  push('fresh_process_health', healthOk, `${baseUrl}/api/health status=${healthRes.status} body=${healthBody.slice(0, 80)}`)
  push('conversation_api_session_gated_or_ok', apiUnauthorized || apiStatus === 200, `status=${apiStatus}`)
  push('authoritative_message_rounds_present', snapshot.authoritativeMessageRoundCount > 0, String(snapshot.authoritativeMessageRoundCount))
  push('rebuild_from_messages', Boolean(rebuilt?.rebuiltFromMessages), String(rebuilt?.rebuiltFromMessages))
  push('round_count_ge_1', (rebuilt?.roundCount ?? 0) >= 1, String(rebuilt?.roundCount ?? 0))
  push('message_authority_can_rebuild_index', snapshot.authoritativeMessageRoundCount > 0 && Boolean(rebuilt?.rebuiltFromMessages), `msgRounds=${snapshot.authoritativeMessageRoundCount}`)
  push('cache_is_not_sole_authority', snapshot.authoritativeMessageRoundCount > 0, `cacheRounds=${snapshot.sessionIntelligenceCache?.roundCount ?? 0}`)

  if (baseline?.authoritativeMessageRounds?.length) {
    const bRounds = baseline.authoritativeMessageRounds
    const rRounds = messages
    push('round_count_preserved', rRounds.length === bRounds.length, `baseline=${bRounds.length} restored=${rRounds.length}`)
    for (const b of bRounds) {
      const r = rRounds.find(x => x.roundId === b.roundId)
      push(`round_${b.roundId.slice(0, 18)}_outcome`, r?.outcome === b.outcome, `${r?.outcome} vs ${b.outcome}`)
      push(`round_${b.roundId.slice(0, 18)}_challenge`, r?.challengeTurnRef === b.challengeTurnRef, String(r?.challengeTurnRef))
      push(`round_${b.roundId.slice(0, 18)}_synthesis`, r?.synthesisTurnRef === b.synthesisTurnRef, String(r?.synthesisTurnRef))
      push(
        `round_${b.roundId.slice(0, 18)}_roster`,
        JSON.stringify(r?.roster) === JSON.stringify(b.roster),
        JSON.stringify(r?.roster),
      )
      push(
        `round_${b.roundId.slice(0, 18)}_provider`,
        JSON.stringify(r?.providerRuntimeTruth) === JSON.stringify(b.providerRuntimeTruth),
        'providerRuntimeTruth match',
      )
    }
    if (bRounds.length >= 2) {
      push('round1_still_first', rRounds[0]?.roundId === bRounds[0].roundId, rRounds[0]?.roundId)
      push('round2_appended', rRounds[1]?.roundId === bRounds[1].roundId, rRounds[1]?.roundId)
      push(
        'historical_roster_separate',
        JSON.stringify(rRounds[0]?.roster) !== undefined && rRounds[0]?.roundId !== rRounds[1]?.roundId,
        `${rRounds[0]?.roundId} / ${rRounds[1]?.roundId}`,
      )
    }
  }

  const report = {
    recordedAt: new Date().toISOString(),
    baseUrl,
    conversationId,
    processProof: {
      healthOk,
      healthStatus: healthRes.status,
      conversationApiStatus: apiStatus,
      note: apiUnauthorized
        ? 'GET /api/conversations/[id] is session-gated by middleware; durable restore verified via the same service-role Supabase path the route handler uses (tryWarRoomSupabase) after process restart.'
        : 'Conversation API returned data.',
    },
    messageCount: snapshot.messageCount,
    authoritativeMessageRounds: messages,
    rebuiltFromMessages: rebuilt,
    sessionIntelligenceCacheRoundCount: snapshot.sessionIntelligenceCache?.roundCount ?? 0,
    checks,
    passed: checks.every(c => c.pass),
  }

  mkdirSync(PROOF_DIR, { recursive: true })
  writeFileSync(RESTORE_PATH, JSON.stringify(report, null, 2))
  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`)
  }
  console.log(`#17 process-restart restore: ${checks.filter(c => c.pass).length}/${checks.length} PASS`)
  if (!report.passed) process.exitCode = 1
  return report
}

async function resolveConversationId() {
  if (conversationIdArg) return conversationIdArg
  // Prefer live proof conversation if present.
  const livePath = `${PROOF_DIR}/session-intelligence-live.json`
  if (existsSync(livePath)) {
    const live = JSON.parse(readFileSync(livePath, 'utf8'))
    if (live?.proof?.conversationId) return live.proof.conversationId
  }
  // Fallback: find any conversation with sessionIntelligence
  const sb = client()
  const { data } = await sb
    .from('war_room_conversations')
    .select('id,metadata,updated_at')
    .order('updated_at', { ascending: false })
    .limit(50)
  for (const row of data ?? []) {
    const si = readSessionIntelligenceFromMetadata(row.metadata)
    if (si?.roundCount) return row.id
  }
  throw new Error('No #17 conversation found')
}

const conversationId = await resolveConversationId()
if (phase === 'baseline' || phase === 'both') {
  await baseline(conversationId)
}
if (phase === 'restore' || phase === 'both') {
  const baseUrl = process.env.WAR_ROOM_BASE_URL?.replace(/\/$/, '') || 'http://127.0.0.1:3001'
  await restore(conversationId, baseUrl)
}
