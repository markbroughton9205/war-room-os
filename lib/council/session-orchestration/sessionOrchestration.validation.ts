import { pathToFileURL } from 'node:url'
import { classifyCouncilTurn, shouldRunFamilyDeliberation } from './turnIntent'
import { assertNewSessionIsolation, sessionHistoryContainsTopic, buildAssemblePolicyForTurn } from './isolation'
import { decideMemoryInfluence } from './memoryInfluence'
import { generateNeutralSessionTitle } from './sessionTitle'
import { expandResearchQuery } from './queryDecompose'
import { stageFromDeliberationRole, stageFromPersistedMetadata } from './messageStage'
import { applyResearchFailurePolicy } from './evidenceFailure'
import { isLightweightPingDecree } from '@/lib/council/contextRelevance'
import { detectResearchIntent } from '@/lib/research/researchIntent'
import type { MemoryRecordRow } from '@/lib/context-assembler/types'
import type { LiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function mem(id: string, content: string, memory_type = 'project_fact'): MemoryRecordRow {
  return {
    id,
    content,
    memory_type,
    scope: 'global_war_room',
    status: 'active',
    effective_from: new Date().toISOString(),
    importance_tier: 'operational',
  }
}

const panamaMemory = mem('m-panama', 'Panama relocation plan: visas, property law, taxation, schools.')
const greeting = classifyCouncilTurn('Hey council')
const statusPing = classifyCouncilTurn('Quick status ping')
const goingOn = classifyCouncilTurn("Hey council whats going on")
const world = classifyCouncilTurn("Council, what's going on with the world?")
const twoPlusTwo = classifyCouncilTurn("What's 2+2?")
const followUp = classifyCouncilTurn('Tell me more.')
const explicitPanama = classifyCouncilTurn('Tell me about the Panama plan we discussed.')

const isolation = assertNewSessionIsolation({
  sessionIdA: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  sessionIdB: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  historyForB: [],
  durableMemoryStored: true,
  durableMemoryInjected: false,
})

const greetingPolicy = buildAssemblePolicyForTurn('Hey council')
const greetingMem = decideMemoryInfluence(panamaMemory, greetingPolicy)
const explicitPolicy = buildAssemblePolicyForTurn('Tell me about the Panama plan we discussed.')
const explicitMem = decideMemoryInfluence(panamaMemory, explicitPolicy)

const failedPacket: LiveResearchEvidencePacket = {
  usedLiveResearch: false,
  generatedAt: new Date().toISOString(),
  sources: [{ kind: 'tavily', ok: false, queriedAt: new Date().toISOString(), error: 'timeout' }],
  findings: '',
  confidence: 0,
  freshness: 'unknown',
  contradictions: [],
  unresolvedQuestions: [],
}

export function runCouncilSessionOrchestrationValidation(): CaseResult[] {
  return [
    check('iso_01_new_session_ids_distinct_empty_history', isolation.pass, isolation.reasons.join(',')),
    check('iso_02_greeting_is_fast', greeting.depth === 'FAST' && (greeting.intent === 'GREETING' || greeting.intent === 'SOCIAL_CHECKIN'), JSON.stringify(greeting)),
    check('iso_03_status_ping_is_fast', statusPing.depth === 'FAST' && statusPing.intent === 'STATUS_CHECK', JSON.stringify(statusPing)),
    check('iso_04_hey_going_on_is_fast_no_research', goingOn.depth === 'FAST' && !goingOn.shouldResearch, JSON.stringify(goingOn)),
    check('iso_05_world_brief_full_research', world.depth === 'FULL' && world.shouldResearch, JSON.stringify(world)),
    check('iso_06_math_fast_no_research', twoPlusTwo.depth === 'FAST' && !twoPlusTwo.shouldResearch, JSON.stringify(twoPlusTwo)),
    check('iso_07_follow_up_fast', followUp.intent === 'FOLLOW_UP', JSON.stringify(followUp)),
    check('iso_08_explicit_panama_memory_intent', explicitPanama.intent === 'EXPLICIT_MEMORY', JSON.stringify(explicitPanama)),
    check('iso_09_greeting_does_not_inject_panama_memory', !greetingMem.include, JSON.stringify(greetingMem)),
    check('iso_10_explicit_panama_may_inject', explicitMem.include, JSON.stringify(explicitMem)),
    check('iso_11_lightweight_ping_quick_status_ping', isLightweightPingDecree('quick status ping'), 'quick status ping'),
    check('iso_12_lightweight_hey_council_going_on', isLightweightPingDecree("Hey council whats going on"), 'hey going on'),
    check('iso_13_world_research_intent', detectResearchIntent("Council, what's going on with the world?").shouldResearch, 'world'),
    check('iso_14_fast_skips_family_deliberation', !shouldRunFamilyDeliberation(greeting), 'greeting deliberation'),
    check('iso_14b_checkin_social', classifyCouncilTurn('Council check in').intent === 'SOCIAL_CHECKIN' && !shouldRunFamilyDeliberation(classifyCouncilTurn('Council check in')), 'checkin'),
    check('iso_15_full_uses_family_deliberation', shouldRunFamilyDeliberation(world), 'world deliberation'),
    check('iso_16_neutral_world_title', generateNeutralSessionTitle("Council, what's going on with the world?") === 'World Events Brief', generateNeutralSessionTitle("Council, what's going on with the world?")),
    check('iso_17_opening_stage', stageFromDeliberationRole('opening_position') === 'OPENING', stageFromDeliberationRole('opening_position')),
    check('iso_18_legacy_stage_not_invented', stageFromPersistedMetadata({}) === 'LEGACY', 'legacy'),
    check('iso_19_world_query_decomposed', expandResearchQuery(world ? "what's going on with the world" : '', 'FRESHNESS_SENSITIVE').includes('geopolitics'), expandResearchQuery("what's going on with the world", 'FRESHNESS_SENSITIVE').slice(0, 80)),
    check('iso_20_all_research_failed_no_pretend', applyResearchFailurePolicy(failedPacket).pretendLiveEvidence === false && applyResearchFailurePolicy(failedPacket).synthesisMustMarkGaps, JSON.stringify(applyResearchFailurePolicy(failedPacket))),
    check('iso_21_session_b_history_no_panama', !sessionHistoryContainsTopic([], 'Panama'), 'empty b'),
    check('iso_22_hello_no_research', !detectResearchIntent('Hey council', { intentKind: 'greeting' }).shouldResearch, 'hey council research'),
    check('iso_23_war_room_status_summary_is_status_check', classifyCouncilTurn('Council, give me a short status summary of War Room.').intent === 'STATUS_CHECK', JSON.stringify(classifyCouncilTurn('Council, give me a short status summary of War Room.'))),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCouncilSessionOrchestrationValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Council session orchestration validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
