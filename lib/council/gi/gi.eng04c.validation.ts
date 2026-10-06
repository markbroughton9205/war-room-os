/**
 * GI-ENG-04C: evidence-first DEEP_RESEARCH briefs + truthful Ollama outage resolution.
 */
import { pathToFileURL } from 'node:url'
import { classifyEvidenceBoardMission } from '@/lib/council/evidence-board/classifier'
import { createEvidenceBoard } from '@/lib/council/evidence-board/board'
import { formatCommanderBrief } from '@/lib/council/evidence-board/orchestrator'
import type { AuroraSynthesisV1 } from '@/lib/council/evidence-board/types'
import { deriveCompletionState } from '@/lib/council/evidence-board/verify'
import { recoverFromToolFailure } from '@/lib/council/gi/failureRecovery'
import { publicBodyHasInternalIds } from '@/lib/council/gi/responseLayer'
import { independentSourceCount } from '@/lib/council/gi/lumenQuality'
import { resolveOllamaBaseUrl } from '@/lib/native-builder/ollamaClient'
import { selectLiveShortPathTarget } from '@/lib/council/gi/shortPathCompleter'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function auroraStub(overrides: Partial<AuroraSynthesisV1> = {}): AuroraSynthesisV1 {
  return {
    mission_class: 'DEEP_RESEARCH' as const,
    completion_state: 'PARTIALLY_VERIFIED' as const,
    confidence: 0.6,
    verified_facts: [],
    partially_verified: [{ text: 'Sparsely-Gated Mixture-of-Experts Layer — https://arxiv.org/abs/1701.06538', evidence_ids: ['e1'], claim_id: 'c1' }],
    unverified: [],
    conflicts: [],
    unknowns: ['Browser research opened no usable sources.'],
    tool_blocks: ['broker.fetch: Browser research opened no usable sources.'],
    risks: [],
    next_actions: [{ action: 'Probe Browser Broker if research capability is required', owner: 'Commander' }],
    advisory: true,
    commander_authority: 'REQUIRED_FOR_ACTION' as const,
    ...overrides,
  }
}

async function run() {
  const results: CaseResult[] = []
  const classification = classifyEvidenceBoardMission({
    commanderMessage: 'Research current sparse expert inference techniques using primary sources.',
  })
  const board = createEvidenceBoard({
    mission_id: classification.mission_id,
    mission_class: classification.mission_class,
    question: 'Research current sparse expert inference techniques using primary sources.',
    agents: classification.selected_agents,
    ttl_seconds: 600,
    budget_tokens: 4000,
    budget_ms: 60_000,
  })
  const now = new Date().toISOString()
  board.evidence.push({
    mission_id: classification.mission_id,
    timestamp: now,
    provenance: 'validation_fixture',
    evidence_id: 'e1',
    kind: 'primary_external',
    summary: 'Sparsely-Gated Mixture-of-Experts Layer — https://arxiv.org/abs/1701.06538',
    pointer: 'https://arxiv.org/abs/1701.06538',
    url: 'https://arxiv.org/abs/1701.06538',
    final_url: 'https://arxiv.org/abs/1701.06538',
    title: 'Sparsely-Gated Mixture-of-Experts Layer',
    retrieved_at: now,
    tool_name: 'broker.fetch',
    ok: true,
    temporal_layer: 'CURRENT_LIVE',
    agent_id: 'PULSAR',
    round: 1,
  })
  board.evidence.push({
    mission_id: classification.mission_id,
    timestamp: now,
    provenance: 'validation_fixture',
    evidence_id: 'e2',
    kind: 'primary_external',
    summary: 'Browser research opened no usable sources.',
    pointer: 'broker.fetch',
    retrieved_at: now,
    tool_name: 'broker.fetch',
    ok: false,
    temporal_layer: 'CURRENT_LIVE',
    agent_id: 'ORION',
    round: 1,
  })

  const brief = formatCommanderBrief(classification, auroraStub(), board)
  results.push(check(
    'BRIEF-1',
    !/couldn'?t verify the current value because the browser probe failed/i.test(brief),
    brief.slice(0, 280),
  ))
  results.push(check(
    'BRIEF-2',
    /arxiv\.org\/abs\/1701\.06538/.test(brief) && /What I found/i.test(brief),
    brief.slice(0, 280),
  ))
  results.push(check(
    'BRIEF-3',
    /uncertain|second retrieval|corroboration/i.test(brief) && !publicBodyHasInternalIds(brief) && !/\bTOOL_BLOCKED\b/.test(brief),
    brief.slice(0, 280),
  ))
  results.push(check(
    'BRIEF-4',
    !/Probe Browser Broker if research capability is required/i.test(brief),
    brief.slice(0, 220),
  ))

  const emptyBoard = createEvidenceBoard({
    mission_id: 'empty',
    mission_class: 'DEEP_RESEARCH',
    question: 'Research current sparse expert inference techniques using primary sources.',
    agents: ['PULSAR'],
    ttl_seconds: 120,
    budget_tokens: 1,
    budget_ms: 1,
  })
  const totalFail = formatCommanderBrief(classification, auroraStub({
    partially_verified: [],
    completion_state: 'TOOL_BLOCKED',
  }), emptyBoard)
  results.push(check(
    'BRIEF-5',
    /couldn'?t verify|could not verify/i.test(totalFail),
    totalFail.slice(0, 180),
  ))

  const mixedState = deriveCompletionState({
    requiredToolsBlocked: false,
    claims: [
      { claim_id: 'c-ok', text: 'MoE paper', status: 'SUPPORTED', evidence_ids: ['e1'], confidence: 0.7, label: 'VERIFIED_FACT', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'PULSAR', round: 1 },
      { claim_id: 'c-fail', text: 'blocked', status: 'TOOL_BLOCKED', evidence_ids: ['e2'], confidence: 0.2, label: 'INFERENCE', temporal_layer: 'CURRENT_LIVE', critical: false, agent_id: 'ORION', round: 1 },
    ],
    conflicts: [],
  })
  results.push(check('STATE-1', mixedState === 'PARTIALLY_VERIFIED', mixedState))

  const utmBoard = createEvidenceBoard({
    mission_id: 'utm',
    mission_class: 'DEEP_RESEARCH',
    question: 'Research current sparse expert inference techniques using primary sources.',
    agents: ['PULSAR'],
    ttl_seconds: 120,
    budget_tokens: 4000,
    budget_ms: 60_000,
  })
  utmBoard.evidence.push({
    ...board.evidence[0],
    evidence_id: 'e-utm-1',
    url: 'https://arxiv.org/abs/1701.06538?utm_source=twitter',
    final_url: 'https://arxiv.org/abs/1701.06538?utm_source=twitter',
    pointer: 'https://arxiv.org/abs/1701.06538?utm_source=twitter',
  })
  utmBoard.evidence.push({
    ...board.evidence[0],
    evidence_id: 'e-utm-2',
    url: 'https://arxiv.org/abs/1701.06538',
    final_url: 'https://arxiv.org/abs/1701.06538',
    pointer: 'https://arxiv.org/abs/1701.06538',
  })
  results.push(check(
    'SOURCE-1',
    independentSourceCount(utmBoard.evidence.filter(row => row.ok)) === 1,
    String(independentSourceCount(utmBoard.evidence.filter(row => row.ok))),
  ))

  const allBlocked = deriveCompletionState({
    requiredToolsBlocked: true,
    claims: [
      { claim_id: 'c-fail', text: 'blocked', status: 'TOOL_BLOCKED', evidence_ids: [], confidence: 0.2, label: 'INFERENCE', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'PULSAR', round: 1 },
    ],
    conflicts: [],
  })
  results.push(check('STATE-2', allBlocked === 'TOOL_BLOCKED', allBlocked))

  const recovery = recoverFromToolFailure({ tool_name: 'broker.fetch', ok: false, remaining_ok: 1 })
  results.push(check('RECOVERY-1', recovery.continue_mission === true && Boolean(recovery.alternate), recovery.commander_text))

  results.push(check(
    'OLLAMA-1',
    resolveOllamaBaseUrl({ OLLAMA_HOST: 'http://127.0.0.1:1' }) === 'http://127.0.0.1:1',
    resolveOllamaBaseUrl({ OLLAMA_HOST: 'http://127.0.0.1:1' }),
  ))
  results.push(check(
    'OLLAMA-2',
    resolveOllamaBaseUrl({ OLLAMA_BASE_URL: 'http://127.0.0.1:9' }) === 'http://127.0.0.1:9',
    resolveOllamaBaseUrl({ OLLAMA_BASE_URL: 'http://127.0.0.1:9' }),
  ))
  results.push(check(
    'OLLAMA-3',
    resolveOllamaBaseUrl({ OLLAMA_HOST: '127.0.0.1:11434' }) === 'http://127.0.0.1:11434',
    resolveOllamaBaseUrl({ OLLAMA_HOST: '127.0.0.1:11434' }),
  ))

  const isolated = await selectLiveShortPathTarget({
    ...process.env,
    OLLAMA_BASE_URL: 'http://127.0.0.1:1',
    OLLAMA_HOST: 'http://127.0.0.1:1',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    GEMINI_API_KEY: '',
    XAI_API_KEY: '',
  })
  results.push(check(
    'OLLAMA-4',
    isolated.placement === 'NONE' && !isolated.local_model,
    `${isolated.placement} ${isolated.reason}`.slice(0, 200),
  ))

  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`GI_ENG_04C failed ${failed.length}`)
    process.exit(1)
  }
  console.log(`GI_ENG_04C ${results.length}/${results.length} PASS`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run()
}

export { run as runGiEng04cValidation }
