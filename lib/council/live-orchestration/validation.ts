import { parseSseFrame, splitSseFrames } from './sseParse'
import { classifyCouncilTurn, shouldRunFamilyDeliberation } from '@/lib/council/session-orchestration/turnIntent'
import { isLightweightPingDecree } from '@/lib/council/contextRelevance'
import { decideMemoryCandidatePrompt } from './memoryCandidateGate'
import { isSocialCouncilCheckin } from './socialCheckin'
import { canTransitionRoundPhase, socialCheckinPhasePath } from './roundMachine'
import { nextEligibleFloor, resolveVisibleFloorOrder, snapshotFloor, visibleConcurrentFamilies } from './floorScheduler'
import { classifyProviderFailure, failureUiLabel } from './failureTaxonomy'
import { MAX_TRANSIENT_RETRIES_BEFORE_VISIBLE_TOKEN, shouldRetryProviderAttempt } from './retryPolicy'
import { resolveStreamTimeoutBudget } from './timeoutPolicy'
import { healthLevelFromProbe } from './healthLevels'
import { attemptIdFor, logicalMessageIdFor } from './attemptIdempotency'
import { intentLaneFromTurnIntent } from './types'
import { buildCouncilRosterSnapshot } from './rosterHealth'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail = ''): CaseResult {
  return { name, pass, detail }
}

function anthropicDeltaFromFixture(): string {
  const raw = [
    'event: content_block_delta',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Present."}}',
    '',
    '',
  ].join('\n')
  const { frames } = splitSseFrames(raw)
  const parsed = parseSseFrame(frames[0] ?? '')
  const data = JSON.parse(parsed.data) as { delta?: { text?: string } }
  return data.delta?.text ?? ''
}

export function runLiveCouncilOrchestrationValidation(): CaseResult[] {
  const hi = classifyCouncilTurn('Hi council')
  const checkIn = classifyCouncilTurn('Council check in')
  const world = classifyCouncilTurn("Council, what's going on with the world?")
  const normal = classifyCouncilTurn('What is a hash table?')
  const thanksMem = decideMemoryCandidatePrompt({ commanderText: 'Thanks', anySuccess: true, intentTier: 'coordination' })
  const checkInMem = decideMemoryCandidatePrompt({ commanderText: 'Council check in', anySuccess: true, intentTier: 'coordination' })
  const durableMem = decideMemoryCandidatePrompt({ commanderText: 'From now on, use X for Y.', anySuccess: true, intentTier: 'coordination' })
  const floor = resolveVisibleFloorOrder({
    configured: { chatgpt: true, claude: true, grok: true, gemini: true, red_team: true, kimi: false },
    includeRedTeam: true,
  })
  const participants = floor.map((family, index) => ({
    family,
    configured: true,
    state: index === 0 ? 'STREAMING' as const : 'WAITING' as const,
  }))
  const snap = snapshotFloor(participants)
  const openaiFixture = parseSseFrame('data: {"choices":[{"delta":{"content":"Hello"}}]}\n')
  const openaiChunk = (JSON.parse(openaiFixture.data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content
  const retryVisible = shouldRetryProviderAttempt({ attempt: 1, visibleTokensEmitted: true, layer: 'PROVIDER', httpStatus: 500 })
  const retryAuth = shouldRetryProviderAttempt({ attempt: 1, visibleTokensEmitted: false, layer: 'AUTH', httpStatus: 401 })
  const retry5xx = shouldRetryProviderAttempt({ attempt: 1, visibleTokensEmitted: false, layer: 'PROVIDER', httpStatus: 500 })

  return [
    check('social_01_hi_council_lane', hi.intent === 'SOCIAL_CHECKIN' && hi.depth === 'FAST' && !hi.shouldResearch, JSON.stringify(hi)),
    check('social_02_checkin_lane', checkIn.intent === 'SOCIAL_CHECKIN' && !shouldRunFamilyDeliberation(checkIn), JSON.stringify(checkIn)),
    check('social_03_detector', isSocialCouncilCheckin('Everybody here?') && isSocialCouncilCheckin('Team check in'), 'detector'),
    check('social_04_lightweight', isLightweightPingDecree('Council check in') && isLightweightPingDecree('Hi council'), 'ping'),
    check('intent_01_normal', intentLaneFromTurnIntent(normal.intent) === 'NORMAL_COUNCIL' && normal.depth === 'FULL', JSON.stringify(normal)),
    check('intent_02_world', world.shouldResearch && intentLaneFromTurnIntent(world.intent) === 'FRESHNESS_SENSITIVE', JSON.stringify(world)),
    check('round_01_social_path', socialCheckinPhasePath().join('>') === 'ROUND_CREATED>CLASSIFYING>DELIBERATING>COMPLETE', 'path'),
    check('round_02_illegal_transition', !canTransitionRoundPhase('COMPLETE', 'RESEARCHING'), 'complete→research'),
    check('floor_01_order', floor.join(',') === 'chatgpt,claude,grok,gemini,red_team', floor.join(',')),
    check('floor_04_healthy_roster_skips_unhealthy', resolveVisibleFloorOrder({
      configured: { chatgpt: true, claude: true, grok: true, gemini: true, red_team: true },
      eligible: { chatgpt: true, claude: false, grok: false, gemini: true, red_team: false },
      includeRedTeam: true,
    }).join(',') === 'chatgpt,gemini', 'healthy floor'),
    check('floor_02_one_visible', visibleConcurrentFamilies(snap) === 1 && snap.current === 'chatgpt', JSON.stringify(snap)),
    check('floor_03_next', nextEligibleFloor(participants.map(p => p.family === 'chatgpt' ? { ...p, state: 'COMPLETE' } : p)) === 'claude', 'next'),
    check('stream_01_anthropic_not_openai', anthropicDeltaFromFixture() === 'Present.', 'anthropic'),
    check('stream_02_openai_delta', openaiChunk === 'Hello', String(openaiChunk)),
    check('stream_03_gemini_single_line_sse', (() => {
      const { frames, rest } = splitSseFrames('data: {"candidates":[{"content":{"parts":[{"text":"OK"}]}}]}\n')
      const parsed = parseSseFrame(frames[0] ?? rest)
      const data = JSON.parse(parsed.data) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      return data.candidates?.[0]?.content?.parts?.[0]?.text === 'OK'
    })(), 'gemini sse'),
    check('retry_01_no_retry_after_visible', retryVisible === false, 'visible'),
    check('retry_02_no_retry_auth', retryAuth === false, 'auth'),
    check('retry_03_retry_5xx_before_token', retry5xx === true, '5xx'),
    check('retry_04_max', MAX_TRANSIENT_RETRIES_BEFORE_VISIBLE_TOKEN === 1, 'max1'),
    check('timeout_01_distinct', (() => {
      const b = resolveStreamTimeoutBudget('social')
      return b.firstTokenMs !== b.idleMs && b.overallMs > b.firstTokenMs
    })(), 'timeouts'),
    check('fail_01_401_auth', classifyProviderFailure({ httpStatus: 401 }) === 'AUTH', '401'),
    check('fail_02_429', classifyProviderFailure({ httpStatus: 429 }) === 'RATE_LIMIT', '429'),
    check('fail_06_billing_400_not_rate_limit', classifyProviderFailure({ httpStatus: 400, message: 'credit balance too low' }) === 'BILLING', 'billing'),
    check('fail_07_incorrect_key_auth', classifyProviderFailure({ httpStatus: 400, message: 'Incorrect API key provided' }) === 'AUTH', 'auth'),
    check('fail_03_timeout', classifyProviderFailure({ httpStatus: 'timeout', abortReason: 'first_token' }) === 'TIMEOUT', 'timeout'),
    check('fail_04_persistence_not_provider', classifyProviderFailure({ persistenceError: true, httpStatus: 200 }) === 'PERSISTENCE', 'persist'),
    check('fail_05_ui_compact', failureUiLabel('Claude', 'TIMEOUT', 'first token').includes('Claude · FAILED'), 'ui'),
    check('memory_01_hi', decideMemoryCandidatePrompt({ commanderText: 'Hi council', anySuccess: true }).shouldPrompt === false, 'hi mem'),
    check('memory_02_checkin', checkInMem.shouldPrompt === false, checkInMem.reason),
    check('memory_03_thanks', thanksMem.shouldPrompt === false, thanksMem.reason),
    check('memory_04_okay', decideMemoryCandidatePrompt({ commanderText: 'Okay', anySuccess: true }).shouldPrompt === false, 'okay'),
    check('memory_05_status', decideMemoryCandidatePrompt({ commanderText: 'status check', anySuccess: true }).shouldPrompt === false, 'status'),
    check('memory_06_durable', durableMem.shouldPrompt === true && durableMem.durable, durableMem.reason),
    check('health_01_levels', healthLevelFromProbe({ configured: true, streamingOk: true }).level === 'STREAMING_HEALTH', 'stream health'),
    check('idempotency_01', attemptIdFor({ roundId: 'r1', family: 'claude', stage: 'RESPONSE', attempt: 2 }).includes('attempt-2')
      && logicalMessageIdFor({ roundId: 'r1', family: 'claude', stage: 'RESPONSE' }) === 'r1:claude:RESPONSE', 'ids'),
    check('isolation_01_social_no_research', !checkIn.shouldResearch && !hi.shouldResearch, 'no research'),
    check('roster_01_unhealthy_not_floor_eligible', (() => {
      const snap = buildCouncilRosterSnapshot({
        configured: { chatgpt: true, claude: true, grok: true, gemini: true, red_team: true },
        overrides: { claude: 'UNAVAILABLE_BILLING', grok: 'UNAVAILABLE_AUTH' },
      })
      return snap.families.chatgpt?.floorEligible === true
        && snap.families.gemini?.floorEligible === true
        && snap.families.claude?.floorEligible === false
        && snap.families.grok?.floorEligible === false
        && snap.families.claude?.unavailableReason === 'UNAVAILABLE_BILLING'
        && snap.families.grok?.unavailableReason === 'UNAVAILABLE_AUTH'
        && snap.redTeam === 'SKIPPED_BY_POLICY'
        && snap.degradedByRoster
        && snap.activeFloorFamilies.join(',') === 'chatgpt,gemini'
    })(), 'roster'),
  ]
}

export function runLiveCouncilOrchestrationValidationSummary(): { passed: number; total: number; failed: string[] } {
  const results = runLiveCouncilOrchestrationValidation()
  const failed = results.filter(r => !r.pass).map(r => r.name)
  return { passed: results.length - failed.length, total: results.length, failed }
}
