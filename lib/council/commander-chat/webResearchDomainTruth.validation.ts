/**
 * WR-WEB-RESEARCH-03 — domain-sensitive routing, relevance, freshness, snapshot, persist.
 * No second intelligence architecture.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  classifyResearchDomain,
  classifyResearchIntent,
  classifySourceAuthority,
  constructDomainQueries,
  evaluateSourceRelevance,
  identityKey,
  preferredAuthorities,
  withinFreshnessWindow,
} from '@/lib/browser-broker/researchPolicy'
import { constructResearchQueries, paperIdentity } from '@/lib/browser-broker/researchDiscovery'
import { createEvidenceBoard } from '@/lib/council/evidence-board/board'
import { formatCommanderBrief, publicSourceRecords } from '@/lib/council/evidence-board/orchestrator'
import { classifyEvidenceBoardMission } from '@/lib/council/evidence-board/classifier'
import { verifyClaimLumen } from '@/lib/council/evidence-board/verify'
import {
  demoteSourcelessExternalClaims,
  isUsableExternalEvidence,
  noUsableSourcesBrief,
} from '@/lib/council/evidence-board/researchTruth'
import {
  createLedgerSession,
  mergeSessionLists,
  retitleLedgerSession,
  upsertLedgerSession,
} from '@/lib/council/commander-chat/sessionLedger'
import {
  overlayLocalResearchSnapshots,
  readSessionTranscript,
  toLocalTranscriptMessage,
  writeSessionTranscript,
} from '@/lib/council/commander-chat/sessionTranscript'
import { honestResearchFailure, publicResearchIsClean } from '@/lib/council/commander-chat/webResearchAcceptance'
import type { BoardRowProvenance, EbcEvidence, LumenVerification } from '@/lib/council/evidence-board/types'
import type { LocalTranscriptMessage } from '@/lib/council/commander-chat/sessionTranscript'

type Check = { id: string; pass: boolean; detail: unknown }
const checks: Check[] = []
function check(id: string, pass: boolean, detail: unknown) {
  checks.push({ id, pass, detail })
  if (!pass) console.error('FAIL', id, detail)
}

const NOW = Date.parse('2026-09-22T16:00:00.000Z')
const NONSENSE = 'Research qzxtplm-nonexistent-war-room-source-test.invalid using primary sources only.'
const CURRENT = 'Research one AI development from the last 30 days using primary or authoritative sources.'
const FDA = 'Research FDA AI medical device software policy using primary sources.'
const SEC = 'Research the latest Tesla 10-K SEC filing using primary sources.'
const API = 'Research Playwright browser contexts and persistent profiles from official documentation.'
const GENERIC_PRIMARY = 'Research climate attribution using primary sources only.'
const MOE = 'Research current mixture-of-experts inference methods using primary sources.'

function evidenceRow(partial: Partial<EbcEvidence> & Pick<EbcEvidence, 'evidence_id' | 'url' | 'summary'>): EbcEvidence & BoardRowProvenance {
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
    title: partial.title ?? 'source',
    source_type: 'primary_external',
    ok: true,
    ...partial,
  }
}

const genericQueries = constructResearchQueries(GENERIC_PRIMARY)
check('RESEARCH-DOMAIN-1', classifyResearchDomain(GENERIC_PRIMARY) !== 'ai_ml_research' && !genericQueries.some(query => /site:arxiv\.org/i.test(query)), {
  domain: classifyResearchDomain(GENERIC_PRIMARY),
  queries: genericQueries,
  intent: classifyResearchIntent(GENERIC_PRIMARY),
})

const fdaQueries = constructDomainQueries(FDA)
check('RESEARCH-DOMAIN-2', classifyResearchDomain(FDA) === 'fda_regulation' && fdaQueries.some(query => /site:fda\.gov/i.test(query)) && preferredAuthorities('fda_regulation').includes('OFFICIAL_GOVERNMENT'), {
  domain: classifyResearchDomain(FDA),
  queries: fdaQueries,
})

const secQueries = constructDomainQueries(SEC)
check('RESEARCH-DOMAIN-3', classifyResearchDomain(SEC) === 'sec_filing' && secQueries.some(query => /site:sec\.gov/i.test(query)), {
  domain: classifyResearchDomain(SEC),
  queries: secQueries,
})

const apiQueries = constructDomainQueries(API)
check('RESEARCH-DOMAIN-4', classifyResearchDomain(API) === 'software_api' && apiQueries.some(query => /playwright\.dev|official documentation/i.test(query)), {
  domain: classifyResearchDomain(API),
  queries: apiQueries,
})

const moeQueries = constructResearchQueries(MOE)
check('RESEARCH-DOMAIN-MOE', classifyResearchDomain(MOE) === 'ai_ml_research' && moeQueries.some(query => /arxiv/i.test(query)), moeQueries)

const qwen = evaluateSourceRelevance({
  prompt: NONSENSE,
  url: 'https://arxiv.org/abs/2505.09388',
  title: 'Qwen3 Technical Report',
  text: 'Qwen3 is a large language model family with dense and mixture-of-experts variants.',
  now: NOW,
})
check('RESEARCH-RELEVANCE-1', qwen.relevance_decision === 'REJECT_OFF_TOPIC', qwen)

const stanford = evaluateSourceRelevance({
  prompt: CURRENT,
  url: 'https://hai.stanford.edu/ai-index/2026-ai-index-report',
  title: 'The 2026 AI Index Report',
  text: 'Stanford HAI published the AI Index on April 13, 2026. This annual report measures AI progress.',
  published_at: '2026-04-13T00:00:00.000Z',
  now: NOW,
})
check('RESEARCH-FRESHNESS-1', stanford.relevance_decision === 'REJECT_STALE' && !withinFreshnessWindow('2026-04-13T00:00:00.000Z', 30, NOW), stanford)

const undated = evaluateSourceRelevance({
  prompt: CURRENT,
  url: 'https://openai.com/index/undated-model-note',
  title: 'An AI development note',
  text: 'An AI model was discussed without any publication timestamp.',
  now: NOW,
})
check('RESEARCH-FRESHNESS-UNDATED', undated.relevance_decision === 'REJECT_STALE' && undated.published_at == null, undated)

const fdaArxiv = evaluateSourceRelevance({
  prompt: FDA,
  url: 'https://arxiv.org/abs/2401.04088',
  title: 'FDA AI medical device software policy preprint',
  text: 'This preprint discusses FDA AI medical device software policy and software as a medical device guidance.',
  now: NOW,
})
check('RESEARCH-DOMAIN-FDA-AUTHORITY', fdaArxiv.relevance_decision === 'REJECT_WRONG_AUTHORITY' && classifySourceAuthority('https://www.fda.gov/media/guidance') === 'OFFICIAL_GOVERNMENT', fdaArxiv)

const secIssuer = classifySourceAuthority('https://www.sec.gov/Archives/edgar/data/1318605/000162828026003216/tsla-20251231.htm')
check('RESEARCH-DOMAIN-SEC-AUTHORITY', secIssuer === 'REGULATORY_FILING', secIssuer)

const clientSrc = readFileSync(join(resolveRepoRoot(), 'lib/browser-broker/councilClient.ts'), 'utf8')
check('RESEARCH-BROKER-1', /finally\s*\{[\s\S]{0,180}closeSession/.test(clientSrc), 'closeSession after success is in finally')
check('RESEARCH-BROKER-2', /finally\s*\{[\s\S]{0,180}closeSession/.test(clientSrc) && /catch \(error\)/.test(clientSrc), 'closeSession after failure is in finally')

const okA = evidenceRow({
  evidence_id: 'e-ok-a',
  url: 'https://arxiv.org/abs/1701.06538',
  final_url: 'https://arxiv.org/abs/1701.06538',
  title: 'Sparsely-Gated Mixture-of-Experts',
  summary: 'Shazeer et al. introduce sparsely-gated mixture-of-experts layers that route tokens to a subset of experts for efficient inference.',
  valid_from: '2017-01-23T00:00:00.000Z',
})
const okB = evidenceRow({
  evidence_id: 'e-ok-b',
  url: 'https://arxiv.org/abs/2401.04088',
  final_url: 'https://arxiv.org/abs/2401.04088',
  title: 'Mixtral of Experts',
  summary: 'Mixtral describes sparse expert routing where each token is processed by a small set of experts rather than the full model.',
  valid_from: '2024-01-08T00:00:00.000Z',
})
const failC = evidenceRow({
  evidence_id: 'e-fail-c',
  ok: false,
  url: 'https://example.invalid/moe-fail',
  title: 'failed source',
  summary: 'Browser research opened no usable sources.',
  kind: 'tool_result',
  source_type: 'tool_result',
  stale_reason: 'REJECT_EXTRACTION_FAILED',
})

const classification = classifyEvidenceBoardMission({ commanderMessage: MOE })
const board = createEvidenceBoard({
  mission_id: 'domain-truth',
  mission_class: 'DEEP_RESEARCH',
  question: MOE,
  agents: ['PULSAR', 'LUMEN', 'AURORA'],
  ttl_seconds: 600,
  budget_tokens: 4000,
  budget_ms: 60_000,
})
board.evidence.push(okA, okB, failC)
board.claims.push({
  mission_id: 'fixture-mission',
  timestamp: '2026-09-22T18:00:00.000Z',
  provenance: 'validation_fixture',
  claim_id: 'c-ok-a',
  text: 'Tokens route to a subset of experts.',
  status: 'PROPOSED',
  evidence_ids: ['e-ok-a'],
  confidence: 0.8,
  label: 'VERIFIED_FACT',
  temporal_layer: 'CURRENT_LIVE',
  critical: true,
  agent_id: 'PULSAR',
  round: 1,
}, {
  mission_id: 'fixture-mission',
  timestamp: '2026-09-22T18:00:00.000Z',
  provenance: 'validation_fixture',
  claim_id: 'c-ok-b',
  text: 'Mixtral uses sparse expert parallelism.',
  status: 'PROPOSED',
  evidence_ids: ['e-ok-b'],
  confidence: 0.8,
  label: 'VERIFIED_FACT',
  temporal_layer: 'CURRENT_LIVE',
  critical: true,
  agent_id: 'PULSAR',
  round: 1,
})
const lumenOk: LumenVerification[] = [
  verifyClaimLumen({
    claim: board.claims[0],
    evidence: board.evidence,
    ttlSeconds: 600,
    missionClass: 'DEEP_RESEARCH',
    rechecked: [],
  }),
  verifyClaimLumen({
    claim: board.claims[1],
    evidence: board.evidence,
    ttlSeconds: 600,
    missionClass: 'DEEP_RESEARCH',
    rechecked: [],
  }),
]
const snapshot = publicSourceRecords(board, lumenOk, { research_domain: 'ai_ml_research', freshness_window_days: null })
check('RESEARCH-SNAPSHOT-1', snapshot.usable_source_count === snapshot.sources.filter(row => row.usable).length && snapshot.usable_source_count === 2 && snapshot.evidence.length === board.evidence.length, {
  usable: snapshot.usable_source_count,
  rows: snapshot.sources.map(row => ({ usable: row.usable, decision: row.relevance_decision, url: row.url })),
})

const partialBrief = formatCommanderBrief(classification, {
  mission_class: 'DEEP_RESEARCH',
  completion_state: 'PARTIALLY_VERIFIED',
  confidence: 0.7,
  verified_facts: [{ text: 'Tokens are routed to a subset of experts.', evidence_ids: ['e-ok-a'], temporal_layer: 'CURRENT_LIVE', claim_id: 'c-ok-a' }],
  partially_verified: [{ text: 'Mixtral documents sparse expert parallelism.', evidence_ids: ['e-ok-b'], claim_id: 'c-ok-b' }],
  unverified: [],
  conflicts: [],
  unknowns: [],
  tool_blocks: [],
  risks: [],
  next_actions: [],
  advisory: true,
  commander_authority: 'REQUIRED_FOR_ACTION',
}, board)
check('RESEARCH-PARTIAL-1', /surviving evidence|Sources:/i.test(partialBrief) && /arxiv\.org\/abs\/1701\.06538/.test(partialBrief) && /arxiv\.org\/abs\/2401\.04088/.test(partialBrief) && !/example\.invalid/.test(partialBrief) && publicResearchIsClean(partialBrief), partialBrief)

const failBoard = createEvidenceBoard({
  mission_id: 'domain-fail',
  mission_class: 'DEEP_RESEARCH',
  question: NONSENSE,
  agents: ['PULSAR', 'LUMEN', 'AURORA'],
  ttl_seconds: 600,
  budget_tokens: 4000,
  budget_ms: 60_000,
})
failBoard.evidence.push(failC, evidenceRow({
  evidence_id: 'e-qwen',
  ok: false,
  url: 'https://arxiv.org/abs/2505.09388',
  title: 'Qwen3 Technical Report',
  summary: 'off topic',
  kind: 'tool_result',
  source_type: 'tool_result',
  stale_reason: 'REJECT_OFF_TOPIC',
}))
const failClaim = {
  mission_id: 'fixture-mission',
  timestamp: '2026-09-22T18:00:00.000Z',
  provenance: 'validation_fixture',
  claim_id: 'c-fail',
  text: 'The nonexistent topic is verified.',
  status: 'VERIFIED' as const,
  evidence_ids: ['e-qwen'],
  confidence: 0.9,
  label: 'VERIFIED_FACT' as const,
  temporal_layer: 'CURRENT_LIVE' as const,
  critical: true,
  agent_id: 'PULSAR' as const,
  round: 1,
}
failBoard.claims.push(failClaim)
const failLumen = verifyClaimLumen({
  claim: failClaim,
  evidence: failBoard.evidence,
  ttlSeconds: 600,
  missionClass: 'DEEP_RESEARCH',
  rechecked: [],
})
const demoted = demoteSourcelessExternalClaims(failBoard.claims, failBoard.evidence, [failLumen])
const failBrief = formatCommanderBrief(classifyEvidenceBoardMission({ commanderMessage: NONSENSE }), {
  mission_class: 'DEEP_RESEARCH',
  completion_state: 'UNVERIFIED',
  confidence: 0.1,
  verified_facts: [],
  partially_verified: [],
  unverified: [],
  conflicts: [],
  unknowns: [],
  tool_blocks: ['broker.fetch blocked'],
  risks: [],
  next_actions: [],
  advisory: true,
  commander_authority: 'REQUIRED_FOR_ACTION',
}, failBoard)
const failSnap = publicSourceRecords(failBoard, demoted.lumen)
check('RESEARCH-FAIL-1', failSnap.usable_source_count === 0 && demoted.lumen.every(row => row.verdict !== 'SUPPORTED') && honestResearchFailure(failBrief) && !/https?:\/\//.test(failBrief) && /could not be verified/i.test(noUsableSourcesBrief()), {
  usable: failSnap.usable_source_count,
  lumen: demoted.lumen.map(row => row.verdict),
  brief: failBrief,
})

const session = upsertLedgerSession([], createLedgerSession('sess-research-03', 'MoE research'))
const retitled = retitleLedgerSession(session, 'sess-research-03', 'MoE research', 'What I found')
const merged = mergeSessionLists([], retitled)
const auroraMsg = toLocalTranscriptMessage({
  id: 'aurora-1',
  familyName: 'AURORA',
  content: partialBrief,
  messageType: 'response',
  evidenceBoardCouncil: {
    mission_class: 'DEEP_RESEARCH',
    completion_state: 'PARTIALLY_VERIFIED',
    usable_source_count: snapshot.usable_source_count,
    sources: snapshot.sources,
    evidence: snapshot.evidence,
  },
})
const stored = writeSessionTranscript({}, 'sess-research-03', auroraMsg ? [auroraMsg] : [])
const hydrated = readSessionTranscript(stored, 'sess-research-03')
const remoteOverwrite = overlayLocalResearchSnapshots([{
  id: 'aurora-1',
  content: partialBrief,
  familyName: 'AURORA',
  evidenceBoardCouncil: undefined as LocalTranscriptMessage['evidenceBoardCouncil'],
}], hydrated)
check('RESEARCH-PERSIST-1', merged.length === 1 && merged[0].id === 'sess-research-03' && merged[0].title === 'MoE research' && hydrated[0]?.content === partialBrief && (hydrated[0]?.evidenceBoardCouncil?.sources?.length ?? 0) >= 2 && (remoteOverwrite[0].evidenceBoardCouncil?.usable_source_count ?? 0) === 2, {
  title: merged[0]?.title,
  sources: hydrated[0]?.evidenceBoardCouncil?.sources?.map(row => row.url),
  overlay: remoteOverwrite[0].evidenceBoardCouncil?.usable_source_count,
})

check('RESEARCH-INDEPENDENCE', identityKey('https://arxiv.org/abs/1701.06538') === paperIdentity('https://arxiv.org/pdf/1701.06538.pdf') && identityKey('https://arxiv.org/abs/1701.06538?utm=1') === identityKey('https://arxiv.org/pdf/1701.06538'), {
  abs: identityKey('https://arxiv.org/abs/1701.06538'),
  pdf: identityKey('https://arxiv.org/pdf/1701.06538.pdf'),
})

check('RESEARCH-QUALITY-SPLIT', typeof stanford.scores.relevance === 'number' && typeof stanford.scores.authority === 'number' && typeof stanford.scores.freshness === 'number' && stanford.scores.freshness === 0, stanford.scores)

const failed = checks.filter(row => !row.pass)
console.log(JSON.stringify({ pass: failed.length === 0, total: checks.length, failed: failed.map(row => row.id) }, null, 2))
if (failed.length) process.exit(1)
