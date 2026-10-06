import { readFileSync } from 'node:fs'
import { classifyEvidenceBoardMission } from './classifier'
import { runEvidenceBoardCouncil, formatCommanderBrief } from './orchestrator'
import { createEvidenceBoard } from './board'
import { noUsableSourcesBrief, isUsableExternalEvidence, lumenMaySupportExternalClaim } from './researchTruth'
import { phoenixContributionSuccessful, verifyClaimLumen } from './verify'
import { toolFingerprint } from './board'
import type { ToolCallRecord } from './types'
import type { ToolRunner } from './tools'
import {
  RESEARCH_ACCESS_IS_NOT_ACTION_AUTHORITY,
  RESEARCH_TERMINALS,
  adaptStrategy,
  corroborationKeys,
  createLedger,
  decomposeResearchQuestion,
  diagnoseGap,
  evidenceRequirementFor,
  extractClaimFromInspection,
  independentCount,
  objectiveSatisfied,
  reformulateQuery,
  resumeSkipsCompleted,
  snippetIsEvidence,
  terminalFor,
  transparencyBrief,
  triageSource,
  zeroEvidenceContinues,
  runRecoveryFetches,
} from './evidenceRecovery'

type Case = { id: string; ok: boolean; details: string }
const cases: Case[] = []
function check(id: string, ok: boolean, details: unknown = '') {
  cases.push({ id, ok, details: typeof details === 'string' ? details : JSON.stringify(details) })
}

const questions = decomposeResearchQuestion('Research the current Playwright browser context API from official documentation? What applies to isolation?')
const blocking = questions.filter(q => q.blocking)
const reqs = blocking.map(evidenceRequirementFor)
check('ER01-02', blocking.length > 0 && reqs.length === blocking.length && reqs.every(row => row.kind && row.minimum_independent_sources >= 1), reqs)

const ledger = createLedger({ mission_id: 'm', objective: 'Research the current official API documentation for BrowserContext.' })
check('ER01-03', ledger.evidence_requirements[0]?.source_class_preferences.includes('technical docs') || ledger.evidence_requirements[0]?.source_class_preferences.includes('official'), ledger.evidence_requirements)
check('ER01-04', snippetIsEvidence('This snippet is long enough to look like a result title from search.', false) === false, 'snippet')
check('ER01-05', extractClaimFromInspection({
  opened: true,
  text: 'Browser contexts isolate cookies, storage, and permissions for each session.',
  source_ref: 'https://playwright.dev/docs/browser-contexts',
  source_class: 'technical docs',
  source_authority: 'OFFICIAL',
  location: 'docs/browser-contexts',
  observed_at: '2026-09-24T00:00:00.000Z',
}) !== null)
check('ER01-06', Boolean(extractClaimFromInspection({
  opened: true,
  text: 'Browser contexts isolate cookies, storage, and permissions for each session.',
  source_ref: 'https://playwright.dev/docs/browser-contexts',
  source_class: 'technical docs',
  source_authority: 'OFFICIAL',
  location: 'section:isolation',
  observed_at: '2026-09-24T00:00:00.000Z',
})?.source_ref))

const primary = adaptStrategy('NO_PRIMARY_SOURCE')
check('ER01-08', primary.source_class === 'official' && /primary/i.test(primary.instruction), primary)
check('ER01-09', adaptStrategy('STALE_ONLY').instruction.toLowerCase().includes('current'), adaptStrategy('STALE_ONLY'))
check('ER01-10', /disconfirm/i.test(adaptStrategy('SOURCE_DISAGREEMENT').instruction), adaptStrategy('SOURCE_DISAGREEMENT'))
const wrong = reformulateQuery('research the ai act', 'WRONG_TERMINOLOGY', ['research the ai act'])
check('ER01-11', wrong !== 'research the ai act' && /machine learning|official/i.test(wrong), wrong)
const broad = reformulateQuery('research everything about browsers security privacy storage network', 'TOO_BROAD', [])
check('ER01-12', /specific official record/i.test(broad) && broad.split(' ').length < 12, broad)
const narrow = reformulateQuery('BrowserContext.storageState exact flag', 'TOO_NARROW', [])
check('ER01-13', /overview official source/i.test(narrow), narrow)
const jurisdiction = reformulateQuery('privacy statute filing rules', 'JURISDICTION_GAP', [])
check('ER01-14', /United States/i.test(jurisdiction), jurisdiction)
check('ER01-15', adaptStrategy('TOOL_FAILURE').source_class === 'alternate-tool', adaptStrategy('TOOL_FAILURE'))
check('ER01-16', corroborationKeys([
  { url: 'https://news.example/a', content_hash: 'same-story' },
  { url: 'https://mirror.example/a', content_hash: 'same-story' },
]) === 1 && independentCount(['https://www.playwright.dev/docs', 'https://playwright.dev/docs']) === 1)
const docsReq = evidenceRequirementFor({ id: 'q1', text: 'Research the official API documentation', blocking: true })
check('ER01-17', docsReq.minimum_independent_sources === 1 && docsReq.kind === 'TECHNICAL_DOCUMENTATION', docsReq)
check('ER01-18', /disconfirm/i.test(adaptStrategy('SOURCE_DISAGREEMENT').instruction))
check('ER01-19', terminalFor({
  continue_research: false, usable: 2, primary: 2, open: 0, verified: 1, conflict: true, stale: false, auth: false, budget_left: 2, gap: 'SOURCE_DISAGREEMENT',
}) === 'CONFLICT_UNRESOLVED')
check('ER01-20', evidenceRequirementFor({ id: 'q', text: 'What is the current official status', blocking: true }).freshness_required === true && diagnoseGap({ summary: 'stale copy only', usable: 1, primary: 0, stale: true, disagreement: false }) === 'STALE_ONLY')
check('ER01-01', zeroEvidenceContinues({ wave_number: 1, max_waves: 3, tools_available: true, blocking_open: true, strategy_changed: true, auth_blocked: false }) === true)
check('ER01-21', zeroEvidenceContinues({ wave_number: 1, max_waves: 3, tools_available: true, blocking_open: false, strategy_changed: true, auth_blocked: false }) === false)
check('ER01-22', terminalFor({
  continue_research: false, usable: 0, primary: 0, open: 1, verified: 0, conflict: false, stale: false, auth: false, budget_left: 0, gap: 'NO_RESULTS',
}) === 'BUDGET_EXHAUSTED')
const typed = terminalFor({
  continue_research: false, usable: 0, primary: 0, open: 1, verified: 0, conflict: false, stale: false, auth: false, budget_left: 1, gap: 'NO_RESULTS',
})
check('ER01-23', RESEARCH_TERMINALS.includes(typed), typed)
check('ER01-24', terminalFor({
  continue_research: false, usable: 1, primary: 1, open: 1, verified: 1, conflict: false, stale: false, auth: false, budget_left: 1, gap: null,
}) === 'OBJECTIVE_PARTIALLY_ANSWERED')

const emptyBoard = createEvidenceBoard({
  mission_id: 'empty',
  mission_class: 'DEEP_RESEARCH',
  question: 'research missing topic',
  agents: ['PULSAR'],
  ttl_seconds: 600,
  budget_tokens: 1000,
  budget_ms: 1000,
})
const invented = formatCommanderBrief(classifyEvidenceBoardMission({ commanderMessage: 'Research the missing official record' }), {
  mission_class: 'DEEP_RESEARCH',
  completion_state: 'UNVERIFIED',
  confidence: 0.9,
  verified_facts: [],
  partially_verified: [],
  unverified: [],
  conflicts: [],
  unknowns: [],
  tool_blocks: [],
  risks: [],
  next_actions: [],
  advisory: true,
  commander_authority: 'REQUIRED_FOR_ACTION',
}, emptyBoard)
check('ER01-25', invented === noUsableSourcesBrief() && !/verified fact/i.test(invented), invented)
const detailed = createLedger({ mission_id: 'tel', objective: 'Research the official record that does not exist.' })
detailed.wave_number = 3
detailed.strategy_history = ['reformulated query', 'official primary record']
detailed.discovered_source_count = 4
detailed.opened_source_count = 2
detailed.primary_source_count = 0
detailed.usable_source_count = 0
detailed.claims_open = 1
detailed.claims_supported = 0
detailed.rejection_history = [{ ref: 'q', reason: 'IRRELEVANT' }]
detailed.termination_reason = 'NO_USABLE_EVIDENCE'
detailed.continue_research = false
const detailedBrief = transparencyBrief(detailed)
check('ER01-26', detailedBrief.includes('4 candidate sources') && detailedBrief.includes('2 sources inspected') && !detailedBrief.includes('20 sites'), detailedBrief)
check('ER01-38', /could not fully verify/i.test(detailedBrief) && /no usable evidence/i.test(detailedBrief) && detailedBrief !== noUsableSourcesBrief(), detailedBrief)
check('ER01-39', !/discovered_source_count:\s*99/.test(detailedBrief))

const resumed = createLedger({ mission_id: 'resume', objective: 'Research the official API documentation.' })
resumed.query_history = ['Research the official API documentation. reformulated query']
resumed.wave_number = 2
check('ER01-27', resumed.query_history.length === 1 && resumed.schema === 'council.evidence-recovery.v1' && resumed.is_ebc === false)
check('ER01-28', resumeSkipsCompleted(resumed, resumed.query_history[0]) === true && resumeSkipsCompleted(resumed, 'a different query') === false)
check('ER01-29', resumed.is_ebc === false && !('claims' in resumed && Array.isArray((resumed as { claims?: unknown }).claims)))
check('ER01-30', resumed.grants_authority === false && RESEARCH_ACCESS_IS_NOT_ACTION_AUTHORITY === true)
check('ER01-32', decomposeResearchQuestion('Research a controversial statute from the official record') .length > 0 && RESEARCH_ACCESS_IS_NOT_ACTION_AUTHORITY === true)
check('ER01-33', decomposeResearchQuestion('Hello council').length === 0 && decomposeResearchQuestion('2+2').length === 0 && classifyEvidenceBoardMission({ commanderMessage: 'Hello council' }).mission_class === 'SOCIAL_CHECKIN')

const hello = classifyEvidenceBoardMission({ commanderMessage: 'How are you functioning right now?' })
const help = classifyEvidenceBoardMission({ commanderMessage: 'What can you help me with?' })
const math = classifyEvidenceBoardMission({ commanderMessage: '2+2' })
check('ER01-33b', hello.mission_class === 'SOCIAL_CHECKIN' && help.required_tools.length === 0 && math.mission_class === 'SOCIAL_CHECKIN', { hello: hello.mission_class, help: help.mission_class, math: math.mission_class, helpTools: help.required_tools })

const recoverySrc = readFileSync(new URL('./evidenceRecovery.ts', import.meta.url), 'utf8')
const verifySrc = readFileSync(new URL('./verify.ts', import.meta.url), 'utf8')
const orchestratorSrc = readFileSync(new URL('./orchestrator.ts', import.meta.url), 'utf8')
check('ER01-34', orchestratorSrc.includes("tools('broker.fetch'") || recoverySrc.includes("'broker.fetch'"))
check('ER01-35', /no_usable_sources/.test(verifySrc) && typeof verifyClaimLumen === 'function' && typeof lumenMaySupportExternalClaim === 'function')
check('ER01-36', typeof phoenixContributionSuccessful === 'function' && verifySrc.includes('function phoenixContributionSuccessful'))
check('ER01-37', objectiveSatisfied({ blocking: 2, open: 1, verified: 1 }) === false && objectiveSatisfied({ blocking: 1, open: 0, verified: 1 }) === true)
check('ER01-40', !/Council2|EBC2|ResearchEngine2|LUMEN2|PHOENIX2/.test(recoverySrc) && !/new BrowserBroker/.test(recoverySrc))
check('ER01-06b', triageSource({ url: 'https://example.com/a', snippet: 'x', seen: new Set() }) === 'IRRELEVANT')

const calls: string[] = []
const tools: ToolRunner = async (toolName, args = {}) => {
  const query = String(args.query ?? '')
  calls.push(`${toolName}:${query}`)
  const now = new Date().toISOString()
  const recovery = Number(args.recovery_wave ?? 0) > 0
  const record: ToolCallRecord = recovery ? {
    tool_name: toolName,
    args_fingerprint: toolFingerprint(toolName, args),
    ok: true,
    blocked: false,
    denied: false,
    summary: 'Official documentation states browser contexts isolate storage and cookies per session.',
    pointer: 'https://playwright.dev/docs/browser-contexts',
    url: 'https://playwright.dev/docs/browser-contexts',
    title: 'Browser contexts',
    kind: 'primary_external',
    retrieved_at: now,
    temporal_layer: 'CURRENT_LIVE',
    payload: { discovered_source_count: 1, opened_source_count: 1, usable_source_count: 1, primary_source_count: 1 },
  } : {
    tool_name: toolName,
    args_fingerprint: toolFingerprint(toolName, args),
    ok: false,
    blocked: true,
    denied: false,
    summary: 'opened no usable sources',
    pointer: 'broker:fetch',
    kind: 'tool_result',
    retrieved_at: now,
    temporal_layer: 'CURRENT_LIVE',
  }
  return record
}

const live = await runEvidenceBoardCouncil({
  commanderMessage: 'Research the current official Playwright browser context documentation.',
  tools,
})
const usable = live.board.evidence.filter(isUsableExternalEvidence)
const brokerCalls = live.snapshot.tool_calls.filter(call => call.tool_name === 'broker.fetch')
check('ER01-07', usable.length > 0 && live.board.claims.some(claim => claim.evidence_ids.some(id => live.board.evidence.some(row => row.evidence_id === id))), { usable: usable.length, claims: live.board.claims.length })
check('ER01-01b', brokerCalls.length >= 2 && live.commander_brief !== noUsableSourcesBrief() && live.research_ledger?.wave_number === 2, {
  brokerCalls: brokerCalls.length,
  wave: live.research_ledger?.wave_number,
  brief: live.commander_brief.slice(0, 180),
})

const fetched = await runRecoveryFetches({
  missionId: 'direct',
  objective: 'Research the official documentation.',
  tools,
  priorQueries: ['Research the official documentation.'],
  usableCount: 0,
  authBlocked: false,
  maxWaves: 3,
})
check('ER01-31', fetched.records.every(row => row.tool_name === 'broker.fetch') && fetched.ledger.grants_authority === false)

const failed = cases.filter(row => !row.ok)
for (const row of cases) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.id}${row.ok ? '' : ` :: ${row.details}`}`)
console.log(`COUNCIL_EVIDENCE_RECOVERY_01 ${cases.length - failed.length}/${cases.length} PASS`)
if (failed.length) process.exitCode = 1
