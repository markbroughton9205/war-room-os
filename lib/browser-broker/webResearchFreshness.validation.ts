/**
 * WR-WEB-RESEARCH-04 freshness window and partial-failure checks.
 */
import { createEvidenceBoard } from '@/lib/council/evidence-board/board'
import { formatCommanderBrief } from '@/lib/council/evidence-board/orchestrator'
import { researchSourceCounts } from '@/lib/council/evidence-board/researchTruth'
import { verifyClaimLumen } from '@/lib/council/evidence-board/verify'
import type { BoardRowProvenance, EbcClaim, EbcEvidence, MissionClassifierOutput } from '@/lib/council/evidence-board/types'
import { toNormalChatText } from '@/lib/council/commander-chat/normalChatContract'
import { MOE_RESEARCH_PROMPT } from '@/lib/council/commander-chat/webResearchAcceptance'
import {
  assessFreshness,
  classifyResearchIntent,
  evaluateSourceRelevance,
  parseStructuredReleases,
  parseVisibleNewsroomReleases,
  partialFailureRequested,
  requestedWindow,
  satisfiesStrictWindow,
} from './researchPolicy'

const CURRENT_INFO_PROMPT = 'Research one AI development from the last 30 days using primary or authoritative sources.'
const PARTIAL_PROMPT = `${MOE_RESEARCH_PROMPT} Force the first selected source to fail.`
const NOW = Date.parse('2026-09-22T16:00:00.000Z')

type Check = { id: string; pass: boolean; detail: unknown }
const checks: Check[] = []
function check(id: string, pass: boolean, detail: unknown) {
  checks.push({ id, pass, detail })
  if (!pass) console.error('FAIL', id, detail)
}

const retrievedOnly = assessFreshness({
  prompt: CURRENT_INFO_PROMPT,
  retrieved_at: '2026-09-22T16:00:00.000Z',
  url: 'https://hai.stanford.edu/ai-index/2026-ai-index-report',
  text: 'The 2026 AI Index Report was retrieved on 2026-09-22.',
  now: NOW,
})
check('FRESH-1', retrievedOnly.freshness_decision === 'DATE_UNKNOWN' && !satisfiesStrictWindow(retrievedOnly.freshness_decision) && retrievedOnly.source_published_at == null, retrievedOnly)

const aprilIndex = assessFreshness({
  prompt: CURRENT_INFO_PROMPT,
  url: 'https://hai.stanford.edu/ai-index/2026-ai-index-report',
  text: 'Stanford HAI 2026 AI Index. Published April 8, 2026.',
  retrieved_at: '2026-09-22T16:00:00.000Z',
  now: NOW,
})
const aprilRelevance = evaluateSourceRelevance({
  prompt: CURRENT_INFO_PROMPT,
  url: 'https://hai.stanford.edu/ai-index/2026-ai-index-report',
  title: 'The 2026 AI Index Report',
  text: 'An AI development report. Published April 8, 2026.',
  retrieved_at: '2026-09-22T16:00:00.000Z',
  extraction_ok: true,
  now: NOW,
})
check('FRESH-2', aprilIndex.freshness_decision === 'OUT_OF_WINDOW' && !satisfiesStrictWindow(aprilIndex.freshness_decision) && aprilRelevance.relevance_decision === 'REJECT_STALE', {
  assessment: aprilIndex,
  relevance: aprilRelevance.relevance_decision,
})

const unknownDate = assessFreshness({
  prompt: CURRENT_INFO_PROMPT,
  url: 'https://openai.com/index/new-model',
  text: 'OpenAI described an AI model release without a publication date.',
  now: NOW,
})
check('FRESH-3', unknownDate.freshness_decision === 'DATE_UNKNOWN' && unknownDate.requested_start != null && !satisfiesStrictWindow(unknownDate.freshness_decision), unknownDate)

const inWindow = assessFreshness({
  prompt: CURRENT_INFO_PROMPT,
  published_at: '2026-09-02T12:00:00.000Z',
  url: 'https://openai.com/index/gpt-update',
  title: 'OpenAI model update',
  text: 'OpenAI announced a new AI model for developers.',
  retrieved_at: '2026-09-22T16:00:00.000Z',
  now: NOW,
})
const inWindowRelevance = evaluateSourceRelevance({
  prompt: CURRENT_INFO_PROMPT,
  url: 'https://openai.com/index/gpt-update',
  title: 'OpenAI model update',
  text: 'OpenAI announced a new AI model for developers. The page is an official AI release.',
  published_at: '2026-09-02T12:00:00.000Z',
  retrieved_at: '2026-09-22T16:00:00.000Z',
  extraction_ok: true,
  now: NOW,
})
check('FRESH-4', inWindow.freshness_decision === 'IN_WINDOW' && satisfiesStrictWindow(inWindow.freshness_decision) && inWindowRelevance.relevance_decision === 'ACCEPT' && inWindowRelevance.authority_class === 'OFFICIAL_COMPANY', {
  assessment: inWindow,
  relevance: inWindowRelevance.relevance_decision,
  authority: inWindowRelevance.authority_class,
})

const monthOnly = assessFreshness({
  prompt: CURRENT_INFO_PROMPT,
  published_at: 'September 2026',
  url: 'https://deepmind.google/blog/',
  text: 'News — Google DeepMind September 2026',
  now: NOW,
})
check('FRESH-5', monthOnly.freshness_decision === 'DATE_UNKNOWN' && monthOnly.source_published_at == null, monthOnly)

const aggregator = evaluateSourceRelevance({
  prompt: CURRENT_INFO_PROMPT,
  url: 'https://llmgateway.io/timeline',
  title: 'New AI Model Releases — September 2026 Timeline',
  text: 'Published: 2026-09-22 Search models by provider, name, ID, or alias. AI model release timeline.',
  published_at: '2026-09-22T00:00:00.000Z',
  retrieved_at: '2026-09-22T16:00:00.000Z',
  extraction_ok: true,
  now: NOW,
})
check('FRESH-6', aggregator.relevance_decision === 'REJECT_WRONG_AUTHORITY' && aggregator.authority_class === 'UNKNOWN', {
  decision: aggregator.relevance_decision,
  authority: aggregator.authority_class,
})

const listing = '"date":"2026-09-22","subject":"Announcements","summary":"Opus 5.5 performs at the level of Claude Fable 5.1 on most work and costs 40% less to run than Opus 5.","title":"Introducing Claude Opus 5.5","url":"/claude-opus-5-5"'
const cmsOnly = '"_updatedAt":"2026-09-22T16:27:50Z","announcement":null'
const cards = parseStructuredReleases(listing, NOW)
const ignoredCms = parseStructuredReleases(cmsOnly, NOW)
const cardRelevance = cards[0]
  ? evaluateSourceRelevance({
    prompt: CURRENT_INFO_PROMPT,
    url: 'https://www.anthropic.com/claude-opus-5-5',
    title: cards[0].title,
    text: `${cards[0].title}. ${cards[0].summary || ''}`,
    published_at: cards[0].date,
    extraction_ok: true,
    now: NOW,
  })
  : null
check('FRESH-7', cards.length === 1 && cards[0].date.slice(0, 10) === '2026-09-22' && cards[0].title === 'Introducing Claude Opus 5.5' && cards[0].url === '/claude-opus-5-5' && ignoredCms.length === 0 && cardRelevance?.freshness.freshness_decision === 'IN_WINDOW' && cardRelevance.relevance_decision === 'ACCEPT' && cardRelevance.authority_class === 'OFFICIAL_COMPANY', {
  cards,
  ignoredCms,
  decision: cardRelevance?.relevance_decision,
  authority: cardRelevance?.authority_class,
})

const visible = parseVisibleNewsroomReleases([
  'Download press kit',
  'Introducing Claude Opus 5.5',
  'Announcements',
  'Sep 22, 2026',
  '',
  'Opus 5.5 performs at the level of Claude Fable 5.1 on most work and costs 40% less to run than Opus 5.',
].join('\n'), NOW)
const visibleRelevance = visible[0]
  ? evaluateSourceRelevance({
    prompt: CURRENT_INFO_PROMPT,
    url: 'https://www.anthropic.com/news',
    title: visible[0].title,
    text: `${visible[0].title}. ${visible[0].summary || ''}`,
    published_at: visible[0].date,
    extraction_ok: true,
    now: NOW,
  })
  : null
check('FRESH-8', visible[0]?.title === 'Introducing Claude Opus 5.5' && visible[0]?.date.slice(0, 10) === '2026-09-22' && visibleRelevance?.freshness.freshness_decision === 'IN_WINDOW' && visibleRelevance.relevance_decision === 'ACCEPT' && visibleRelevance.authority_class === 'OFFICIAL_COMPANY', {
  visible,
  decision: visibleRelevance?.relevance_decision,
})

check('FRESH-WINDOW-MOE', requestedWindow(MOE_RESEARCH_PROMPT, NOW) == null && classifyResearchIntent(MOE_RESEARCH_PROMPT).freshness_window_days == null, classifyResearchIntent(MOE_RESEARCH_PROMPT))
check('FRESH-WINDOW-PARTIAL', partialFailureRequested(PARTIAL_PROMPT) && requestedWindow(PARTIAL_PROMPT, NOW) == null, requestedWindow(PARTIAL_PROMPT, NOW))

function evidenceRow(partial: Partial<EbcEvidence> & Pick<EbcEvidence, 'evidence_id' | 'summary'> & { url: string }): EbcEvidence & BoardRowProvenance {
  return {
    mission_id: 'fixture-mission',
    timestamp: '2026-09-22T18:00:00.000Z',
    provenance: 'validation_fixture',
    kind: 'primary_external',
    pointer: partial.url,
    retrieved_at: '2026-09-22T18:00:00.000Z',
    observed_at: '2026-09-22T18:00:00.000Z',
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

const sourceB = evidenceRow({
  evidence_id: 'e-b',
  url: 'https://arxiv.org/abs/1701.06538',
  final_url: 'https://arxiv.org/abs/1701.06538',
  title: 'Outrageously Large Neural Networks',
  summary: 'Shazeer et al. introduce sparsely-gated mixture-of-experts layers that route each token to a subset of experts.',
})
const sourceC = evidenceRow({
  evidence_id: 'e-c',
  url: 'https://arxiv.org/abs/2401.04088',
  final_url: 'https://arxiv.org/abs/2401.04088',
  title: 'Mixtral of Experts',
  summary: 'Mixtral describes sparse expert routing where each token is processed by a small set of experts rather than the full model.',
})
const sourceA = evidenceRow({
  evidence_id: 'e-a',
  ok: false,
  url: 'https://127.0.0.1:9/wr-research-partial-fail',
  title: 'Unreachable source',
  summary: 'selected source could not be opened',
  kind: 'tool_result',
  source_type: 'tool_result',
})

const board = createEvidenceBoard({
  mission_id: 'partial-fail',
  mission_class: 'DEEP_RESEARCH',
  question: PARTIAL_PROMPT,
  agents: ['PULSAR', 'LUMEN', 'AURORA'],
  ttl_seconds: 600,
  budget_tokens: 4000,
  budget_ms: 60_000,
})
board.evidence.push(sourceB, sourceC, sourceA)
const brief = formatCommanderBrief(
  { mission_class: 'DEEP_RESEARCH' } as MissionClassifierOutput,
  {
    verified_facts: [],
    partially_verified: [],
    tool_blocks: [],
    unknowns: [],
    conflicts: [],
    completion_state: 'PARTIAL',
    next_actions: [],
    confidence: 0.6,
  } as never,
  board,
)
check('PARTIAL-1', /1701\.06538/.test(brief) && /2401\.04088/.test(brief) && !/127\.0\.0\.1/.test(brief) && /narrower than the full set/i.test(brief) && !/TOOL_BLOCKED|provider failure/i.test(brief), brief)

const usable = board.evidence.filter(row => row.ok)
check('PARTIAL-2', usable.length === 2 && !usable.some(row => row.evidence_id === 'e-a') && board.evidence.some(row => row.evidence_id === 'e-a' && row.ok === false), usable.map(row => row.evidence_id))

const claim: EbcClaim = {
  claim_id: 'c-partial',
  text: 'Mixture-of-experts inference routes each token to a subset of experts.',
  status: 'PROPOSED',
  evidence_ids: ['e-b', 'e-c', 'e-a'],
  confidence: 0.8,
  label: 'VERIFIED_FACT',
  temporal_layer: 'CURRENT_LIVE',
  critical: true,
  agent_id: 'PULSAR',
  round: 1,
}
const lumen = verifyClaimLumen({
  claim,
  evidence: [sourceB, sourceC, sourceA],
  ttlSeconds: 600,
  missionClass: 'DEEP_RESEARCH',
  rechecked: [],
  now: Date.parse('2026-09-22T18:00:01.000Z'),
})
check('PARTIAL-3', lumen.verdict === 'SUPPORTED' && (lumen.evidence_refs ?? []).includes('e-b') && (lumen.evidence_refs ?? []).includes('e-c') && !(lumen.evidence_refs ?? []).includes('e-a'), lumen)

const counts = researchSourceCounts([sourceB, sourceC, sourceA], {
  discovered_source_count: 3,
  selected_source_count: 3,
  opened_source_count: 3,
  failed_source_count: 1,
})
check('PARTIAL-4', counts.selected_source_count === 3 && counts.failed_source_count === 1 && counts.usable_source_count === 2, counts)

const duplicated = toNormalChatText([
  'Sparse expert routing keeps a subset of experts active.',
  'What I found:',
  '- Sparse expert routing keeps a subset of experts active.',
  'What is verified:',
  '- Sparse expert routing keeps a subset of experts active.',
  'Sources:',
  '- Outrageously Large Neural Networks — https://arxiv.org/abs/1701.06538',
].join('\n'))
check('PRESENT-1', !/what is verified/i.test(duplicated) && /sources/i.test(duplicated) && /1701\.06538/.test(duplicated), duplicated)

const failed = checks.filter(item => !item.pass)
console.log(`WEB_RESEARCH_FRESHNESS ${checks.length - failed.length}/${checks.length}`)
if (failed.length) process.exit(1)
