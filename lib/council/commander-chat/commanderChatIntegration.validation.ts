/**
 * Commander chat integration checks.
 * Routing, presentation boundary, session ledger, listening truth, God's Eye label.
 */
import { classifyEvidenceBoardMission, evidenceBoardTerminatesFamilyRequest } from '@/lib/council/evidence-board/classifier'
import { classifyCouncilTurn } from '@/lib/council/session-orchestration/turnIntent'
import { generateNeutralSessionTitle } from '@/lib/council/session-orchestration/sessionTitle'
import { detectResearchIntent } from '@/lib/research/researchIntent'
import { isWarRoomRuntimeStatusDecree } from '@/lib/council/nebula/runtimeStatus'
import { selectCognitiveStrategy } from '@/lib/council/intelligence/strategy'
import { NEBULA_COUNCIL_INITIALIZATION_BANNER } from '@/lib/council/nebula/identity'
import { godsEyePublicLabel, UNKNOWN_GODS_EYE_STATUS } from '@/lib/terra/godsEyeStatusAdapter'
import { PRESENCE_LABEL } from '@/lib/live-intel/composeLiveIntel'
import { canShowListening } from '@/lib/council/gi/captureTruth'
import {
  dedupeFailureCopy,
  stripBrokenMarkdown,
  toNormalChatText,
} from './normalChatContract'
import { formatSystemStatusCommanderBrief } from './systemStatusBrief'
import {
  createLedgerSession,
  mergeSessionLists,
  retitleLedgerSession,
  upsertLedgerSession,
} from './sessionLedger'
import { TERRA_RUNTIME_STATE_LABEL, GODSEYE_STATE_LABEL, EARTH_VISUAL_ACTIVE_LABEL } from '@/components/war-room/terra/terraHomeEarth/earthAssets'
import { shouldDetachConversationBinding } from './conversationBinding'
import {
  commitFinalTranscript,
  evidenceCompletionKeepsFindings,
  humanTerminalFailure,
  isPreExecutionStreamFailure,
  decreeTurnMatchesOperationKey,
  isCommanderSynthesisMessage,
  legacyWebToolOwnsRound,
  persistedAuroraIsTerminalBrief,
  resolveRoundTerminal,
  shellClearsAfterTerminal,
} from './roundTerminal'
import { buildCommanderOperationFromMessages } from '@/lib/council/unified-experience/adapter'
import { readSessionTranscript, writeSessionTranscript, type LocalTranscriptMessage } from './sessionTranscript'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createEvidenceBoard } from '@/lib/council/evidence-board/board'
import { formatCommanderBrief } from '@/lib/council/evidence-board/orchestrator'
import { applyLumenPromotion, synthesizeAurora, verifyClaimLumen } from '@/lib/council/evidence-board/verify'
import { recoverFromToolFailure } from '@/lib/council/gi/failureRecovery'
import { DECREE_GATHER_HARD_HANG_MS } from '@/lib/council/providerTimeouts'
import type { BoardRowProvenance, EbcClaim, EbcEvidence, LumenVerification } from '@/lib/council/evidence-board/types'
import { independentSourceCount } from '@/lib/council/gi/lumenQuality'
import { unwrapSearchResultUrl, constructResearchQueries, paperIdentity, toCandidate, wantsPrimarySources } from '@/lib/browser-broker/researchDiscovery'
import { demoteSourcelessExternalClaims, isUsableExternalEvidence, noUsableSourcesBrief } from '@/lib/council/evidence-board/researchTruth'
import {
  CURRENT_INFO_WINDOW_DAYS,
  MOE_RESEARCH_PROMPT,
  collectUsableSources,
  crossSourceSynthesized,
  honestResearchFailure,
  isFailedFetchRow,
  isPrimaryAuthoritativeUrl,
  publicResearchIsClean,
  publicSourcesVisible,
  scoreWebResearch,
  sourceIsWithinDays,
} from './webResearchAcceptance'

type Check = { id: string; pass: boolean; detail: unknown }

const checks: Check[] = []
function check(id: string, pass: boolean, detail: unknown) {
  checks.push({ id, pass, detail })
  if (!pass) console.error('FAIL', id, detail)
}

const helloCouncil = classifyEvidenceBoardMission({ commanderMessage: 'Hello council' })
check('CHAT07-HELLO-CLASS', helloCouncil.mission_class === 'SOCIAL_CHECKIN' && helloCouncil.required_tools.length === 0 && detectResearchIntent('Hello council').shouldResearch === false, helloCouncil.mission_class)
check('CHAT07-HELLO-NO-CANNED', formatCommanderBrief(helloCouncil, {
  mission_class: helloCouncil.mission_class,
  completion_state: 'UNVERIFIED',
  confidence: 0,
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
}, createEvidenceBoard({
  mission_id: helloCouncil.mission_id,
  mission_class: helloCouncil.mission_class,
  question: 'Hello council',
  agents: helloCouncil.selected_agents,
  ttl_seconds: helloCouncil.ttl_seconds,
  budget_tokens: helloCouncil.budget_tokens,
  budget_ms: helloCouncil.budget_ms,
})) !== 'I am here.', 'social brief is not a canned greeting')

const STATUS_PROMPTS = [
  'what is the status',
  'status',
  'War Room status',
  'how is War Room doing',
  'is everything running',
  "what's running right now",
  'what is online',
  'what is connected',
]

for (const prompt of STATUS_PROMPTS) {
  const classified = classifyEvidenceBoardMission({ commanderMessage: prompt })
  const turn = classifyCouncilTurn(prompt)
  const research = detectResearchIntent(prompt)
  check(`ROUTE-${prompt}`, classified.mission_class === 'SYSTEM_STATUS' && turn.intent === 'STATUS_CHECK' && research.shouldResearch === false, {
    mission: classified.mission_class,
    intent: turn.intent,
    research: research.shouldResearch,
    tools: classified.required_tools,
  })
  check(`TOOLS-${prompt}`, !classified.required_tools.includes('broker.fetch'), classified.required_tools)
  const strategy = selectCognitiveStrategy({ text: prompt, intelligenceClass: 'SYSTEM_STATUS', ebcClass: 'SYSTEM_STATUS' })
  check(`STRATEGY-${prompt}`, strategy.id === 'VERIFY', strategy.id)
}

const researchPrompt = 'Research current mixture-of-experts inference.'
const researchClass = classifyEvidenceBoardMission({ commanderMessage: researchPrompt })
check('RESEARCH-STILL-DEEP', researchClass.mission_class === 'DEEP_RESEARCH' && researchClass.required_tools.includes('broker.fetch'), researchClass.mission_class)

check('STATUS-NOT-RESEARCH-PHRASE', isWarRoomRuntimeStatusDecree('what is the status') && !isWarRoomRuntimeStatusDecree('Research current mixture-of-experts inference.'), true)

const dirty = [
  'Browser research opened no usable sources.',
  'Browser research opened no usable sources.',
  'TOOL_BLOCKED claim_abc CURRENT_LIVE e-ORION-r1-20',
  '###',
  '1.',
  '####',
].join('\n')
const clean = toNormalChatText(dirty)
check('CLEAN-NO-IDS', !/TOOL_BLOCKED|CURRENT_LIVE|claim_|e-ORION/.test(clean), clean)
check('CLEAN-DEDUPE', (clean.match(/Browser research opened no usable sources/g) ?? []).length <= 1, clean)
check('CLEAN-NO-EMPTY-MD', !/^#{1,6}\s*$/m.test(clean) && !/^1\.\s*$/m.test(stripBrokenMarkdown(dirty)), clean)

const brief = formatSystemStatusCommanderBrief(null)
check('STATUS-BRIEF-SHAPE', brief.startsWith('War Room status is waiting on local telemetry.') && brief.includes('- Core:') && brief.includes('- Browser Broker:') && !/TOOL_BLOCKED|claim_/.test(brief), brief)
check('STATUS-BRIEF-SEPARATE', brief.includes('- Terra:') && brief.includes('- Foundry:') && brief.includes('unknown'), brief)

const liveBrief = formatSystemStatusCommanderBrief({
  install_id: 'install-1',
  runtime_3847: { pid: 1, process: 'core', last_verified_at: 'now' },
  runtime_3848: { pid: 2, process: 'ui', last_verified_at: 'now' },
  council_state: 'READY_LOCAL',
  local_backend_state: 'READY_LOCAL',
  general_model: 'general',
  providers: [
    { id: 'core-3847', healthy: true, detail: 'ok' },
    { id: 'ui-3848', healthy: true, detail: 'ok' },
    { id: 'browser-broker', healthy: true, detail: 'ready' },
  ],
  tools_available: [],
  evidence_board_active: true,
  mission_id: null,
  authorized: [],
  requires_approval: [],
  last_verified_at: 'now',
  source: 'live_telemetry',
  bounded: false,
})
check('STATUS-BRIEF-ONLINE', liveBrief.startsWith('War Room is online.') && liveBrief.includes('- Core: online') && liveBrief.includes('- Foundry: available') && !/TOOL_BLOCKED|DEEP_RESEARCH/.test(liveBrief), liveBrief)

check('TITLE-STATUS', generateNeutralSessionTitle('what is the status') === 'War Room Status', generateNeutralSessionTitle('what is the status'))
check('TITLE-RESEARCH', generateNeutralSessionTitle('Research sparse experts') === 'Sparse Expert Research', generateNeutralSessionTitle('Research sparse experts'))
check('TITLE-FIX', generateNeutralSessionTitle('Fix Browser screenshots') === 'Browser Screenshot Repair', generateNeutralSessionTitle('Fix Browser screenshots'))

const first = createLedgerSession('s1', 'New Council Session', '2026-09-22T00:00:00.000Z')
const second = createLedgerSession('s2', 'New Council Session', '2026-09-22T00:01:00.000Z')
const listed = upsertLedgerSession(upsertLedgerSession([], first), second)
const again = upsertLedgerSession(listed, { ...first, title: 'War Room Status' })
check('LEDGER-TWO', listed.length === 2 && listed[0]?.id === 's2', listed.map(row => row.id))
check('LEDGER-NO-DUP', again.length === 2 && again.find(row => row.id === 's1')?.title === 'War Room Status', again.length)
const merged = mergeSessionLists([{ ...first, title: 'Remote' }], listed)
check('LEDGER-MERGE', merged.filter(row => row.id === 's1').length === 1 && merged.find(row => row.id === 's1')?.title === 'Remote', merged)
const titled = retitleLedgerSession(listed, 's2', 'War Room Status', 'what is the status')
check('LEDGER-TITLE', titled.find(row => row.id === 's2')?.title === 'War Room Status', titled.find(row => row.id === 's2')?.title)

check('LISTENING-IDLE', PRESENCE_LABEL.idle === 'Idle' && canShowListening({ capture_truth: 'NOT_REQUESTED' }) === false, PRESENCE_LABEL.idle)
check('LISTENING-LIVE-ONLY', canShowListening({ capture_truth: 'CAPTURING', voice_session_id: 'voice-1' }) === true, true)
check('GODSEYE-NOT-CONFIGURED', godsEyePublicLabel(UNKNOWN_GODS_EYE_STATUS) === "GOD'S EYE NOT CONFIGURED" && Boolean(UNKNOWN_GODS_EYE_STATUS.reason), godsEyePublicLabel())
check('GODSEYE-UNKNOWN-REASON', godsEyePublicLabel({ severity: 'UNKNOWN', reason: 'probe returned no class', source: 'godseye_runtime', freshness: null }).includes('probe returned no class'), true)
check('STATES-SEPARATE', String(TERRA_RUNTIME_STATE_LABEL) !== String(GODSEYE_STATE_LABEL) && String(EARTH_VISUAL_ACTIVE_LABEL) !== String(GODSEYE_STATE_LABEL), [TERRA_RUNTIME_STATE_LABEL, GODSEYE_STATE_LABEL, EARTH_VISUAL_ACTIVE_LABEL])
check('BANNER-LIVE-SEATS', NEBULA_COUNCIL_INITIALIZATION_BANNER.includes('AURORA') && NEBULA_COUNCIL_INITIALIZATION_BANNER.includes('LUMEN') && !/SOLARA/.test(NEBULA_COUNCIL_INITIALIZATION_BANNER) && !/ASTRA/.test(NEBULA_COUNCIL_INITIALIZATION_BANNER), NEBULA_COUNCIL_INITIALIZATION_BANNER)
check('DEDUPE-HELPER', dedupeFailureCopy('Same failure. Same failure.') === 'Same failure.', dedupeFailureCopy('Same failure. Same failure.'))

const statusFinal = commitFinalTranscript(
  [{ id: 'u1', role: 'user', content: 'what is the status' }],
  { id: 'a1', content: liveBrief },
)
check('FINAL-1', statusFinal.some(line => line.role === 'assistant' && line.content.startsWith('War Room is online.')), statusFinal)

const warned = commitFinalTranscript(
  [
    { id: 'u1', role: 'user', content: 'what is the status' },
    { id: 'bad', role: 'assistant', content: 'Provider issues — Aurora did not complete this Council round.' },
  ],
  { id: 'a1', content: liveBrief },
)
check('FINAL-2', warned.filter(line => line.role === 'assistant').length === 1 && warned.some(line => line.content.startsWith('War Room is online.')), warned)
check('FINAL-10', !warned.some(line => /Provider issues|did not complete this Council round/i.test(line.content)), warned)

const replaced = commitFinalTranscript(
  [{ id: 'pending', role: 'assistant', content: 'Council coordinating', pending: true }],
  { id: 'a1', content: liveBrief, pendingId: 'pending' },
)
check('FINAL-3', replaced.length === 1 && replaced[0]?.id === 'a1' && replaced[0]?.content.startsWith('War Room is online.'), replaced)

const complete = resolveRoundTerminal({ readableFinal: liveBrief })
const failedRound = resolveRoundTerminal({ readableFinal: null, missionFailed: true })
check('FINAL-4', complete === 'COMPLETE' && shellClearsAfterTerminal(complete) && failedRound === 'FAILED' && shellClearsAfterTerminal(failedRound), { complete, failedRound })

const aurora: LocalTranscriptMessage = {
  id: 'a1',
  familyName: 'AURORA',
  content: liveBrief,
  timestamp: '5:00 PM',
  color: '#93C5FD',
  icon: '◆',
  provider: '',
  messageType: 'response',
}
const stored = writeSessionTranscript({}, 's-status', [
  { ...aurora, id: 'u1', familyName: "RA'EL", content: 'what is the status', messageType: 'decree' },
  aurora,
])
const hydrated = readSessionTranscript(stored, 's-status')
check('FINAL-5', hydrated.some(row => row.content.startsWith('War Room is online.')), hydrated.map(row => row.id))
const withSecond = writeSessionTranscript(stored, 's-other', [{ ...aurora, id: 'o1', content: 'Other answer' }])
check('FINAL-6', readSessionTranscript(withSecond, 's-status').some(row => row.content.startsWith('War Room is online.')) && readSessionTranscript(withSecond, 's-other')[0]?.content === 'Other answer', true)

const partial = commitFinalTranscript(
  [{ id: 'bad', role: 'assistant', content: 'Provider issues — Pulsar did not complete this Council round.' }],
  { id: 'syn', content: 'Mixture-of-experts routes tokens to a subset of experts. One source could not be opened, so this is a partial reading.' },
)
check('FINAL-7', partial.length === 1 && /partial reading/.test(partial[0]?.content ?? '') && !/Provider issues/.test(partial[0]?.content ?? ''), partial)
check('FINAL-7-PHASE', resolveRoundTerminal({ readableFinal: partial[0]?.content ?? '', partial: true }) === 'PARTIAL', true)

const oneFailure = humanTerminalFailure('Authenticated session required.')
const rawFailure = humanTerminalFailure('claim_abc e-ORION-r1 provider stack failed')
check('FINAL-8', oneFailure === 'Council could not complete this round.' && rawFailure === 'Council could not complete this round.', { oneFailure, rawFailure })

const fromStream = commitFinalTranscript([], { id: 'same', content: liveBrief })
const fromDirect = commitFinalTranscript([], { id: 'same', content: liveBrief })
check('FINAL-9', fromStream[0]?.content === fromDirect[0]?.content && isPreExecutionStreamFailure('chat_route_error') && shouldDetachConversationBinding({ status: 401, code: 'UNAUTHENTICATED' }) && !shouldDetachConversationBinding({ status: 503, code: 'SUPABASE_UNAVAILABLE' }), true)

const pageSource = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8')
const beginTool = pageSource.slice(pageSource.indexOf('const beginToolRequest'), pageSource.indexOf('const cancelActiveCouncilRequest'))
check('TOOL-TIMEOUT-NO-ABORT-DECREE', beginTool.includes('beginToolRequest') && !/controller\.abort\(/.test(beginTool) && !/Research timed out/.test(beginTool), beginTool.includes('beginToolRequest'))
check('TOOL-TIMEOUT-NO-FAKE-IDLE', !/setLoading\(false\)/.test(beginTool), 'tool HUD must not force Idle while the decree stream is live')
const delibIdx = pageSource.indexOf('const deliberation = deliberationData.familyDeliberation')
const delibBlock = delibIdx >= 0 ? pageSource.slice(delibIdx, delibIdx + 9000) : ''
check('RESEARCH-PAINT-SINGLE-RESPONSE', delibBlock.includes("createMessageId('aurora-final')") && delibBlock.includes('councilSingleResponse'), delibIdx)

const researchSend = 'Research current mixture-of-experts inference methods using primary sources.'
const researchMission = classifyEvidenceBoardMission({ commanderMessage: researchSend })
check('RESEARCH-FINAL-1', evidenceBoardTerminatesFamilyRequest(researchMission.mission_class) && researchMission.mission_class === 'DEEP_RESEARCH', researchMission.mission_class)
const researchText = 'Mixture-of-experts inference routes each token to a subset of experts. Primary writeups describe expert parallelism and capacity limits.'
const researchFinal = commitFinalTranscript(
  [{ id: 'u-research', role: 'user', content: researchSend }],
  { id: 'aurora-research', content: researchText },
)
check('RESEARCH-FINAL-2', researchFinal.some(line => line.role === 'assistant' && line.content === researchText), researchFinal.length)
check('RESEARCH-FINAL-3', resolveRoundTerminal({ readableFinal: null }) === 'IDLE' && !shellClearsAfterTerminal('IDLE') && !legacyWebToolOwnsRound({ toolIntent: true, missionClass: 'DEEP_RESEARCH' }), true)
check('RESEARCH-FINAL-4', resolveRoundTerminal({ readableFinal: researchText, partial: evidenceCompletionKeepsFindings('PARTIALLY_VERIFIED') }) === 'PARTIAL', true)
const evidenceFirst = toNormalChatText(`${researchText}\nOne retrieval failed.\nTOOL_BLOCKED broker.fetch CURRENT_LIVE claim_abc`)
check('RESEARCH-FINAL-5', evidenceFirst.startsWith('Mixture-of-experts') && !/TOOL_BLOCKED|broker\.fetch|CURRENT_LIVE|claim_/.test(evidenceFirst), evidenceFirst)
check('RESEARCH-FINAL-6', humanTerminalFailure('TOOL_BLOCKED broker.fetch') === 'Council could not complete this round.' && resolveRoundTerminal({ readableFinal: null, missionFailed: true }) === 'FAILED', true)
const persistedResearch = writeSessionTranscript({}, 's-research', [
  { id: 'u-research', familyName: "RA'EL", content: researchSend, timestamp: '6:00 PM', color: '#fff', icon: '◆', provider: '', messageType: 'decree' },
  { id: 'aurora-research', familyName: 'AURORA', content: researchText, timestamp: '6:01 PM', color: '#93C5FD', icon: '◆', provider: 'chatgpt', messageType: 'response' },
])
check('RESEARCH-FINAL-7', readSessionTranscript(persistedResearch, 's-research').some(row => row.content === researchText), true)
const hydratedResearch = readSessionTranscript(persistedResearch, 's-research').find(row => row.familyName === 'AURORA')
const briefing = buildCommanderOperationFromMessages([{
  id: hydratedResearch?.id ?? 'aurora-research',
  familyName: 'AURORA',
  content: hydratedResearch?.content ?? '',
  timestamp: hydratedResearch?.timestamp ?? '',
  messageType: 'response',
  provider: 'chatgpt',
  isFinal: persistedAuroraIsTerminalBrief({
    messageType: hydratedResearch?.messageType,
    familyName: hydratedResearch?.familyName,
    provider: hydratedResearch?.provider,
    content: hydratedResearch?.content,
  }),
  requestText: researchSend,
}])
check('RESEARCH-FINAL-8', briefing.briefing.body.includes('Mixture-of-experts') && !briefing.briefing.body.includes('No final Commander briefing was emitted'), briefing.briefing.body.slice(0, 180))
check('RESEARCH-FINAL-9', briefing.events.some(event => event.type === 'synthesis_completed') && briefing.briefing.body.includes('experts'), briefing.events.map(event => event.type))
check('RESEARCH-FINAL-10', !/TOOL_BLOCKED|broker\.fetch|CURRENT_LIVE|claim_|e-orion/i.test(toNormalChatText('Findings first.\nTOOL_BLOCKED broker.fetch CURRENT_LIVE claim_1 e-orion-r1')), toNormalChatText('Findings first.\nTOOL_BLOCKED broker.fetch CURRENT_LIVE claim_1 e-orion-r1'))
check('RESEARCH-STATUS-STILL', evidenceBoardTerminatesFamilyRequest('SYSTEM_STATUS') && !evidenceBoardTerminatesFamilyRequest('ENGINEERING'), true)

const moeClass = classifyEvidenceBoardMission({ commanderMessage: MOE_RESEARCH_PROMPT })
check('WEB-5', moeClass.mission_class === 'DEEP_RESEARCH' && moeClass.required_tools.includes('broker.fetch') && moeClass.selected_agents.includes('PULSAR'), {
  class: moeClass.mission_class,
  tools: moeClass.required_tools,
  agents: moeClass.selected_agents,
})
check('WEB-2', beginTool.includes('beginToolRequest') && !/controller\.abort\(/.test(beginTool) && !/Research timed out/.test(beginTool) && !/setLoading\(false\)/.test(beginTool), 'HUD timeout must not abort the decree')
check('WEB-1', DECREE_GATHER_HARD_HANG_MS >= 240_000 && /TOOL_REQUEST_TIMEOUT_MS = 45000/.test(pageSource) && DECREE_GATHER_HARD_HANG_MS > 45_000, {
  hang: DECREE_GATHER_HARD_HANG_MS,
})

type FixtureEvidence = EbcEvidence & BoardRowProvenance & { url: string }

function evidenceRow(partial: Partial<EbcEvidence> & Pick<EbcEvidence, 'evidence_id' | 'summary'> & { url: string }): FixtureEvidence {
  const now = '2026-09-22T18:00:00.000Z'
  return {
    mission_id: 'fixture-mission',
    timestamp: now,
    provenance: 'validation_fixture',
    kind: 'primary_external',
    pointer: partial.url || '',
    retrieved_at: now,
    observed_at: now,
    tool_name: 'broker.fetch',
    temporal_layer: 'CURRENT_LIVE',
    agent_id: 'PULSAR',
    round: 1,
    title: partial.title ?? 'Mixture-of-Experts paper',
    source_type: 'primary_external',
    ok: true,
    ...partial,
  }
}

const arxivA = evidenceRow({
  evidence_id: 'e-arxiv-a',
  url: 'https://arxiv.org/abs/1701.06538',
  final_url: 'https://arxiv.org/abs/1701.06538',
  title: 'Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer',
  summary: 'Shazeer et al. introduce sparsely-gated mixture-of-experts layers that route tokens to a subset of experts.',
})
const arxivB = evidenceRow({
  evidence_id: 'e-arxiv-b',
  url: 'https://arxiv.org/abs/2401.04088',
  final_url: 'https://arxiv.org/abs/2401.04088',
  title: 'Mixtral of Experts',
  summary: 'Mixtral describes sparse expert routing where each token is processed by a small set of experts rather than the full model.',
})
const failedFetch = evidenceRow({
  evidence_id: 'e-fail',
  ok: false,
  url: 'https://example.invalid/moe',
  title: 'failed',
  summary: 'Browser research opened no usable sources.',
  kind: 'tool_result',
  source_type: 'tool_result',
})
const seoBlog = evidenceRow({
  evidence_id: 'e-seo',
  url: 'https://medium.com/moe-explained',
  title: 'MoE explained',
  summary: 'A blog summary of mixture of experts without the original paper.',
  kind: 'secondary_external',
  source_type: 'secondary_external',
})

const usable = collectUsableSources([arxivA, arxivB, failedFetch, seoBlog])
check('WEB-3', usable.length >= 2 && new Set(usable.map(row => row.url)).size >= 2, usable.map(row => row.url))
check('WEB-4', !usable.some(row => row.url.includes('example.invalid')) && isFailedFetchRow(failedFetch) && scoreWebResearch({
  evidence: [arxivA, arxivB, failedFetch],
  auroraText: 'What I found:\n- Sparse routing\nSources:\n- Mixtral — https://arxiv.org/abs/2401.04088\n- MoE layer — https://arxiv.org/abs/1701.06538',
  requirePrimary: true,
  idleAfter: true,
}).failed_fetch_counted === false, usable.map(row => row.url))
check('WEB-5-PRIMARY-URL', isPrimaryAuthoritativeUrl(arxivA.url) && isPrimaryAuthoritativeUrl(arxivB.url) && !isPrimaryAuthoritativeUrl(seoBlog.url), {
  a: arxivA.url,
  b: arxivB.url,
  seo: seoBlog.url,
})

const board = createEvidenceBoard({
  mission_id: 'web-ebc',
  mission_class: 'DEEP_RESEARCH',
  question: MOE_RESEARCH_PROMPT,
  agents: ['PULSAR', 'LUMEN', 'AURORA'],
  ttl_seconds: 600,
  budget_tokens: 4000,
  budget_ms: 60_000,
})
board.evidence.push(arxivA, arxivB, failedFetch)
check('WEB-6', collectUsableSources(board.evidence).length >= 2 && board.evidence.filter(row => !row.ok).length === 1, board.evidence.map(row => ({ id: row.evidence_id, ok: row.ok })))

const lumenOk = verifyClaimLumen({
  claim: {
    claim_id: 'c-moe',
    text: 'Mixture-of-experts inference routes each token to a subset of experts.',
    status: 'PROPOSED',
    evidence_ids: ['e-arxiv-a', 'e-arxiv-b'],
    confidence: 0.8,
    label: 'VERIFIED_FACT',
    temporal_layer: 'CURRENT_LIVE',
    critical: true,
    agent_id: 'PULSAR',
    round: 1,
  },
  evidence: [arxivA, arxivB],
  ttlSeconds: 600,
  missionClass: 'DEEP_RESEARCH',
  rechecked: [],
  now: Date.parse('2026-09-22T18:00:01.000Z'),
})
const lumenEmpty = verifyClaimLumen({
  claim: {
    claim_id: 'c-empty',
    text: 'MoE is verified without sources.',
    status: 'PROPOSED',
    evidence_ids: [],
    confidence: 0.9,
    label: 'VERIFIED_FACT',
    temporal_layer: 'CURRENT_LIVE',
    critical: true,
    agent_id: 'PULSAR',
    round: 1,
  },
  evidence: [],
  ttlSeconds: 600,
  missionClass: 'DEEP_RESEARCH',
  rechecked: [],
})
check('WEB-7', lumenOk.verdict === 'SUPPORTED' || lumenOk.verdict === 'UNSUPPORTED' || lumenOk.verdict === 'UNKNOWN', lumenOk)
check('WEB-7-NO-SOURCE', lumenEmpty.verdict !== 'SUPPORTED' && lumenEmpty.reason.includes('no_evidence'), lumenEmpty)

const auroraText = formatCommanderBrief(moeClass, {
  mission_class: 'DEEP_RESEARCH',
  completion_state: 'PARTIALLY_VERIFIED',
  confidence: 0.7,
  verified_facts: [{ text: 'Tokens are routed to a subset of experts.', evidence_ids: ['e-arxiv-a'], temporal_layer: 'CURRENT_LIVE', claim_id: 'c-moe' }],
  partially_verified: [{ text: 'Mixtral documents sparse expert parallelism.', evidence_ids: ['e-arxiv-b'], claim_id: 'c-mix' }],
  unverified: [],
  conflicts: [],
  unknowns: [],
  tool_blocks: [],
  risks: [],
  next_actions: [],
  advisory: true,
  commander_authority: 'REQUIRED_FOR_ACTION',
}, board)
check('WEB-8', publicSourcesVisible(auroraText) && publicResearchIsClean(auroraText) && /arxiv\.org/.test(auroraText), auroraText.slice(0, 500))

const partialRecovery = recoverFromToolFailure({ tool_name: 'broker.fetch', ok: false, remaining_ok: 1 })
const lumenSupported: LumenVerification = {
  claim_id: 'c-moe',
  verdict: 'SUPPORTED',
  reason: 'primary_external',
  rechecked_evidence_ids: ['e-arxiv-a', 'e-arxiv-b'],
  independent_probe: false,
}
const partialScore = scoreWebResearch({
  evidence: [arxivA, arxivB, failedFetch],
  lumen: [lumenSupported],
  auroraText,
  requirePrimary: true,
  idleAfter: true,
})
check('WEB-9', partialRecovery.continue_mission && Boolean(partialRecovery.alternate) && partialScore.pass && /uncertain|limited|second retrieval/i.test(auroraText), {
  recovery: partialRecovery.commander_text,
  score: partialScore,
})

const emptyBoard = createEvidenceBoard({
  mission_id: 'web-fail',
  mission_class: 'DEEP_RESEARCH',
  question: MOE_RESEARCH_PROMPT,
  agents: ['PULSAR'],
  ttl_seconds: 120,
  budget_tokens: 1,
  budget_ms: 1,
})
const failText = formatCommanderBrief(moeClass, {
  mission_class: 'DEEP_RESEARCH',
  completion_state: 'TOOL_BLOCKED',
  confidence: 0,
  verified_facts: [],
  partially_verified: [],
  unverified: [],
  conflicts: [],
  unknowns: ['Browser research opened no usable sources.'],
  tool_blocks: ['broker.fetch: Browser research opened no usable sources.'],
  risks: [],
  next_actions: [],
  advisory: true,
  commander_authority: 'REQUIRED_FOR_ACTION',
}, emptyBoard)
check('WEB-10', honestResearchFailure(failText) && !/arxiv\.org/.test(failText) && !/\bVERIFIED\b/.test(failText), failText)

const fresh = sourceIsWithinDays('2026-09-10T00:00:00.000Z', CURRENT_INFO_WINDOW_DAYS, Date.parse('2026-09-22T00:00:00.000Z'))
const stale = sourceIsWithinDays('2024-01-01T00:00:00.000Z', CURRENT_INFO_WINDOW_DAYS, Date.parse('2026-09-22T00:00:00.000Z'))
check('WEB-11', fresh === true && stale === false, { fresh, stale })

const synthesized = crossSourceSynthesized(
  'What I found:\n- Sparse gating from Shazeer.\n- Mixtral routes tokens to two experts.\nWhat is verified:\n- Both papers describe expert subset routing.\nSources:\n- https://arxiv.org/abs/1701.06538\n- https://arxiv.org/abs/2401.04088',
  collectUsableSources([arxivA, arxivB]),
)
check('WEB-8-SYNTH', synthesized, synthesized)
check('WEB-12', readSessionTranscript(persistedResearch, 's-research').some(row => row.content === researchText) && persistedAuroraIsTerminalBrief({
  messageType: 'response',
  familyName: 'AURORA',
  provider: 'chatgpt',
  content: researchText,
}), true)

const ddgUnwrapped = unwrapSearchResultUrl('https://duckduckgo.com/l/?uddg=https%3A%2F%2Farxiv.org%2Fabs%2F2101.03961&rut=abc')
check('RESEARCH-TRUTH-DISCOVERY', ddgUnwrapped.includes('arxiv.org/abs/2101.03961') && constructResearchQueries(MOE_RESEARCH_PROMPT).some(q => /arxiv|mixture of experts/i.test(q)), { ddgUnwrapped, queries: constructResearchQueries(MOE_RESEARCH_PROMPT) })
check('RESEARCH-TRUTH-CANDIDATE', Boolean(toCandidate({ url: ddgUnwrapped, title: 'Switch Transformer', discovered_by: 'search', query: MOE_RESEARCH_PROMPT, rank: 1 })), ddgUnwrapped)

const lumenZero = verifyClaimLumen({
  claim: {
    claim_id: 'c-zero',
    text: 'MoE routing is verified from memory.',
    status: 'PROPOSED',
    evidence_ids: ['e-fail'],
    confidence: 0.9,
    label: 'VERIFIED_FACT',
    temporal_layer: 'CURRENT_LIVE',
    critical: true,
    agent_id: 'PULSAR',
    round: 1,
  },
  evidence: [failedFetch],
  ttlSeconds: 600,
  missionClass: 'DEEP_RESEARCH',
  rechecked: [],
})
check('RESEARCH-TRUTH-1', lumenZero.verdict !== 'SUPPORTED' && lumenZero.reason === 'no_usable_sources' && (lumenZero.source_count ?? 0) === 0, lumenZero)
check('RESEARCH-TRUTH-2', !isUsableExternalEvidence(failedFetch) && collectUsableSources([failedFetch, arxivA]).every(row => row.url !== failedFetch.url), failedFetch.ok)

const dupPdf = evidenceRow({
  evidence_id: 'e-arxiv-a-pdf',
  url: 'https://arxiv.org/pdf/1701.06538',
  final_url: 'https://arxiv.org/pdf/1701.06538',
  title: arxivA.title,
  summary: arxivA.summary,
})
check('RESEARCH-TRUTH-3', paperIdentity(arxivA.url) === paperIdentity(dupPdf.url) && independentSourceCount([arxivA, dupPdf]) === 1, {
  a: paperIdentity(arxivA.url),
  pdf: paperIdentity(dupPdf.url),
  independent: independentSourceCount([arxivA, dupPdf]),
})

check('RESEARCH-TRUTH-4', lumenOk.verdict === 'SUPPORTED' && (lumenOk.evidence_refs?.length ?? 0) >= 1 && (lumenOk.source_count ?? 0) >= 1, lumenOk)
check('RESEARCH-TRUTH-5', isPrimaryAuthoritativeUrl(arxivA.url) && isPrimaryAuthoritativeUrl(arxivB.url) && !isPrimaryAuthoritativeUrl(seoBlog.url) && collectUsableSources([arxivA, seoBlog]).filter(row => row.primary).length >= 1, {
  primaryA: isPrimaryAuthoritativeUrl(arxivA.url),
  seo: isPrimaryAuthoritativeUrl(seoBlog.url),
})

const shellOnly = evidenceRow({
  evidence_id: 'e-shell',
  url: 'https://arxiv.org/abs/2101.03961',
  title: 'Switch Transformer',
  summary: 'ok',
})
check('RESEARCH-TRUTH-6', isUsableExternalEvidence(arxivA) && !isUsableExternalEvidence(shellOnly), { a: arxivA.summary.length, shell: shellOnly.summary.length })

const auroraBoardOnly = synthesizeAurora({
  mission_id: 'web-ebc',
  mission_class: 'DEEP_RESEARCH',
  claims: [{
    claim_id: 'c-mem',
    text: 'Invented finding with no board source',
    status: 'VERIFIED',
    evidence_ids: ['e-missing'],
    confidence: 0.9,
    label: 'VERIFIED_FACT',
    temporal_layer: 'CURRENT_LIVE',
    critical: true,
    agent_id: 'PULSAR',
    round: 1,
  }],
  evidence: [arxivA, arxivB],
  conflicts: [],
  unknowns: [],
  tool_blocks: [],
  risks: [],
  tests_recommended: [],
}, 'VERIFIED', 0.9)
check('RESEARCH-TRUTH-7', auroraBoardOnly.verified_facts.length === 0, auroraBoardOnly.verified_facts)

check('RESEARCH-TRUTH-8', honestResearchFailure(failText) && /couldn['’]t verify this from usable live sources/i.test(failText), failText)

const partialUsable = collectUsableSources([arxivA, arxivB, failedFetch])
check('RESEARCH-TRUTH-9', partialUsable.length === 2 && !partialUsable.some(row => row.url.includes('example.invalid')), partialUsable.map(row => row.url))

check('RESEARCH-TRUTH-10', fresh === true && stale === false, { fresh, stale })

check('RESEARCH-TRUTH-11', persistedAuroraIsTerminalBrief({
  messageType: 'response',
  familyName: 'AURORA',
  provider: 'chatgpt',
  content: researchText,
}) && Boolean(researchText.trim()), true)

check('RESEARCH-TRUTH-12', shellClearsAfterTerminal(resolveRoundTerminal({ readableFinal: researchText })) && !shellClearsAfterTerminal(resolveRoundTerminal({ readableFinal: '' })), {
  withFinal: resolveRoundTerminal({ readableFinal: researchText }),
  empty: resolveRoundTerminal({ readableFinal: '' }),
})

const promotedBoard = createEvidenceBoard({
  mission_id: 'promo',
  mission_class: 'DEEP_RESEARCH',
  question: MOE_RESEARCH_PROMPT,
  agents: ['PULSAR', 'LUMEN'],
  ttl_seconds: 600,
  budget_tokens: 4000,
  budget_ms: 60_000,
})
const sourcelessClaim: EbcClaim & BoardRowProvenance = {
  mission_id: 'fixture-mission',
  timestamp: '2026-09-22T18:00:00.000Z',
  provenance: 'validation_fixture',
  claim_id: 'c-empty-promo',
  text: 'Verified without sources',
  status: 'SUPPORTED',
  evidence_ids: [],
  confidence: 0.9,
  label: 'VERIFIED_FACT',
  temporal_layer: 'CURRENT_LIVE',
  critical: true,
  agent_id: 'PULSAR',
  round: 1,
}
promotedBoard.claims.push(sourcelessClaim)
applyLumenPromotion(promotedBoard, [{
  claim_id: 'c-empty-promo',
  verdict: 'SUPPORTED',
  reason: 'fabricated',
  rechecked_evidence_ids: [],
  independent_probe: false,
  evidence_refs: [],
  source_count: 0,
}])
check('RESEARCH-TRUTH-1-PROMO', promotedBoard.claims[0].status !== 'VERIFIED', promotedBoard.claims[0].status)
const demoted = demoteSourcelessExternalClaims(promotedBoard.claims, promotedBoard.evidence, [{
  claim_id: 'c-empty-promo',
  verdict: 'SUPPORTED',
  reason: 'fabricated',
  rechecked_evidence_ids: [],
  independent_probe: false,
}])
check('RESEARCH-TRUTH-1-DEMOTE', demoted.claims[0].status === 'UNVERIFIED' && demoted.lumen[0].verdict !== 'SUPPORTED', demoted.lumen[0])

const synthesis = {
  messageType: 'response' as const,
  familyName: 'AURORA',
  turnRole: 'council_synthesis',
  content: 'What I found:\n- Sparse expert routing.\nSources:\n- https://arxiv.org/abs/1701.06538',
}
check('STREAM-1', isCommanderSynthesisMessage(synthesis), synthesis)
check('STREAM-2', decreeTurnMatchesOperationKey('deliberation:sess:turn:decree-1', 'decree-1'), 'active session keeps the final')
check('STREAM-3', !decreeTurnMatchesOperationKey('turn:decree-9', 'decree-1'), 'stale decree does not match')
check('STREAM-4', shellClearsAfterTerminal('COMPLETE') && !shellClearsAfterTerminal('IDLE'), {
  complete: shellClearsAfterTerminal('COMPLETE'),
  idle: shellClearsAfterTerminal('IDLE'),
})

const titleOnly = evidenceRow({
  evidence_id: 'e-title-only',
  url: 'https://arxiv.org/abs/1701.06538',
  final_url: 'https://arxiv.org/abs/1701.06538',
  title: 'MoE',
  summary: 'MoE',
})
const lumenTitleOnly = verifyClaimLumen({
  claim: {
    claim_id: 'c-title-only',
    text: 'Mixture-of-experts routing is verified.',
    status: 'PROPOSED',
    evidence_ids: ['e-title-only'],
    confidence: 0.9,
    label: 'VERIFIED_FACT',
    temporal_layer: 'CURRENT_LIVE',
    critical: true,
    agent_id: 'PULSAR',
    round: 1,
  },
  evidence: [{ ...titleOnly, ok: true }],
  ttlSeconds: 600,
  missionClass: 'DEEP_RESEARCH',
  rechecked: [],
})
check('RESEARCH-1', lumenTitleOnly.verdict !== 'SUPPORTED', lumenTitleOnly)
check('RESEARCH-2', !isUsableExternalEvidence(failedFetch) && collectUsableSources([arxivA, failedFetch]).every(row => row.url !== failedFetch.url), true)
check('RESEARCH-3', paperIdentity('https://arxiv.org/abs/1701.06538') === paperIdentity('https://arxiv.org/pdf/1701.06538'), paperIdentity('https://arxiv.org/pdf/1701.06538'))
check('RESEARCH-4', lumenOk.verdict !== 'SUPPORTED' || (lumenOk.evidence_refs?.length ?? 0) > 0, lumenOk)
check('RESEARCH-5', wantsPrimarySources(MOE_RESEARCH_PROMPT) && collectUsableSources([arxivA, arxivB]).filter(row => row.primary).length >= 2, true)
check('RESEARCH-6', !isUsableExternalEvidence(titleOnly) && isUsableExternalEvidence(arxivA), { title: titleOnly.summary.length, paper: arxivA.summary.length })
check('RESEARCH-7', publicResearchIsClean(auroraText) && /arxiv\.org/.test(auroraText) && !/broker\.fetch|TOOL_BLOCKED|CURRENT_LIVE/.test(toNormalChatText(auroraText)), auroraText.slice(0, 240))
check('RESEARCH-8', collectUsableSources([arxivA, arxivB, failedFetch]).length === 2, true)
check('RESEARCH-9', honestResearchFailure(noUsableSourcesBrief()) && !/https?:\/\//.test(noUsableSourcesBrief()), noUsableSourcesBrief())
check('RESEARCH-10', fresh === true && stale === false, { fresh, stale })

const failed = checks.filter(row => !row.pass)
console.log(JSON.stringify({ pass: failed.length === 0, total: checks.length, failed: failed.map(row => row.id) }, null, 2))
if (failed.length) process.exit(1)
