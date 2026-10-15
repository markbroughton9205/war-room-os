import { understandTurn, normalizeCommanderText } from './language'
import { answerSelfKnowledge, collectInstalledState, isSelfKnowledgeQuestion } from './knowledge'
import { coordinate, planSerialExecution, type RosterMember } from './coordinator'
import { accountResearch, judgeSource } from './research'
import { createLedger, deriveTurnStatus, modelActor, record, summarizeLedger, COORDINATOR_ACTOR } from './provenance'
import { buildAttribution } from './attribution'
import { buildContinuationResponse } from './continuation'
import { runStage1Turn } from './server'
import { buildTurnRecord, mergeTurnRecord, readStage1Metadata, upsertTurn, STAGE1_MAX_TURNS } from './record'
import { researchUiFromReport } from './researchUi'
import { applyCoverage, claimsFromSources, sourcesFromRouter } from './researchRun'
import { answerRecall } from './recall'
import type { HistoryTurn } from './types'

let pass = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++
  else failures.push(`${name}${detail ? ' :: ' + detail : ''}`)
}

const ROSTER: RosterMember[] = [
  { id: 'AURORA', role: 'Integrator / final Council synthesis', expertise: ['synthesis', 'integrat'], model: 'qwen3:14b', heavy: false },
  { id: 'ORION', role: 'Architecture / systems', expertise: ['architecture', 'design', 'boundary', 'persist', 'orchestrat'], model: 'devstral:24b', heavy: true },
  { id: 'PULSAR', role: 'Research / signals / evidence', expertise: ['research', 'evidence', 'sources', 'signals'], model: 'qwen3:14b', heavy: false },
  { id: 'LUMEN', role: 'Risk / critique', expertise: ['risk', 'failure', 'security', 'reliab'], model: 'gemma3:12b', heavy: false },
  { id: 'NOVA', role: 'Strategy / planning', expertise: ['plan', 'strategy', 'sequence'], model: 'qwen3:14b', heavy: false },
]
const STATE = collectInstalledState({
  exists: p => p !== 'app/higher-vision-studios/page.tsx',
  readStamp: () => JSON.stringify({ install_id: 'war-room-os-test', gitShort: 'abc12345', builtAt: '2026-10-15T00:00:00Z' }),
  roster: [
    { id: 'aurora', name: 'AURORA', role: 'Integrator', status: 'active' },
    { id: 'orion', name: 'ORION', role: 'Architecture', status: 'active' },
    { id: 'solara', name: 'SOLARA', role: 'Future', status: 'foundation' },
  ],
  sharedLocalModel: 'huihui_ai/qwen3-abliterated:14b',
})

// --- language: slang/misspelling
const slang = normalizeCommanderText("whats ur purpse in warroom rn?")
check('slang expands', slang.text.includes('what is your') && slang.text.includes('war room') && slang.text.includes('right now'), slang.text)
check('misspelling repaired', slang.text.includes('purpose'), slang.text)
check('typo council', normalizeCommanderText('wat is the councl').text === 'what is the council', normalizeCommanderText('wat is the councl').text)
check('no false repair of ordinary words', normalizeCommanderText('please review this').text === 'please review this')

// --- question vs command
check('question not execution', understandTurn({ text: 'what do you do?' }).executionRequested === false)
check('how do I run is question', understandTurn({ text: 'how do I run a mission?' }).act === 'question')
const cmd = understandTurn({ text: 'run the foundry mission' })
check('command detected', cmd.act === 'command' && cmd.executionRequested)
const vague = understandTurn({ text: 'deploy it' })
check('vague command asks clarification', vague.clarification !== null)

// --- follow-up / reference / correction / continuation
const hist: HistoryTurn[] = [
  { role: 'commander', text: 'tell me about foundry' },
  { role: 'member', memberId: 'ORION', text: 'Foundry runs engineering missions. Terra is the globe; Foundry is the builder.' },
]
const other = understandTurn({ text: 'what about the other one?', history: hist })
check('other-one resolves to the alternative', other.references[0]?.resolvedTo === 'terra', JSON.stringify(other.references))
check('other-one topic carried', other.topics.includes('terra'))
const corr = understandTurn({ text: "no, that's not what i meant, i meant terra", history: hist })
check('correction act', corr.act === 'correction')
check('correction replacement captured', corr.correction?.replacement === 'terra', JSON.stringify(corr.correction))
check('correction supersedes previous', corr.correction?.supersedes === 'tell me about foundry')
check('correction topic is terra', corr.topics.includes('terra'))
const noctx = understandTurn({ text: 'and that one?' })
check('follow-up without context asks', noctx.clarification !== null)
check('continuation', understandTurn({ text: 'continue where we stopped', history: hist }).continuation === true)
check('topic change allowed', understandTurn({ text: 'ok different thing: how does terra get data?', history: hist }).topics.includes('terra'))
check('short follow-up keeps topic', understandTurn({ text: 'why?', history: hist }).topics.includes('foundry'))

// --- self knowledge routing
const purpose = understandTurn({ text: "What's your purpose inside War Room?" })
check('purpose is self-knowledge', isSelfKnowledgeQuestion(purpose))
const sk = answerSelfKnowledge(purpose, STATE)
check('self answer has no external research', sk.externalResearch === false)
check('self answer names install', sk.text.includes('war-room-os-test'))
check('self answer discloses shared model', sk.text.includes('qwen3-abliterated:14b') && /shared local model/.test(sk.text))
check('planned marked planned', sk.text.includes('[PLANNED]'))
check('foundation members not called live', /Registered but not yet live: SOLARA/.test(sk.text))
const hvs = answerSelfKnowledge(understandTurn({ text: 'what is higher vision studios' }), STATE)
check('unverified capability labelled', hvs.text.includes('NOT verified present'), hvs.text.slice(0, 200))
check('external query not self-knowledge', !isSelfKnowledgeQuestion(understandTurn({ text: 'what is the latest news about the war room of Germany' })))

// --- coordinator
const dSelf = coordinate({ turnId: 't1', understanding: purpose, roster: ROSTER })
check('self route uses no members', dSelf.route === 'self_knowledge' && dSelf.members.length === 0)
const dSimple = coordinate({ turnId: 't2', understanding: understandTurn({ text: 'is the sky blue' }), roster: ROSTER })
check('simple => one member', dSimple.members.length === 1, JSON.stringify(dSimple))
const arch = understandTurn({ text: 'How should we design the persistence boundary between Council sessions and Foundry missions so failures do not corrupt either?' })
const dArch = coordinate({ turnId: 't3', understanding: arch, roster: ROSTER })
check('architecture => >=3 members', dArch.members.length >= 3, JSON.stringify(dArch.members))
check('architecture includes ORION', dArch.members.includes('ORION'))
check('synthesizer kept', dArch.members.includes('AURORA'))
check('excluded have reasons', dArch.excluded.every(e => e.reason.length > 0))
check('heavy local serialized', dArch.serializeHeavyLocal === true)
check('execution is handoff', coordinate({ turnId: 't4', understanding: cmd, roster: ROSTER }).route === 'handoff')
check('addressed member only', coordinate({ turnId: 't5', understanding: arch, roster: ROSTER, addressed: ['LUMEN'] }).members.join() === 'LUMEN')
const order = planSerialExecution(ROSTER, 'qwen3:14b').map(m => m.model)
check('resident model first, models grouped', order[0] === 'qwen3:14b' && order.join().replace(/(qwen3:14b,)+/, 'Q,') === 'Q,devstral:24b,gemma3:12b', order.join())

// --- research integrity
const src = [
  { url: 'https://a.example/x', title: 'Council memory design', excerpt: 'Conversation memory persistence in multi agent councils is stored per session with threading '.repeat(2), httpStatus: 200, region: 'US' },
  { url: 'https://b.example/y', title: 'Other', excerpt: 'Multi agent council conversation memory should not persist across users; persistence is per session and isolated '.repeat(2), httpStatus: 200, region: 'DE' },
  { url: 'https://c.example/z', title: 'blocked', excerpt: '', httpStatus: 403 },
  { url: 'https://d.example/w', title: 'Cooking pasta', excerpt: 'boil water add salt cook pasta eight minutes drain serve with sauce and cheese '.repeat(2), httpStatus: 200 },
  { url: null, title: 'no url', excerpt: 'council conversation memory persistence '.repeat(5) },
]
const acc = accountResearch({
  topic: 'council conversation memory persistence',
  sources: src,
  claims: [
    { id: 'c1', text: 'Memory is stored per session', supports: [0, 1], contradicts: [] },
    { id: 'c2', text: 'Memory persists across users', supports: [0], contradicts: [1] },
    { id: 'c3', text: 'Sessions should be isolated', supports: [2, 3], contradicts: [] },
    { id: 'c4', text: 'Isolation implies per-user keys', supports: [1], contradicts: [], derived: true },
  ],
})
check('accepted count excludes rejected', acc.acceptedCount === 2 && acc.rejectedCount === 3, `${acc.acceptedCount}/${acc.rejectedCount}`)
check('403 rejected with reason', acc.verdicts[2].accepted === false && /403/.test(acc.verdicts[2].reason))
check('off-topic rejected', acc.verdicts[3].accepted === false && /off-topic/.test(acc.verdicts[3].reason))
check('verified', acc.claims[0].label === 'VERIFIED')
check('conflict preserved', acc.claims[1].label === 'CONFLICTING' && acc.conflicts.length === 1)
check('support from rejected sources does not verify', acc.claims[2].label === 'UNVERIFIED', acc.claims[2].label)
check('derived is inference', acc.claims[3].label === 'INFERENCE')
check('partial not completed', acc.status === 'PARTIAL')
check('regions counted from accepted only', acc.regions.sort().join() === 'DE,US')
const none = accountResearch({ topic: 'x topic here', sources: [], claims: [{ id: 'a', text: 'a', supports: [], contradicts: [] }], retrievalError: 'timeout' })
check('no sources => FAILED/UNAVAILABLE', none.status === 'FAILED' && none.claims[0].label === 'UNAVAILABLE')
check('judgeSource http', judgeSource('council memory', { url: 'ftp://x', title: 't', excerpt: 'council memory '.repeat(10) }).accepted === false)

// --- provenance and honest status
const L = createLedger('turn-1')
record(L, COORDINATOR_ACTOR, 'coordinate', 'selected ORION, AURORA', 'COMPLETED')
record(L, modelActor('ORION', 'devstral:24b', 'ollama'), 'contribute', 'architecture view', 'COMPLETED')
record(L, modelActor('AURORA', 'qwen3:14b', 'ollama'), 'synthesize', 'timed out', 'FAILED')
const sum = summarizeLedger(L)
check('ledger members', sum.members.join() === 'ORION,AURORA')
check('ledger models', sum.models.length === 2)
check('failure recorded', sum.failureCount === 1)
const st = (o: Partial<Parameters<typeof deriveTurnStatus>[0]>) => deriveTurnStatus({ required: ['A', 'B'], succeeded: [], failed: [], cancelled: false, interrupted: false, inFlight: false, waitingOnCommander: false, accepted: true, ...o })
check('accepted-only is not COMPLETED', st({}) === 'FAILED')
check('in flight RUNNING', st({ succeeded: ['A'], inFlight: true }) === 'RUNNING')
check('all done COMPLETED', st({ succeeded: ['A', 'B'] }) === 'COMPLETED')
check('some failed PARTIAL', st({ succeeded: ['A'], failed: ['B'] }) === 'PARTIAL')
check('not accepted QUEUED', st({ accepted: false }) === 'QUEUED')
check('interrupted', st({ succeeded: ['A'], interrupted: true }) === 'INTERRUPTED')
check('cancelled wins', st({ succeeded: ['A', 'B'], cancelled: true }) === 'CANCELLED')
check('waiting', st({ waitingOnCommander: true }) === 'WAITING')
check('nothing required is not completed', st({ required: [] }) === 'FAILED')

// --- attribution from real payload shapes
const payloadSeats = {
  results: [
    { family: 'AURORA', status: 'OK', content: 'x', backend: { backendType: 'LOCAL', provider: 'ollama', model: 'qwen3:14b', latencyMs: 4100 } },
    { family: 'ORION', status: 'TIMED_OUT', content: '', error: 'timed out', backend: { backendType: 'LOCAL', provider: 'ollama', model: 'devstral:24b', latencyMs: 90000 } },
  ],
}
const att = buildAttribution(payloadSeats, { ...dArch, members: ['AURORA', 'ORION', 'LUMEN'] })
check('attribution counts both seats', att.contributions.length === 2)
check('attribution PARTIAL when one timed out', att.status === 'PARTIAL', att.status)
check('selected-but-silent member listed', att.missingMembers.join() === 'LUMEN')
check('model attribution carried', att.contributions[0].model === 'qwen3:14b' && att.contributions[1].model === 'devstral:24b')
const attNone = buildAttribution({ results: [] }, null)
check('no contributions is FAILED not COMPLETED', attNone.status === 'FAILED')
const payloadDelib = {
  familyDeliberation: { turns: [
    { speaking_order: 1, agent_identity: 'ORION', provider_family: 'claude', turn_role: 'opening_position', completion_status: 'complete', provider_model: 'qwen3:14b', backend_provider: 'ollama', backend_type: 'LOCAL', output_message_id: 'm1', turn_id: 't1', challenge_target_ids: [], input_message_ids: [], direct_agreements: [], direct_disagreements: [] },
    { speaking_order: 2, agent_identity: 'LUMEN', provider_family: 'gemini', turn_role: 'red_team_challenge', completion_status: 'complete', provider_model: 'qwen3:14b', backend_provider: 'ollama', backend_type: 'LOCAL', output_message_id: 'm2', turn_id: 't2', challenge_target_ids: ['m1'], input_message_ids: [], direct_agreements: [], direct_disagreements: ['single point of failure'] },
  ] },
}
const att2 = buildAttribution(payloadDelib, null)
check('deliberation: responds-to resolved', att2.contributions[1].respondsTo.join() === 'ORION')
check('deliberation: disagreement preserved', att2.contributions[1].disagreements[0] === 'single point of failure')
check('shared-model disclosed', att2.sharedModelNote !== null && att2.distinctModels === 1)

// --- record merge / retention
const baseRec = buildTurnRecord({ turnId: 'T', decree: 'q', responseText: 'a', mode: null, understanding: understandTurn({ text: 'q?' }), decision: dArch, attribution: att })
const more = buildTurnRecord({ turnId: 'T', decree: 'q', responseText: 'b', mode: null, understanding: understandTurn({ text: 'q?' }), decision: dArch, attribution: buildAttribution({ results: [{ family: 'LUMEN', status: 'OK', content: 'y', backend: { backendType: 'LOCAL', provider: 'ollama', model: 'gemma3:12b', latencyMs: 1000 } }] }, null) })
const merged = mergeTurnRecord(baseRec, more)
check('merge unions contributions', merged.contributions.length === 3)
check('merge status PARTIAL (one timed out)', merged.status === 'PARTIAL', merged.status)
let meta = null as ReturnType<typeof upsertTurn> | null
for (let i = 0; i < STAGE1_MAX_TURNS + 5; i++) meta = upsertTurn(meta, { ...baseRec, turnId: `T${i}` })
check('retention bounded', meta!.turns.length === STAGE1_MAX_TURNS)
check('metadata roundtrip', readStage1Metadata({ councilStage1: meta })?.turns.length === STAGE1_MAX_TURNS)
check('foreign metadata ignored', readStage1Metadata({ councilStage1: { version: 2 } }) === null)

// --- research HUD honesty
const hud = researchUiFromReport({
  sourcesUnavailable: false,
  unknowns: [],
  sources: [
    { title: 'a', url: 'https://a.example', snippet: '', provider: 'x', freshnessStatus: 'unknown', confidence: 0.8, evidenceLabel: 'LIVE_SIGNAL_BACKED', publishedAt: null },
    { title: 'b', url: null, snippet: '', provider: 'x', freshnessStatus: 'unknown', confidence: 0.5, evidenceLabel: 'LIVE_SIGNAL_BACKED', publishedAt: null },
    { title: 'c', url: 'https://c.example', snippet: '', provider: 'x', freshnessStatus: 'unknown', confidence: 0.5, evidenceLabel: 'HISTORICAL_PATTERN_BASED', publishedAt: null },
  ],
})
check('HUD counts only accepted', hud.sourcesCount === 1 && hud.considered === 3 && hud.rejected === 2)
check('HUD one live source is not verified', hud.mode === 'partial')
check('HUD none accepted is unavailable', researchUiFromReport({ sourcesUnavailable: false, unknowns: [], sources: [] }).mode === 'unavailable')

// --- correction without content / continuation recovery through the full Stage 1 turn
const thread = [{ sender: "RA'EL", content: 'tell me about foundry' }, { sender: 'ORION', content: 'Foundry runs engineering missions.' }]
const t1 = runStage1Turn({ turnId: 'x1', text: "no, that's not what i meant", thread, state: STATE })
check('bare correction is acknowledged not defended', t1.finalResponse?.status === 'WAITING' && /setting aside my previous reading/.test(t1.finalResponse.text), t1.finalResponse?.text)
const t2 = runStage1Turn({ turnId: 'x2', text: "no, i meant terra", thread, state: STATE })
check('correction naming a War Room subject is answered from War Room knowledge, acknowledging the correction', t2.finalResponse?.mode === 'stage1_self_knowledge' && /you meant: terra/.test(t2.finalResponse.text) && /Terra is the earth-intelligence/.test(t2.finalResponse.text), t2.finalResponse?.text)
const t2b = runStage1Turn({ turnId: 'x2b', text: 'no, i meant the persistence boundary between sessions and missions', thread, state: STATE })
check('correction with non-War-Room content goes to members with context', t2b.finalResponse === null && /Commander meant: the persistence boundary/.test(t2b.effectiveText), t2b.effectiveText)
const prior = [buildTurnRecord({ turnId: 'p1', decree: 'design the persistence boundary', responseText: 'we should isolate', mode: null, understanding: understandTurn({ text: 'design the persistence boundary' }), decision: dArch, attribution: att })]
const t3 = runStage1Turn({ turnId: 'x3', text: 'continue where we stopped', thread: [], state: STATE, priorTurns: prior })
check('continuation recovers last turn', /design the persistence boundary/.test(t3.finalResponse?.text ?? '') && /PARTIAL/.test(t3.finalResponse?.text ?? ''))
check('continuation notes unfinished turn', /did not finish cleanly/.test(t3.finalResponse?.text ?? ''))
check('continuation without records asks, never invents', buildContinuationResponse([]).status === 'WAITING')
check('self knowledge via full turn has provenance', runStage1Turn({ turnId: 'x4', text: "What's your purpose inside War Room?", thread: [], state: STATE }).provenance.localKnowledgeCount > 0)

// --- reviewer regressions (commands must never be swallowed into canned answers)
check('"no, deploy it to staging" is a command', understandTurn({ text: 'No, deploy the fix to staging', history: hist }).act === 'command')
const swallow = runStage1Turn({ turnId: 'r1', text: 'No, deploy the fix to staging', thread, state: STATE })
check('command-bearing correction not answered as a bare correction', swallow.finalResponse === null || !/setting aside/.test(swallow.finalResponse.text))
check('continue-with-instruction not recovered', runStage1Turn({ turnId: 'r2', text: 'continue the build from the last checkpoint', thread, state: STATE, priorTurns: prior }).finalResponse === null)
check('compound install question not self-knowledge', !isSelfKnowledgeQuestion(understandTurn({ text: 'Can you install the latest build and tell me what is installed?' })))
check('role statement not self-knowledge', !isSelfKnowledgeQuestion(understandTurn({ text: 'Your role in this mission is to review the installed packages' })))
check('live status not answered from probes', !isSelfKnowledgeQuestion(understandTurn({ text: 'what is running right now' })))
const worse = mergeTurnRecord({ ...baseRec, status: 'PARTIAL' }, { ...baseRec, contributions: [], status: 'COMPLETED' })
check('merge never upgrades PARTIAL', worse.status !== 'COMPLETED', worse.status)
check('merge with different decree replaces', mergeTurnRecord({ ...baseRec, decree: 'a' }, { ...baseRec, decree: 'b' }).decree === 'b')
check('SYSTEM result is not a member contribution', buildAttribution({ results: [{ family: 'SYSTEM', status: 'OK', content: 'notice' }] }, null).contributions.length === 0)
check('OK without backend is not COMPLETED', buildAttribution({ results: [{ family: 'ORION', status: 'OK', content: 'x' }] }, null).contributions[0].status === 'FAILED')
check('same-host sources are not corroboration', researchUiFromReport({ sourcesUnavailable: false, unknowns: [], sources: [
  { title: 'a', url: 'https://x.example/1', snippet: '', provider: 'p', freshnessStatus: 'unknown', confidence: 1, evidenceLabel: 'LIVE_SIGNAL_BACKED', publishedAt: null },
  { title: 'b', url: 'https://www.x.example/2', snippet: '', provider: 'p', freshnessStatus: 'unknown', confidence: 1, evidenceLabel: 'LIVE_SIGNAL_BACKED', publishedAt: null }] }).mode === 'partial')

{
// --- installed-acceptance regressions (found by driving the real installed Council UI)
const slang = understandTurn({ text: 'yo wats foundry do in war rom' })
check('slang+typo: wats/rom repaired', /what is foundry do in war room/.test(slang.normalized), slang.normalized)
check('leading filler does not hide a question', slang.act === 'question' && slang.topics.includes('foundry'), `${slang.act} ${slang.topics}`)
const slangTurn = runStage1Turn({ turnId: 'y1', text: 'yo wats foundry do in war rom', thread: [], state: STATE })
check('slang question is answered from War Room knowledge, no member call', slangTurn.finalResponse?.mode === 'stage1_self_knowledge' && slangTurn.decision.members.length === 0, slangTurn.decision.route)
check('typo repair never changes the first letter (boundary stays boundary)', normalizeCommanderText('the persistence boundary design').text.includes('boundary'))
const thread2 = [
  { sender: "RA'EL", content: 'yo wats foundry do in war rom' },
  { sender: 'AURORA', content: 'Foundry runs engineering missions in isolated workspaces. Terra and HVS are separate sections.' },
  { sender: "RA'EL", content: 'and the sandbox part?' },
  { sender: 'AURORA', content: 'The sandbox keeps generated code inside the workspace.' },
]
const corr = runStage1Turn({ turnId: 'y2', text: 'no i meant the build sandbox not the browser one', thread: thread2, state: STATE })
check('correction keeps the thread subject', corr.understanding.topics.includes('foundry') && corr.understanding.topics.includes('sandbox'), corr.understanding.topics.join(','))
check('correction answered from knowledge incl. sandbox', corr.finalResponse?.mode === 'stage1_self_knowledge' && /sandbox/i.test(corr.finalResponse.text) && /you meant/.test(corr.finalResponse.text), corr.finalResponse?.text)
const threadAfterCorr = [...thread2, { sender: "RA'EL", content: 'no i meant the build sandbox not the browser one' }, { sender: 'AURORA', content: 'Foundry runs model-generated code inside an operating-system sandbox.' }]
const rec1 = runStage1Turn({ turnId: 'y3', text: 'what did u say before about it', thread: threadAfterCorr, state: STATE })
check('back-reference resolves to the thread subject, not a member-mentioned one', rec1.understanding.references[0]?.resolvedTo === 'foundry', JSON.stringify(rec1.understanding.references))
check('recall is answered from the conversation record', rec1.finalResponse?.mode === 'stage1_recall' && /sandbox/i.test(rec1.finalResponse.text) && !rec1.decision.externalResearch, rec1.finalResponse?.text)
check('recall never invents when nothing was said', /no earlier member reply/.test(answerRecall(understandTurn({ text: 'what did you say before' }), []).text))
check('recall without history is not a recall turn', understandTurn({ text: 'what did you say before' }).recall !== true)

const routerFixture = {
  researchEngine: { attempted: true, results: [
    { providerId: 'arxiv', ok: true, documents: [
      { canonicalUrl: 'https://arxiv.org/abs/1', title: 'Sodium-ion battery cathodes energy density', contentSnippet: 'Sodium-ion battery cells reach about 120 Wh/kg energy density in this study of cathode materials and cells.' },
      { canonicalUrl: 'https://arxiv.org/abs/2', title: 'Lithium iron phosphate battery cells energy density', contentSnippet: 'Lithium iron phosphate battery cells reach about 190 Wh/kg energy density; sodium-ion battery cells are lower.' }] },
    { providerId: 'crossref', ok: false, error: 'timeout' }] },
  tavily: { ok: false, results: [], error: 'TAVILY_API_KEY missing' },
  publicRss: { ok: true, results: [{ title: 'Court refuses to stop protest', url: 'https://news.example/protest', snippet: 'Supreme Court issues notices on protest-related petitions in the capital.' }] },
}
const mapped = sourcesFromRouter(routerFixture as never)
check('router mapping: considered sources and failed providers recorded', mapped.sources.length === 3 && mapped.failed.some(f => f.provider === 'crossref') && mapped.failed.some(f => f.provider === 'tavily'))
const acct0 = accountResearch({ topic: 'sodium-ion battery energy density versus lithium iron phosphate cells', sources: mapped.sources, claims: [] })
check('off-topic RSS is rejected, not counted', acct0.acceptedCount === 2 && acct0.rejectedCount === 1 && /off-topic/.test(acct0.verdicts[2].reason), JSON.stringify(acct0.verdicts.map(v => v.accepted)))
const claims = claimsFromSources(mapped.sources, [0, 1])
const acct = accountResearch({ topic: 'sodium-ion battery energy density versus lithium iron phosphate cells', sources: mapped.sources, claims })
check('numeric disagreement between accepted sources is a CONFLICT', acct.conflicts.length === 1 && acct.claims.some(c => c.label === 'CONFLICTING'), JSON.stringify(acct.conflicts))
const coverTopic = 'sodium-ion battery energy density versus lithium iron phosphate cells'
const coverSources = [{ url: 'https://a.example/1', title: 'Sodium-ion battery cells', excerpt: 'Sodium-ion battery cells are described in this review of lithium iron phosphate and other cathode chemistries.', provider: 'arxiv' }]
const coverAcct = accountResearch({ topic: coverTopic, sources: coverSources, claims: [{ id: 'S1', text: 'a', supports: [0], contradicts: [] }] })
check('accounting alone says COMPLETED for an attested source', coverAcct.status === 'COMPLETED')
applyCoverage(coverAcct, coverSources, coverTopic)
check('coverage: accepted sources that miss a key term make the run PARTIAL, naming the term', coverAcct.status === 'PARTIAL' && /density/.test(coverAcct.statusReason), coverAcct.statusReason)
check('source counts match accepted evidence', acct.acceptedCount === 2 && acct.verdicts.filter(v => v.accepted).length === 2)
check('research with every provider failing is FAILED, not complete', accountResearch({ topic: 'x battery', sources: [], claims: [], retrievalError: 'all providers failed' }).status === 'FAILED')
check('attribution: completed turn with no model recorded is not a model-attributed completion', buildAttribution({ familyDeliberation: { turns: [{ turn_id: 't1', output_message_id: 'm1', agent_identity: 'AURORA', provider_label: 'AURORA', provider_family: 'chatgpt', turn_role: 'council_synthesis', completion_status: 'complete', speaking_order: 1, provider_model: null, backend_provider: null, backend_type: 'LOCAL' }] } }, null).contributions[0].status === 'PARTIAL')
}

console.log(`council-stage1 validation: ${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.error('FAIL ' + f); process.exit(1) }
