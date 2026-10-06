import { classifyCouncilPath } from './pathClassifier'
import { classifyToolNeed } from './toolNeed'
import { selectAgentsForMission, neverDefaultSix } from './agentSelectionPolicy'
import { orionInvestigate, orionProseIsInvalid } from './orionIntelligence'
import { phoenixChallenge, verifyClaimLumen } from '@/lib/council/evidence-board/verify'
import { createEvidenceBoard } from '@/lib/council/evidence-board/board'
import { classifyEvidenceBoardMission } from '@/lib/council/evidence-board/classifier'
import { maybeHandleGiFrontDoor } from './frontDoor'
import { createTypedHandoff } from './handoff'
import { evaluateAuthority } from './authorityMatrix'
import { publicBodyHasInternalIds } from './responseLayer'
import { recoverFromToolFailure, publicFailureHasInternalCodes } from './failureRecovery'
import { qualityShortPathCompleter } from './qualityCompleter'
import { createModelBackedShortPathCompleter, isGiEng02ShortPathCompleteEnabled } from './shortPathCompleter'
import { isGiEng01ShortPathEnabled } from './featureFlag'
import { commanderTurnFromText } from './multimodalEnvelope'
import { OPEN_WORLD_PROMPTS, ADVERSARIAL_PROMPTS } from './gi.eng03.prompts'
import type { EbcClaim, EbcEvidence } from '@/lib/council/evidence-board/types'

export type GiEng03Case = {
  lane: 'UNIT' | 'INTEGRATION' | 'LIVE'
  caseId: string
  description: string
  result: 'PASS' | 'FAIL' | 'SKIP'
  details: string
}

function check(lane: GiEng03Case['lane'], caseId: string, description: string, ok: boolean, details: unknown = ''): GiEng03Case {
  return { lane, caseId, description, result: ok ? 'PASS' : 'FAIL', details: typeof details === 'string' ? details : JSON.stringify(details) }
}

function routePrompt(prompt: string, prior: string[] = []) {
  const classified = classifyCouncilPath({ text: prompt, prior_turns: prior })
  const tool = classifyToolNeed(prompt)
  return { classified, tool }
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
  const stamp = { mission_id: 'm1', timestamp: new Date().toISOString(), provenance: 'gi-eng-03' }
  board.claims.push(...claims.map(claim => ({ ...claim, ...stamp })))
  board.evidence.push(...evidence.map(row => ({ ...row, ...stamp })))
  return board
}

export function runGiEng03Unit(): GiEng03Case[] {
  const cases: GiEng03Case[] = []
  cases.push(check('UNIT', 'FLAG-01', 'production GI_ENG_01_SHORT_PATH remains off in this process', isGiEng01ShortPathEnabled() === false, { flag: process.env.GI_ENG_01_SHORT_PATH ?? null }))
  cases.push(check('UNIT', 'FLAG-02', 'GI_ENG_02_SHORT_PATH_COMPLETE is off in the default process', isGiEng02ShortPathCompleteEnabled() === false, process.env.GI_ENG_02_SHORT_PATH_COMPLETE ?? 'unset'))

  for (const row of [...OPEN_WORLD_PROMPTS, ...ADVERSARIAL_PROMPTS]) {
    const { classified, tool } = routePrompt(row.prompt, row.prior ?? [])
    const pathOk = classified.path === row.expected_path
    const toolOk = !row.tool || row.tool === 'NONE'
      ? classified.tool_need === 'NONE' || classified.tools_needed_est === 0 || tool.need === 'NONE' || row.expected_path !== 'SHORT_PATH'
      : classified.tool_need === row.tool || tool.need === row.tool
    const clarifyOk = row.clarify ? Boolean(classified.clarifying_question) || classified.ambiguous : true
    const browserLeak = row.tool === 'NONE' && /look at this idea|check this out|fix this sentence/i.test(row.prompt) && classified.tool_need === 'BROWSER_SEARCH'
    cases.push(check('UNIT', row.id, `${row.prompt.slice(0, 72)} → ${row.expected_path}`, pathOk && toolOk && clarifyOk && !browserLeak, {
      path: classified.path,
      tool: classified.tool_need,
      need: tool.need,
      clarify: classified.clarifying_question ?? null,
      mission: classified.mission_class,
    }))
  }

  const conv = classifyCouncilPath("What's up Council?")
  cases.push(check('UNIT', 'CONV-A1', 'casual whats-up is SHORT with no seats', conv.path === 'SHORT_PATH' && conv.seats_recommended.length === 0, conv))
  const rewriteAfterResearch = classifyCouncilPath({
    text: 'Anyway, make that rewrite more concise.',
    prior_turns: [
      'Rewrite this professionally:\nwe need to fix the browser before we add more stuff because it keeps breaking',
      'Tell me about sparse experts.',
      'Now research the latest sparse expert inference work using primary sources.',
    ],
  })
  cases.push(check('UNIT', 'CONV-REWRITE-AFTER-RESEARCH', 'rewrite after research stays SHORT and does not inherit DEEP_RESEARCH', rewriteAfterResearch.path === 'SHORT_PATH' && rewriteAfterResearch.mission_class === 'FORMAT', rewriteAfterResearch))

  const http = classifyToolNeed('What is HTTP?')
  const play = classifyCouncilPath("What's the current Playwright version?")
  const ram = classifyCouncilPath('How much RAM is War Room using right now?')
  const shot = classifyToolNeed('What does this screenshot show?')
  const math = classifyCouncilPath('2+2')
  cases.push(check('UNIT', 'TOOL-HTTP', 'HTTP does not need Browser', http.use_tool === false, http))
  cases.push(check('UNIT', 'TOOL-PW', 'current Playwright uses Browser path', play.path === 'AGENT_PATH' && play.tool_need === 'BROWSER_SEARCH', play))
  cases.push(check('UNIT', 'TOOL-RAM', 'live RAM uses system probe', ram.path === 'AGENT_PATH' && ram.tool_need === 'SYSTEM_PROBE', ram))
  cases.push(check('UNIT', 'TOOL-SHOT', 'screenshot is VISION not Browser', shot.need === 'VISION' && shot.use_tool === true, shot))
  cases.push(check('UNIT', 'TOOL-MATH', '2+2 stays short/calculator', math.path === 'SHORT_PATH', math))

  const explain = classifyCouncilPath('Explain what the PathClassifier does.')
  const mutate = classifyCouncilPath('Change the PathClassifier in the repo so it handles X.')
  cases.push(check('UNIT', 'FOUNDRY-EXPLAIN', 'explanation is SHORT', explain.path === 'SHORT_PATH', explain))
  cases.push(check('UNIT', 'FOUNDRY-CHANGE', 'repo change is Foundry handoff', mutate.path === 'HANDOFF' && mutate.handoff_target === 'FOUNDRY', mutate))
  const handoff = createTypedHandoff({ text: mutate.reason, room_id: 'room-1', session_id: 'sess-1', target: 'FOUNDRY' })
  cases.push(check('UNIT', 'FOUNDRY-EXEC', 'handoff executed=false', handoff.target === 'FOUNDRY' && handoff.executed === false, handoff))
  const auth = evaluateAuthority({ tool_id: 'foundry.handoff', path: 'HANDOFF', capability_available: true })
  cases.push(check('UNIT', 'AUTH-FOUNDRY', 'capability does not execute Foundry', auth.executed === false, auth))

  const status = selectAgentsForMission({ mission_class: 'SYSTEM_STATUS', text: 'Status on War Room' })
  const intel = selectAgentsForMission({ mission_class: 'CURRENT_INTEL', text: 'current headlines' })
  const arch = selectAgentsForMission({ mission_class: 'ARCHITECTURE_REVIEW', text: 'architecture review of session types' })
  const incident = selectAgentsForMission({ mission_class: 'INCIDENT_RESPONSE', text: 'screenshots crash Chromium' })
  const sheet = selectAgentsForMission({ mission_class: 'DOCUMENT_ANALYSIS', text: 'normalize this spreadsheet', structured_data: true })
  cases.push(check('UNIT', 'SEAT-STATUS', 'status not six, has ORION/LUMEN/PHOENIX/AURORA', neverDefaultSix(status) && ['ORION', 'LUMEN', 'PHOENIX', 'AURORA'].every(id => status.selected_agents.includes(id as 'ORION')), status))
  cases.push(check('UNIT', 'SEAT-INTEL', 'current intel is Pulsar-led', intel.selected_agents[0] === 'PULSAR' && neverDefaultSix(intel), intel))
  cases.push(check('UNIT', 'SEAT-ARCH', 'architecture includes ORION+AURORA not six', arch.selected_agents.includes('ORION') && arch.selected_agents.includes('AURORA') && neverDefaultSix(arch), arch))
  cases.push(check('UNIT', 'SEAT-INCIDENT', 'incident has ORION+LUMEN+PHOENIX+AURORA', ['ORION', 'LUMEN', 'PHOENIX', 'AURORA'].every(id => incident.selected_agents.includes(id as 'ORION')), incident))
  cases.push(check('UNIT', 'SEAT-DOC', 'spreadsheet is Nova-led', sheet.selected_agents[0] === 'NOVA', sheet))

  const orion = orionInvestigate('Browser navigation works but screenshots crash Chromium. Investigate.')
  cases.push(check('UNIT', 'ORION-1', 'hypothesis + probe + falsifier, no drama', orion[0].probe.length > 0 && orion[0].falsify.length > 0 && !orionProseIsInvalid(orion[0].hypothesis), orion[0]))

  const dup: EbcEvidence = {
    evidence_id: 'd1', kind: 'primary_external', summary: 'Playwright 1.48 release notes', pointer: 'https://example.com/a', url: 'https://example.com/a', retrieved_at: new Date().toISOString(), tool_name: 'broker.fetch', ok: true, temporal_layer: 'CURRENT_LIVE', agent_id: 'PULSAR', round: 1,
  }
  const dup2: EbcEvidence = { ...dup, evidence_id: 'd2', pointer: 'https://example.com/a?utm_source=x', url: 'https://example.com/a?utm_source=x' }
  const claim: EbcClaim = { claim_id: 'c-dup', text: 'Playwright 1.48 release notes are current', status: 'PROPOSED', evidence_ids: ['d1', 'd2'], confidence: 0.8, label: 'VERIFIED_FACT', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'PULSAR', round: 1 }
  const lumenDup = verifyClaimLumen({ claim, evidence: [dup, dup2], ttlSeconds: 600, missionClass: 'DEEP_RESEARCH', rechecked: [] })
  cases.push(check('UNIT', 'LUMEN-DUP', 'duplicate URL is not independent corroboration', lumenDup.duplicate_source === true && lumenDup.verdict !== 'SUPPORTED', lumenDup))
  const stale: EbcEvidence = { ...dup, evidence_id: 's1', retrieved_at: '2020-01-01T00:00:00.000Z', temporal_layer: 'LAST_VERIFIED', url: 'https://example.com/old', pointer: 'https://example.com/old' }
  const lumenStale = verifyClaimLumen({ claim: { ...claim, claim_id: 'c-stale', evidence_ids: ['s1'], text: 'Playwright current version is 1.48' }, evidence: [stale], ttlSeconds: 120, missionClass: 'CURRENT_INTEL', rechecked: [] })
  cases.push(check('UNIT', 'LUMEN-STALE', 'stale cannot verify current', lumenStale.verdict === 'UNKNOWN' || lumenStale.verdict === 'UNSUPPORTED', lumenStale))

  const strongEv: EbcEvidence = { evidence_id: 'e1', kind: 'live_telemetry', summary: 'core health 200', pointer: 'http://127.0.0.1:3847/a', url: 'http://127.0.0.1:3847/a', retrieved_at: new Date().toISOString(), tool_name: 'wr.core.health', ok: true, temporal_layer: 'CURRENT_LIVE', agent_id: 'ORION', round: 1 }
  const strongEv2: EbcEvidence = { ...strongEv, evidence_id: 'e2', pointer: 'http://127.0.0.1:3848/b', url: 'http://127.0.0.1:3848/b', tool_name: 'wr.ui.health' }
  const strongClaim: EbcClaim = { claim_id: 'c-strong', text: 'core health 200', status: 'PROPOSED', evidence_ids: ['e1', 'e2'], confidence: 0.9, label: 'VERIFIED_FACT', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'ORION', round: 1 }
  const px1 = phoenixChallenge({ board: boardWith([strongClaim], [strongEv, strongEv2]), pass: 1 })
  const thin: EbcClaim = { claim_id: 'c-thin', text: 'War Room is READY', status: 'PROPOSED', evidence_ids: [], confidence: 0.9, label: 'INFERENCE', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'ORION', round: 1 }
  const px2 = phoenixChallenge({ board: boardWith([thin], []), pass: 1 })
  cases.push(check('UNIT', 'PHOENIX-STRONG', 'strong evidence is not challenged', (px1.challenges?.length ?? 0) === 0, px1))
  cases.push(check('UNIT', 'PHOENIX-THIN', 'thin READY gets structured challenge', Boolean(px2.challenges?.[0]?.challenge_type && px2.challenges?.[0]?.resolution_condition) && px2.rhetoric_only === false, px2.challenges?.[0]))

  const fail = recoverFromToolFailure({ tool_name: 'broker.fetch', ok: false, remaining_ok: 0 })
  cases.push(check('UNIT', 'FAIL-BROWSER', 'browser failure is natural', /couldn'?t verify|could not/i.test(fail.commander_text) && !publicFailureHasInternalCodes(fail.commander_text), fail))

  return cases
}

export async function runGiEng03Integration(): Promise<GiEng03Case[]> {
  const cases: GiEng03Case[] = []
  const off = await maybeHandleGiFrontDoor({ text: 'hi', env: { GI_ENG_01_SHORT_PATH: '0' } })
  cases.push(check('INTEGRATION', 'INT-FLAG-OFF', 'front door idle when GI_ENG_01 is off', off === null, off))
  const hi = await maybeHandleGiFrontDoor({ text: "What's up Council?", env: { GI_ENG_01_SHORT_PATH: '1' }, roomId: 'room-live', sessionId: 'sess-live' })
  cases.push(check('INTEGRATION', 'INT-SHORT', 'isolated GI_ENG_01 intercepts casual SHORT', hi?.giPath === 'SHORT_PATH' && hi.giEnvelope.inspector?.seats_used.length === 0 && !publicBodyHasInternalIds(hi.councilSingleResponse), hi?.councilSingleResponse ?? hi))
  const status = await maybeHandleGiFrontDoor({ text: 'Status on War Room', env: { GI_ENG_01_SHORT_PATH: '1' } })
  cases.push(check('INTEGRATION', 'INT-EBC', 'status is not SHORT intercepted', status === null, status))
  const research = await maybeHandleGiFrontDoor({ text: 'Research the current Playwright guidance for persistent browser profiles and use primary sources.', env: { GI_ENG_01_SHORT_PATH: '1' } })
  cases.push(check('INTEGRATION', 'INT-RESEARCH', 'research is not SHORT intercepted', research === null, research))
  const foundry = await maybeHandleGiFrontDoor({ text: 'Change the PathClassifier in the repo so it handles X.', env: { GI_ENG_01_SHORT_PATH: '1' }, roomId: 'room-live', sessionId: 'sess-live' })
  cases.push(check('INTEGRATION', 'INT-FOUNDRY', 'Foundry handoff isolated, executed false', foundry?.giPath === 'HANDOFF' && foundry.giHandoff?.executed === false && foundry.giHandoff?.target === 'FOUNDRY', foundry?.giHandoff))
  cases.push(check('INTEGRATION', 'INT-PROD-FLAG', 'process production GI_ENG_01 still off after isolated calls', isGiEng01ShortPathEnabled() === false, process.env.GI_ENG_01_SHORT_PATH ?? 'unset'))

  const forced = createModelBackedShortPathCompleter(qualityShortPathCompleter, { forceProviderFailure: true })
  const envelope = commanderTurnFromText({ text: 'What is HTTP?', room_id: 'r', session_id: 's' })
  const prev = process.env.GI_ENG_02_SHORT_PATH_COMPLETE
  process.env.GI_ENG_02_SHORT_PATH_COMPLETE = '1'
  try {
    const fallback = await forced({ text: 'What is HTTP?', envelope })
    cases.push(check('INTEGRATION', 'INT-FALLBACK', 'provider failure falls back without pretending the failed provider answered', fallback.model_invoked === false && fallback.fallback === 'provider_error' && fallback.placement !== 'CLOUD' && fallback.placement !== 'LOCAL' && Boolean(fallback.text), fallback))
  } finally {
    if (prev === undefined) delete process.env.GI_ENG_02_SHORT_PATH_COMPLETE
    else process.env.GI_ENG_02_SHORT_PATH_COMPLETE = prev
  }
  return cases
}
