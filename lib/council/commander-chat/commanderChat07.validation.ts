/**
 * COMMANDER-CHAT-07 — normal conversational Council response.
 * Does not enable GI front door. Does not weaken research evidence rules.
 */
import { classifyEvidenceBoardMission, evidenceBoardTerminatesFamilyRequest, shouldDispatchEvidenceBoardCouncil } from '@/lib/council/evidence-board/classifier'
import { classifyCouncilTurn, shouldRunFamilyDeliberation } from '@/lib/council/session-orchestration/turnIntent'
import { detectResearchIntent } from '@/lib/research/researchIntent'
import { detectPromptIntent } from '@/lib/council/promptIntent'
import { classifyCouncilPath } from '@/lib/council/gi/pathClassifier'
import { selectCognitiveStrategy } from '@/lib/council/intelligence/strategy'
import { runCouncilIntelligenceMission } from '@/lib/council/intelligence/pipeline'
import { formatCommanderBrief } from '@/lib/council/evidence-board/orchestrator'
import { createEvidenceBoard, boardSnapshot } from '@/lib/council/evidence-board/board'
import { synthesizeAurora } from '@/lib/council/evidence-board/verify'
import { demoteSourcelessExternalClaims, noUsableSourcesBrief } from '@/lib/council/evidence-board/researchTruth'
import { selectTool } from '@/lib/council/engines/tool-selection/engine'
import { buildProviderIssueBanner } from '@/lib/council/familyOperationStatus'
import { COUNCIL_ROSTER } from '@/lib/council/familyRoster'
import { humanTerminalFailure } from '@/lib/council/commander-chat/roundTerminal'
import { toNormalChatText } from '@/lib/council/commander-chat/normalChatContract'
import {
  CONVERSATIONAL_FAILURE_CODES,
  formatConversationalFailure,
  compactAwarenessReceipts,
  wantsRuntimeTruthForConversation,
} from '@/lib/council/commander-chat/conversationalAurora'
import { LOCAL_MODEL_REGISTRY, localRegistryEntryForSlot } from '@/lib/council/live-orchestration/backends/localModelRegistry'
import { probeOllama } from '@/lib/native-builder/ollamaClient'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type Check = { id: string; pass: boolean; detail: unknown }
const checks: Check[] = []
function check(id: string, pass: boolean, detail: unknown) {
  checks.push({ id, pass, detail })
  if (!pass) console.error('FAIL', id, detail)
}

const HELLO = 'Hello council'
const helloTurn = classifyCouncilTurn(HELLO)
const helloClass = classifyEvidenceBoardMission({ commanderMessage: HELLO })
const helloResearch = detectResearchIntent(HELLO)
const helloIntent = detectPromptIntent(HELLO)
const helloPath = classifyCouncilPath({ text: HELLO, prior_turns: [] })
const helloStrategy = selectCognitiveStrategy({
  text: HELLO,
  intelligenceClass: 'SOCIAL_CHECKIN',
  ebcClass: 'SOCIAL_CHECKIN',
})

check('CHAT07-01', helloClass.mission_class === 'SOCIAL_CHECKIN' && (helloTurn.intent === 'SOCIAL_CHECKIN' || helloTurn.intent === 'GREETING') && helloIntent === 'GREETING', {
  mission: helloClass.mission_class,
  intent: helloTurn.intent,
  promptIntent: helloIntent,
})

check('CHAT07-02', helloClass.required_tools.length === 0 && helloResearch.shouldResearch === false && helloPath.tool_need === 'NONE' && !helloClass.required_tools.includes('broker.fetch'), {
  tools: helloClass.required_tools,
  research: helloResearch.shouldResearch,
  gi: helloPath.tool_need,
})

const noTool = selectTool({
  mission_id: 'chat07-no-tool',
  objective: HELLO,
  available_tools: ['research.web', 'browser.fetch', 'system.health'],
  remaining_evidence_gap: [],
  ebc_satisfied: true,
})
const skipLiveSocial = await runCouncilIntelligenceMission({
  commanderMessage: HELLO,
  tools: async (toolName, args = {}) => ({
    tool_name: toolName,
    args_fingerprint: `${toolName}:${JSON.stringify(args)}`,
    ok: true,
    blocked: false,
    denied: false,
    summary: `${toolName} ok`,
    pointer: toolName,
    kind: toolName.startsWith('wr.') ? 'live_telemetry' : 'tool_result',
    retrieved_at: new Date().toISOString(),
    temporal_layer: 'CURRENT_LIVE',
  }),
  skipLiveAwareness: true,
})
check('CHAT07-03', noTool.decision === 'NO_TOOL_REQUIRED' && noTool.selected_tool === null && Boolean(skipLiveSocial.commander_brief.trim()) && skipLiveSocial.ebc?.classification.mission_class === 'SOCIAL_CHECKIN', {
  decision: noTool.decision,
  brief: skipLiveSocial.commander_brief.slice(0, 80),
})

const general = localRegistryEntryForSlot('GENERAL')
const ollama = await probeOllama()
const generalInstalled = Boolean(general && ollama.models.some(name => name === general.modelId || name.startsWith(`${general.modelId.split(':')[0]}:`)))
check('CHAT07-04', Boolean(general?.modelId) && ollama.available && generalInstalled, {
  model: general?.modelId ?? null,
  available: ollama.available,
  installed: ollama.models,
})

check('CHAT07-05', formatConversationalFailure('MODEL_UNAVAILABLE').includes('MODEL_UNAVAILABLE') && !/degraded response/i.test(formatConversationalFailure('MODEL_UNAVAILABLE')), formatConversationalFailure('MODEL_UNAVAILABLE'))

check('CHAT07-06', LOCAL_MODEL_REGISTRY.some(row => row.slot === 'GENERAL' && row.enabled) && helloClass.selected_agents.includes('AURORA'), {
  general: general?.modelId,
  agents: helloClass.selected_agents,
})

check('CHAT07-07', helloStrategy.id === 'DIRECT' && skipLiveSocial.public.orchestration?.completion === 'COMPLETE' && helloClass.selected_agents[0] === 'AURORA', {
  strategy: helloStrategy.id,
  completion: skipLiveSocial.public.orchestration?.completion,
})

const sourceless = demoteSourcelessExternalClaims(
  [{
    claim_id: 'c1',
    text: 'A current external fact with no source',
    status: 'VERIFIED',
    evidence_ids: [],
    confidence: 0.9,
    label: 'VERIFIED_FACT',
    temporal_layer: 'CURRENT_LIVE',
    critical: true,
    agent_id: 'PULSAR',
    round: 1,
  }],
  [],
  [],
)
check('CHAT07-08', sourceless.claims[0]?.status !== 'VERIFIED' && /usable live sources|couldn.t verify/i.test(noUsableSourcesBrief()), {
  status: sourceless.claims[0]?.status,
  brief: noUsableSourcesBrief().slice(0, 80),
})

check('CHAT07-09', skipLiveSocial.public.orchestration?.completion === 'COMPLETE' && helloTurn.depth === 'FAST' && shouldRunFamilyDeliberation(helloTurn) === false, {
  completion: skipLiveSocial.public.orchestration?.completion,
  familyDeliberation: shouldRunFamilyDeliberation(helloTurn),
})

check('CHAT07-10', shouldDispatchEvidenceBoardCouncil('SOCIAL_CHECKIN') === true && evidenceBoardTerminatesFamilyRequest('SOCIAL_CHECKIN') === false, {
  dispatch: shouldDispatchEvidenceBoardCouncil('SOCIAL_CHECKIN'),
  terminate: evidenceBoardTerminatesFamilyRequest('SOCIAL_CHECKIN'),
})

const banner = buildProviderIssueBanner(
  { chatgpt: 'degraded' },
  family => COUNCIL_ROSTER.find(row => row.id === family)?.label ?? family,
)
check('CHAT07-11', banner === 'Aurora Council returned a degraded response.', banner)

const board = createEvidenceBoard({
  mission_id: helloClass.mission_id,
  mission_class: helloClass.mission_class,
  question: HELLO,
  agents: helloClass.selected_agents,
  ttl_seconds: helloClass.ttl_seconds,
  budget_tokens: helloClass.budget_tokens,
  budget_ms: helloClass.budget_ms,
})
const aurora = synthesizeAurora(boardSnapshot(board), 'UNVERIFIED', 0)
const ebcBrief = formatCommanderBrief(helloClass, aurora, board)
check('CHAT07-12', ebcBrief !== 'I am here.' && !/^hello$/i.test(ebcBrief.trim()), ebcBrief)
check('CHAT07-13', skipLiveSocial.commander_brief !== 'I am here.' && !/Aurora Council returned a degraded response/i.test(skipLiveSocial.commander_brief), skipLiveSocial.commander_brief.slice(0, 120))

const helpClass = classifyEvidenceBoardMission({ commanderMessage: 'What can you help me with?' })
check('CHAT07-14', helpClass.mission_class === 'SOCIAL_CHECKIN' && !helpClass.required_tools.includes('broker.fetch'), helpClass.mission_class)

const summaryClass = classifyEvidenceBoardMission({ commanderMessage: 'Summarize what we just talked about.' })
check('CHAT07-15', summaryClass.mission_class === 'SOCIAL_CHECKIN' && detectResearchIntent('Summarize what we just talked about.').shouldResearch === false, summaryClass.mission_class)

const factClass = classifyEvidenceBoardMission({ commanderMessage: 'What is 2 + 2?' })
check('CHAT07-16', factClass.mission_class === 'SOCIAL_CHECKIN' && factClass.required_tools.length === 0, factClass.mission_class)

const researchClass = classifyEvidenceBoardMission({ commanderMessage: 'Research current mixture-of-experts inference methods using primary sources.' })
check('CHAT07-17', researchClass.mission_class === 'DEEP_RESEARCH' && researchClass.required_tools.includes('broker.fetch'), {
  mission: researchClass.mission_class,
  tools: researchClass.required_tools,
})

check('CHAT07-18', CONVERSATIONAL_FAILURE_CODES.every(code => humanTerminalFailure(`Council failed ${code}`).includes(code)) && humanTerminalFailure('MODEL_UNAVAILABLE').includes('MODEL_UNAVAILABLE'), CONVERSATIONAL_FAILURE_CODES)

const failureCopy = formatConversationalFailure('ROUTING_FAILED', 'because therefore evidence synthesis')
check('CHAT07-19', !/chain of thought|hidden reasoning|let me think/i.test(failureCopy) && !/claim_|tool_id|SHORT_PATH/.test(toNormalChatText(failureCopy)), failureCopy)

check('CHAT07-20', skipLiveSocial.public.contract?.authority.commit === false && skipLiveSocial.public.contract?.authority.production_deploy === false && skipLiveSocial.ebc?.aurora.commander_authority === 'REQUIRED_FOR_ACTION', skipLiveSocial.public.contract?.authority)

check('CHAT07-FUNCTIONING', wantsRuntimeTruthForConversation('How are you functioning right now?') === true && wantsRuntimeTruthForConversation(HELLO) === false && classifyEvidenceBoardMission({ commanderMessage: 'How are you functioning right now?' }).mission_class === 'SOCIAL_CHECKIN' && classifyEvidenceBoardMission({ commanderMessage: 'What is your current operational status?' }).mission_class === 'SOCIAL_CHECKIN', true)
check('CHAT07-RECEIPTS', compactAwarenessReceipts({
  install_id: 'install-x',
  runtime_3847: { pid: 1, process: 'core', last_verified_at: 'now' },
  runtime_3848: { pid: 2, process: 'ui', last_verified_at: 'now' },
  council_state: 'READY_LOCAL',
  local_backend_state: 'READY_LOCAL',
  general_model: general?.modelId ?? 'general',
  providers: [{ id: 'ollama', healthy: true, detail: 'ok' }],
  tools_available: [],
  evidence_board_active: true,
  mission_id: null,
  authorized: [],
  requires_approval: [],
  last_verified_at: 'now',
  source: 'live_telemetry',
  bounded: false,
}).includes('install=install-x'), true)

const source = readFileSync(join(process.cwd(), 'lib/council/commander-chat/conversationalAurora.ts'), 'utf8')
check('CHAT07-NO-GI-FRONT-DOOR', !source.includes('maybeHandleGiFrontDoor') && !source.includes('GI_ENG_01_SHORT_PATH'), true)
check('CHAT07-NO-CANNED-HELLO', !source.includes('"Hello"') && !source.includes("'Hello'"), true)
check('CHAT07-SEAT-IS-AURORA', source.includes("seat: 'chatgpt'") && source.includes("role: 'AURORA'"), true)

const failed = checks.filter(row => !row.pass)
console.log(JSON.stringify({ pass: failed.length === 0, total: checks.length, failed: failed.map(row => row.id) }, null, 2))
if (failed.length) process.exit(1)
