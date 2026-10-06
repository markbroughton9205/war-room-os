import { classifyCouncilPath } from './pathClassifier'
import { runShortPathRuntime } from './shortPathRuntime'
import { commanderTurnFromText } from './multimodalEnvelope'
import { qualityShortPathCompleter } from './qualityCompleter'
import { classifyToolNeed } from './toolNeed'
import { resolveFollowUpText } from './conversationContext'
import { selectAgentsForMission, neverDefaultSix } from './agentSelectionPolicy'
import { orionInvestigate, orionProseIsInvalid } from './orionIntelligence'
import { pulsarSourceQuality, pulsarUncitedCurrentClaim } from './pulsarIntelligence'
import { novaSafeCalculate, novaNormalizeTable } from './novaIntelligence'
import { phoenixChallenge, verifyClaimLumen } from '@/lib/council/evidence-board/verify'
import { createEvidenceBoard } from '@/lib/council/evidence-board/board'
import { formatCommanderBrief } from '@/lib/council/evidence-board/orchestrator'
import { classifyEvidenceBoardMission } from '@/lib/council/evidence-board/classifier'
import { toCommanderFacing, publicBodyHasInternalIds, auroraAnswersFirst, hasDuplicatedUnknownBlocks } from './responseLayer'
import { recoverFromToolFailure, publicFailureHasInternalCodes } from './failureRecovery'
import { selectShortPathModelTarget, shortPathPlacementTruth } from './shortPathCompleter'
import { resolveReasoningBudget } from './budgetPolicy'
import { WAR_ROOM_GOLD_PROMPTS } from './goldPrompts'
import type { PathClassifierResult } from './types'
import type { EbcClaim, EbcEvidence, EbcMissionClass } from '@/lib/council/evidence-board/types'

type Case = { caseId: string; description: string; result: 'PASS' | 'FAIL'; details: string }

function check(caseId: string, description: string, ok: boolean, details: unknown = ''): Case {
  return { caseId, description, result: ok ? 'PASS' : 'FAIL', details: typeof details === 'string' ? details : JSON.stringify(details) }
}

function ebcClassForGold(classified: PathClassifierResult): EbcMissionClass {
  switch (classified.mission_class) {
    case 'SYSTEM_STATUS':
    case 'DEEP_RESEARCH':
    case 'ARCHITECTURE_REVIEW':
    case 'INCIDENT_RESPONSE':
    case 'ENGINEERING':
    case 'CURRENT_INTEL':
    case 'DOCUMENT_ANALYSIS':
    case 'SOCIAL_CHECKIN':
      return classified.mission_class
    default:
      return 'DEEP_RESEARCH'
  }
}

async function short(text: string, prior: string[] = []) {
  const envelope = commanderTurnFromText({ text, room_id: 'room-1', session_id: 'sess-1' })
  envelope.context.prior_turns = prior
  return runShortPathRuntime({
    envelope,
    path: 'SHORT_PATH',
    allow_tools: true,
    tool_allowlist: ['council.calc.simple'],
    model_route: { lane: 'classify_or_short', placement: 'NONE' },
  }, qualityShortPathCompleter)
}

function boardWith(claims: EbcClaim[], evidence: EbcEvidence[]) {
  const board = createEvidenceBoard({
    mission_id: 'm1',
    mission_class: 'DEEP_RESEARCH',
    question: 'test',
    agents: ['PHOENIX', 'LUMEN', 'AURORA'],
    ttl_seconds: 120,
    budget_tokens: 1000,
    budget_ms: 1000,
  })
  const stamp = { mission_id: 'm1', timestamp: new Date().toISOString(), provenance: 'gi-eng-02' }
  board.claims.push(...claims.map(claim => ({ ...claim, ...stamp })))
  board.evidence.push(...evidence.map(row => ({ ...row, ...stamp })))
  return board
}

export async function runGiEng02Validation(): Promise<Case[]> {
  const cases: Case[] = []

  const hi = await short('hi')
  cases.push(check('CONV-1', 'hi is natural short, no seats', hi.seats_used.length === 0 && /hi|here|work on/i.test(hi.body.summary) && !/here is a direct answer/i.test(hi.body.summary), hi.body.summary))

  const t1 = "I'm thinking about moving Browser Broker auth into the keyring."
  const t2 = await short('What would that break?', [t1])
  const mem = resolveFollowUpText('What would that break?', [t1])
  cases.push(check('CONV-2', 'multi-turn pronoun resolves', mem.preserved_session && /keyring/i.test(t2.body.summary), t2.body.summary))
  const t3 = await short('Would Foundry be affected?', [t1, 'What would that break?'])
  cases.push(check('MEM-1', 'follow-up preserves referent', /foundry/i.test(t3.body.summary) && /keyring|profile|playwright/i.test(t3.body.summary), t3.body.summary))
  cases.push(check('MEM-2', 'session continuity preserved', t3.telemetry?.turn_id != null && t3.path_used === 'SHORT_PATH', t3.telemetry))

  const brainstorm = classifyCouncilPath('what do you think about sparse experts?')
  cases.push(check('CONV-3', 'casual brainstorming stays short path', brainstorm.path === 'SHORT_PATH', brainstorm))

  const http = classifyToolNeed('What is HTTP?')
  const httpOut = await short('What is HTTP?')
  cases.push(check('QA-1', 'general knowledge without unnecessary tools', http.use_tool === false && httpOut.tool_trace_public.length === 0, http))
  const current = classifyCouncilPath("What's the current version of Playwright?")
  cases.push(check('QA-2', 'current fact triggers tool path', current.path === 'AGENT_PATH' && current.tool_need === 'BROWSER_SEARCH', current))
  const math = await short('2+2')
  cases.push(check('QA-3', 'simple math correct', math.body.summary.trim() === '4', math.body.summary))

  cases.push(check('ROUTE-1', 'coding explanation stays short path', classifyCouncilPath('what does this function do?').path === 'SHORT_PATH', classifyCouncilPath('what does this function do?')))
  cases.push(check('ROUTE-2', 'repo mutation goes Foundry', classifyCouncilPath('fix this function in the repo').path === 'HANDOFF' && classifyCouncilPath('fix this function in the repo').handoff_target === 'FOUNDRY', classifyCouncilPath('fix this function in the repo')))
  cases.push(check('ROUTE-3', 'current web research goes agent path', classifyCouncilPath('research current sparse-expert inference systems with sources').path === 'AGENT_PATH', classifyCouncilPath('research current sparse-expert inference systems with sources')))
  cases.push(check('ROUTE-4', 'incident goes agent path', classifyCouncilPath('my browser just broke').path === 'AGENT_PATH' && classifyCouncilPath('my browser just broke').mission_class === 'INCIDENT_RESPONSE', classifyCouncilPath('my browser just broke')))

  const ramLive = classifyCouncilPath('check how much RAM War Room is using right now')
  cases.push(check('ROUTE-RAM', 'live RAM is agent/system probe', ramLive.path === 'AGENT_PATH' && ramLive.tool_need === 'SYSTEM_PROBE', ramLive))
  cases.push(check('ROUTE-VRAM', 'RAM vs VRAM stays short', classifyCouncilPath("what's the difference between RAM and VRAM?").path === 'SHORT_PATH', classifyCouncilPath("what's the difference between RAM and VRAM?")))
  cases.push(check('ROUTE-BUILD', 'build better Broker is Foundry handoff', classifyCouncilPath('build me a better Browser Broker').path === 'HANDOFF', classifyCouncilPath('build me a better Browser Broker')))

  const why = classifyCouncilPath({ text: 'why?', prior_turns: [t1] })
  cases.push(check('FOLLOW-1', 'short why is not social checkin', why.path === 'SHORT_PATH' && why.mission_class !== 'SOCIAL_CHECKIN', why))

  const status = selectAgentsForMission({ mission_class: 'SYSTEM_STATUS', text: 'Status on War Room' })
  cases.push(check('AGENT-1', 'simple agent task does not use six seats', neverDefaultSix(status) && status.selected_agents.length <= 4, status))
  const sheet = selectAgentsForMission({ mission_class: 'DOCUMENT_ANALYSIS', text: 'normalize this spreadsheet', structured_data: true })
  cases.push(check('AGENT-2', 'spreadsheet chooses NOVA', sheet.selected_agents[0] === 'NOVA' && sheet.selected_agents.includes('LUMEN') && !sheet.selected_agents.includes('PULSAR'), sheet))
  const intel = selectAgentsForMission({ mission_class: 'CURRENT_INTEL', text: 'current headlines' })
  cases.push(check('AGENT-3', 'current intel chooses PULSAR', intel.selected_agents[0] === 'PULSAR' && intel.selected_agents.includes('AURORA'), intel))
  const verifyHeavy = selectAgentsForMission({ mission_class: 'SYSTEM_STATUS', text: 'Status on War Room', verification_need: true })
  cases.push(check('AGENT-4', 'verification-heavy status includes LUMEN', verifyHeavy.selected_agents.includes('LUMEN'), verifyHeavy))

  const arch = selectAgentsForMission({ mission_class: 'ARCHITECTURE_REVIEW', text: 'how should the session types be split' })
  cases.push(check('AGENT-ARCH', 'simple architecture is not six and includes ORION+AURORA', arch.selected_agents.includes('ORION') && arch.selected_agents.includes('AURORA') && arch.selected_agents.length <= 4, arch))

  const strongEv: EbcEvidence = {
    evidence_id: 'e1', kind: 'live_telemetry', summary: 'core health 200', pointer: 'http://127.0.0.1:3847/a', source: 'wr.core.health', url: 'http://127.0.0.1:3847/a', retrieved_at: new Date().toISOString(), tool_name: 'wr.core.health', ok: true, temporal_layer: 'CURRENT_LIVE', agent_id: 'ORION', round: 1,
  }
  const strongEv2: EbcEvidence = { ...strongEv, evidence_id: 'e2', pointer: 'http://127.0.0.1:3848/b', url: 'http://127.0.0.1:3848/b', tool_name: 'wr.ui.health' }
  const strongClaim: EbcClaim = { claim_id: 'c-strong', text: 'core health 200', status: 'PROPOSED', evidence_ids: ['e1', 'e2'], confidence: 0.9, label: 'VERIFIED_FACT', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'ORION', round: 1 }
  const px1 = phoenixChallenge({ board: boardWith([strongClaim], [strongEv, strongEv2]), pass: 1 })
  cases.push(check('PHOENIX-1', 'strong evidence → no challenge', (px1.challenges?.length ?? 0) === 0 && px1.rhetoric_only === true, px1))

  const thinClaim: EbcClaim = { claim_id: 'c-thin', text: 'War Room is READY', status: 'PROPOSED', evidence_ids: [], confidence: 0.9, label: 'INFERENCE', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'ORION', round: 1 }
  const px2 = phoenixChallenge({ board: boardWith([thinClaim], []), pass: 1 })
  const ch = px2.challenges?.[0]
  cases.push(check('PHOENIX-2', 'thin high-impact claim → valid challenge', Boolean(ch && ch.claim_id && ch.challenge_type && ch.weakness && ch.why_it_matters && ch.evidence_or_test_needed && ch.resolution_condition) && px2.rhetoric_only === false, ch))

  const dup: EbcEvidence = {
    evidence_id: 'd1', kind: 'primary_external', summary: 'Playwright 1.48 release', pointer: 'https://example.com/a', url: 'https://example.com/a', retrieved_at: new Date().toISOString(), tool_name: 'broker.fetch', ok: true, temporal_layer: 'CURRENT_LIVE', agent_id: 'PULSAR', round: 1,
  }
  const dup2: EbcEvidence = { ...dup, evidence_id: 'd2', pointer: 'https://example.com/a?utm_source=twitter', url: 'https://example.com/a?utm_source=twitter' }
  const dupClaim: EbcClaim = { claim_id: 'c-dup', text: 'Playwright 1.48 release is current', status: 'PROPOSED', evidence_ids: ['d1', 'd2'], confidence: 0.8, label: 'VERIFIED_FACT', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'PULSAR', round: 1 }
  const lumenDup = verifyClaimLumen({ claim: dupClaim, evidence: [dup, dup2], ttlSeconds: 600, missionClass: 'DEEP_RESEARCH', rechecked: [] })
  cases.push(check('LUMEN-1', 'duplicate source is not independent corroboration', lumenDup.duplicate_source === true && lumenDup.independent_corroboration === false && lumenDup.verdict !== 'SUPPORTED', lumenDup))

  const stale: EbcEvidence = { ...dup, evidence_id: 's1', retrieved_at: '2020-01-01T00:00:00.000Z', temporal_layer: 'LAST_VERIFIED', url: 'https://example.com/old', pointer: 'https://example.com/old' }
  const staleClaim: EbcClaim = { ...dupClaim, claim_id: 'c-stale', evidence_ids: ['s1'], text: 'Playwright current version is 1.48' }
  const lumenStale = verifyClaimLumen({ claim: staleClaim, evidence: [stale], ttlSeconds: 120, missionClass: 'CURRENT_INTEL', rechecked: [] })
  cases.push(check('LUMEN-2', 'stale source cannot verify current claim', lumenStale.verdict === 'UNKNOWN' || lumenStale.verdict === 'UNSUPPORTED', lumenStale))

  const classification = classifyEvidenceBoardMission({ commanderMessage: 'Status on War Room' })
  const auroraBoard = createEvidenceBoard({
    mission_id: classification.mission_id,
    mission_class: 'SYSTEM_STATUS',
    question: 'Status on War Room',
    agents: classification.selected_agents,
    ttl_seconds: 120,
    budget_tokens: 1000,
    budget_ms: 1000,
  })
  const brief = formatCommanderBrief(classification, {
    mission_class: 'SYSTEM_STATUS',
    completion_state: 'TOOL_BLOCKED',
    confidence: 0.71,
    verified_facts: [],
    partially_verified: [],
    unverified: [],
    conflicts: [],
    unknowns: ['TOOL_BLOCKED e-1234 CURRENT_LIVE'],
    tool_blocks: ['broker.fetch: denied'],
    risks: [],
    next_actions: [{ action: 'Retry the browser probe', owner: 'Commander' }],
    advisory: true,
    commander_authority: 'REQUIRED_FOR_ACTION',
  }, auroraBoard)
  cases.push(check('AURORA-1', 'final answer contains no claim IDs', !publicBodyHasInternalIds(brief) && !/claim_/i.test(brief), brief))
  cases.push(check('AURORA-2', 'answers Commander question first', auroraAnswersFirst(brief, 'Status on War Room') && !/^WAR ROOM STATUS/i.test(brief), brief))
  cases.push(check('AURORA-3', 'no duplicated unknown/tool-block text', !hasDuplicatedUnknownBlocks(brief) && !/confidence 0\.71/i.test(brief), brief))
  cases.push(check('FAIL-2', 'unrecoverable failure reported naturally', /couldn'?t verify|could not verify/i.test(brief) && !publicFailureHasInternalCodes(brief), brief))

  const tool1 = classifyToolNeed('What is HTTP?')
  const tool2 = classifyToolNeed("What's the current version of Playwright?")
  cases.push(check('TOOL-1', 'tool not used when unnecessary', tool1.use_tool === false, tool1))
  cases.push(check('TOOL-2', 'tool used when current reality required', tool2.use_tool === true && tool2.need === 'BROWSER_SEARCH', tool2))

  const fail = recoverFromToolFailure({ tool_name: 'broker.fetch', ok: false, remaining_ok: 1 })
  cases.push(check('FAIL-1', 'single research tool failure can recover', fail.continue_mission === true && Boolean(fail.alternate) && !publicFailureHasInternalCodes(fail.commander_text), fail))

  const fast = resolveReasoningBudget('quick answer: why does War Room need RAM if the model is remote?', 'SHORT_PATH')
  const deep = resolveReasoningBudget('deep research current sparse expert inference techniques using primary sources', 'AGENT_PATH')
  cases.push(check('BUDGET-1', 'quick answer avoids deep mission', fast.budget === 'FAST' && fast.path_bias === 'SHORT_PATH', fast))
  cases.push(check('BUDGET-2', 'deep research uses deep path', deep.budget === 'DEEP' && deep.path_bias === 'AGENT_PATH', deep))

  const placement = shortPathPlacementTruth({ model_invoked: false, placement: 'CLOUD' })
  const shortTarget = selectShortPathModelTarget()
  cases.push(check('PLACEMENT-1', 'placement label truthful', placement === 'NONE' && shortTarget.placement !== 'LOCAL', { placement, selected: shortTarget.placement, reason: shortTarget.reason }))

  const orion = orionInvestigate('check how much RAM War Room is using right now')
  cases.push(check('ORION-1', 'root-cause hypothesis with falsifier', orion[0].falsify.length > 0 && orion[0].probe.length > 0 && !orionProseIsInvalid(orion[0].hypothesis), orion[0]))

  const pulsar = pulsarSourceQuality([{ url: 'https://a.example/x', retrieved_at: new Date().toISOString(), primary: true, recency: 'current' }])
  cases.push(check('PULSAR-1', 'single current source is not enough when multi required', pulsar.ok === false, pulsar))
  cases.push(check('PULSAR-2', 'uncited current claim detected', pulsarUncitedCurrentClaim('Playwright is currently 1.99', []) === true, 'ok'))

  const quant = novaSafeCalculate('45 * 72')
  cases.push(check('NOVA-1', 'NOVA calculates with a tool expression', quant.ok === true && quant.value === 3240, quant))
  cases.push(check('NOVA-2', 'NOVA refuses hallucinated free-form math', novaSafeCalculate('whatever the market did').ok === false, novaSafeCalculate('whatever the market did')))
  const table = novaNormalizeTable([{ b: 2, a: 1 }])
  cases.push(check('NOVA-3', 'NOVA normalizes tables', table.novelty === 'NEW_STRUCTURE' && table.columns.includes('a') && table.columns.includes('b'), table))

  const facing = toCommanderFacing({
    schema_version: 'war-room.output-envelope.v1',
    output_id: 'o1',
    in_reply_to: 't1',
    path: 'SHORT_PATH',
    path_used: 'SHORT_PATH',
    completion_state: 'UNVERIFIED',
    advisory: true,
    body: { summary: 'HTTP is a request protocol. claim_id=c1 TOOL_BLOCKED', unknowns: [], risks: [] },
    artifacts: [],
    tool_trace_public: [],
    seats_used: [],
    authority_decisions: [],
    next_actions: [],
    placement: 'NONE',
  })
  cases.push(check('STYLE-1', 'response layer strips internal jargon', !publicBodyHasInternalIds(facing.text), facing.text))

  for (const gold of WAR_ROOM_GOLD_PROMPTS) {
    const classified = classifyCouncilPath({ text: gold.prompt, prior_turns: gold.prior ?? [] })
    const seats = classified.path === 'AGENT_PATH'
      ? selectAgentsForMission({ mission_class: ebcClassForGold(classified), text: gold.prompt }).selected_agents.length
      : 0
    const pathOk = classified.path === gold.expected_path
    const seatsOk = seats <= gold.expected_seats_max
    const toolOk = gold.tool === 'NONE'
      ? classified.tool_need === 'NONE' || classified.tools_needed_est === 0
      : classified.tool_need === gold.tool || classified.path === gold.expected_path
    cases.push(check(gold.id, `${gold.prompt.slice(0, 64)} → ${gold.expected_path}`, pathOk && seatsOk && toolOk, { path: classified.path, seats, tool: classified.tool_need, mission: classified.mission_class }))
  }

  const classifierHi = classifyCouncilPath('hi')
  cases.push(check('CONF-1', 'high-confidence greeting routes directly', classifierHi.confidence >= 0.9 && !classifierHi.clarifying_question, classifierHi))
  cases.push(check('AMBIG-1', 'classifier exposes ambiguities[] and escalation_allowed', Array.isArray(classifierHi.ambiguities) && typeof classifierHi.escalation_allowed === 'boolean', classifierHi))

  return cases
}
