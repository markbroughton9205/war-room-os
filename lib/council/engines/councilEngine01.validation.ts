/**
 * Council ENGINE-01 foundation checks.
 * Engines wrap live-proven researchPolicy / discovery / EBC / LUMEN.
 * They do not replace EBC or add Council members.
 */
import { pathToFileURL } from 'node:url'
import {
  ENGINE_01_CAPABILITY_MAP,
  assessSourceAuthority,
  auroraConsumeEngines,
  bindClaimEvidence,
  calibrateUncertainty,
  canPromoteToVerified,
  decideDiscoveryStop,
  lumenConsumeBinding,
  orionConsumeEnginePacket,
  phoenixTargetsFromEngines,
  planResearchDiscovery,
  pulsarConsumeAssessments,
  pulsarConsumeDiscovery,
  recordEvidenceConflict,
  runResearchDiscoveryEngine,
  sourcesAreIndependent,
  verifiedRequiresEvidenceRefs,
} from '@/lib/council/engines'
import { attachCouncilEnginePublic } from '@/lib/council/engines/integration/ebc'
import { createEvidenceBoard, boardSnapshot } from '@/lib/council/evidence-board/board'
import { synthesizeAurora } from '@/lib/council/evidence-board/verify'
import type { BoardRowProvenance, EbcClaim, EbcEvidence } from '@/lib/council/evidence-board/types'
import {
  createSimulatedSessionState,
  sidebarPaneIdentitiesAgree,
  simulateSelectSession,
} from '@/lib/council/commander-chat/sessionSwitchHydration'
import { satisfiesStrictWindow } from '@/lib/browser-broker/researchPolicy'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NOW = Date.parse('2026-09-22T16:00:00.000Z')
const MOE = 'Research current mixture-of-experts inference methods using primary sources.'
const FDA = 'Research FDA AI medical device software policy using primary sources.'
const SEC = 'Research the latest Tesla 10-K SEC filing using primary sources.'
const CURRENT = 'Research one AI development from the last 30 days using primary or authoritative sources.'
const NONSENSE = 'Research qzxtplm-nonexistent-war-room-source-test.invalid using primary sources only.'

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

function claimRow(partial: Partial<EbcClaim> & Pick<EbcClaim, 'claim_id' | 'text' | 'evidence_ids'>): EbcClaim & BoardRowProvenance {
  return {
    mission_id: 'fixture-mission',
    timestamp: '2026-09-22T18:00:00.000Z',
    provenance: 'validation_fixture',
    status: 'SUPPORTED',
    confidence: 0.7,
    label: 'VERIFIED_FACT',
    temporal_layer: 'CURRENT_LIVE',
    critical: true,
    agent_id: 'PULSAR',
    round: 1,
    ...partial,
  }
}

export function runCouncilEngine01Validation(): CaseResult[] {
  const results: CaseResult[] = []

  {
    const extracted = ENGINE_01_CAPABILITY_MAP.filter(row => row.status === 'SHOULD-EXTRACT-INTO-ENGINE')
    results.push(check(
      'ENGINE01-MAP',
      extracted.length >= 4 && ENGINE_01_CAPABILITY_MAP.some(row => row.capability.includes('sourceless')),
      `rows=${ENGINE_01_CAPABILITY_MAP.length} extract=${extracted.length}`,
    ))
  }

  {
    const discovery = runResearchDiscoveryEngine({
      mission_id: 'm-moe',
      question: MOE,
    }, [
      { url: 'https://arxiv.org/abs/1701.06538', title: 'Outrageously Large Neural Networks' },
      { url: 'https://arxiv.org/pdf/1701.06538', title: 'MoE pdf mirror' },
      { url: 'https://medium.com/moe-blog', title: 'community recap' },
    ])
    const pulsar = pulsarConsumeDiscovery({ mission_id: 'm-moe', question: MOE }, [
      { url: 'https://arxiv.org/abs/1701.06538', title: 'Outrageously Large Neural Networks' },
    ])
    results.push(check(
      'ENGINE01-01',
      discovery.plan.domain === 'ai_ml_research'
      && discovery.plan.primary_queries.some(query => /arxiv/i.test(query))
      && discovery.plan.preferred_source_classes.includes('PRIMARY_RESEARCH')
      && discovery.candidates.some(row => row.domain === 'arxiv.org')
      && pulsar.plan.domain === 'ai_ml_research',
      `domain=${discovery.plan.domain} queries=${discovery.plan.primary_queries.join('|')} n=${discovery.candidates.length}`,
    ))
  }

  {
    const plan = planResearchDiscovery({ mission_id: 'm-fda', question: FDA })
    const arxiv = assessSourceAuthority({
      mission_id: 'm-fda',
      prompt: FDA,
      url: 'https://arxiv.org/abs/2401.04088',
      title: 'FDA AI medical device software policy preprint',
      text: 'This preprint discusses FDA AI medical device software policy and predetermined change control plans for SaMD.',
      extraction_ok: true,
      now: NOW,
    })
    const fda = assessSourceAuthority({
      mission_id: 'm-fda',
      prompt: FDA,
      url: 'https://www.fda.gov/medical-devices/software-medical-device-samd/artificial-intelligence-and-machine-learning-software-medical-device',
      title: 'FDA AI/ML SaMD',
      text: 'FDA AI medical device software policy describes predetermined change control plans for machine learning enabled devices.',
      extraction_ok: true,
      now: NOW,
    })
    results.push(check(
      'ENGINE01-02',
      plan.domain === 'fda_regulation'
      && plan.primary_queries.some(query => /site:fda\.gov/i.test(query))
      && !plan.primary_queries.some(query => /arxiv/i.test(query))
      && arxiv.decision === 'REJECT_WRONG_AUTHORITY'
      && fda.decision === 'ACCEPT'
      && fda.source_class === 'OFFICIAL_GOVERNMENT',
      `plan=${plan.domain} arxiv=${arxiv.decision} fda=${fda.decision}/${fda.source_class}`,
    ))
  }

  {
    const plan = planResearchDiscovery({ mission_id: 'm-sec', question: SEC })
    const sec = assessSourceAuthority({
      mission_id: 'm-sec',
      prompt: SEC,
      url: 'https://www.sec.gov/Archives/edgar/data/1318605/000162828024002390/tsla-20231231.htm',
      title: 'Tesla 10-K',
      text: 'Tesla, Inc. Form 10-K annual report filed with the SEC EDGAR system covering fiscal year financial statements. Filed: 2026-09-10.',
      published_at: '2026-09-10T00:00:00.000Z',
      extraction_ok: true,
      now: NOW,
    })
    results.push(check(
      'ENGINE01-03',
      plan.domain === 'sec_filing'
      && plan.preferred_source_classes.includes('REGULATORY_FILING')
      && plan.primary_queries.some(query => /sec\.gov/i.test(query))
      && sec.decision === 'ACCEPT'
      && sec.source_class === 'REGULATORY_FILING',
      `domain=${plan.domain} decision=${sec.decision} class=${sec.source_class}`,
    ))
  }

  {
    const nonsense = assessSourceAuthority({
      mission_id: 'm-n',
      prompt: NONSENSE,
      url: 'https://www.bbc.com/news/science-environment-123456',
      title: 'Climate update',
      text: 'A general climate news article that never mentions the requested token.',
      extraction_ok: true,
      now: NOW,
    })
    results.push(check(
      'ENGINE01-04',
      nonsense.decision === 'REJECT_OFF_TOPIC',
      `decision=${nonsense.decision} reasons=${nonsense.reasons.join('; ')}`,
    ))
  }

  {
    const stale = assessSourceAuthority({
      mission_id: 'm-stale',
      prompt: CURRENT,
      url: 'https://openai.com/index/old-release',
      title: 'GPT-4 launch',
      text: 'Published: 2023-03-14. OpenAI announced GPT-4 as a current AI development.',
      published_at: '2023-03-14T00:00:00.000Z',
      extraction_ok: true,
      now: NOW,
    })
    results.push(check(
      'ENGINE01-05',
      stale.decision === 'REJECT_STALE' && stale.freshness_state === 'OUT_OF_WINDOW',
      `decision=${stale.decision} freshness=${stale.freshness_state}`,
    ))
  }

  {
    const unknown = assessSourceAuthority({
      mission_id: 'm-date',
      prompt: CURRENT,
      url: 'https://openai.com/index/undated-note',
      title: 'AI development note',
      text: 'OpenAI discusses models and releases without a publication date stamp.',
      retrieved_at: '2026-09-22T16:00:00.000Z',
      extraction_ok: true,
      now: NOW,
    })
    results.push(check(
      'ENGINE01-06',
      unknown.freshness_state === 'DATE_UNKNOWN'
      && unknown.decision === 'DATE_UNKNOWN'
      && !satisfiesStrictWindow(unknown.freshness_state),
      `decision=${unknown.decision} freshness=${unknown.freshness_state}`,
    ))
  }

  {
    const independent = sourcesAreIndependent('https://arxiv.org/abs/1701.06538', 'https://arxiv.org/pdf/1701.06538')
    const dup = assessSourceAuthority({
      mission_id: 'm-dup',
      prompt: MOE,
      url: 'https://arxiv.org/pdf/1701.06538',
      title: 'Outrageously Large Neural Networks',
      text: 'Sparsely-gated mixture-of-experts layers route tokens to experts for efficient inference.',
      extraction_ok: true,
      accepted_identities: ['arxiv:1701.06538'],
      now: NOW,
    })
    results.push(check(
      'ENGINE01-07',
      independent === false && dup.decision === 'REJECT_DUPLICATE' && dup.independence_state === 'DUPLICATE',
      `independent=${independent} decision=${dup.decision} state=${dup.independence_state}`,
    ))
  }

  {
    const failed = assessSourceAuthority({
      mission_id: 'm-fail',
      prompt: MOE,
      url: 'https://arxiv.org/abs/2101.03961',
      title: 'Switch Transformer',
      text: 'fetch failed timed out opened no usable sources',
      extraction_ok: false,
      now: NOW,
    })
    results.push(check(
      'ENGINE01-08',
      failed.decision === 'REJECT_EXTRACTION_FAILED' && failed.extractability_state === 'FAILED',
      `decision=${failed.decision} extract=${failed.extractability_state}`,
    ))
  }

  {
    const claim = claimRow({ claim_id: 'c-empty', text: 'MoE improves inference.', evidence_ids: [] })
    const ok = canPromoteToVerified({
      mission_class: 'DEEP_RESEARCH',
      claim,
      evidence: [],
      lumen_verdict: 'SUPPORTED',
      evidence_refs: [],
      open_conflicts: false,
    })
    const invariant = verifiedRequiresEvidenceRefs({ mission_class: 'DEEP_RESEARCH', evidence_refs: [], usable_count: 0 })
    const lumen = lumenConsumeBinding({
      mission_class: 'DEEP_RESEARCH',
      claim,
      evidence: [],
      proposed_verdict: 'SUPPORTED',
    })
    results.push(check(
      'ENGINE01-09',
      ok === false && invariant === false && lumen.verdict === 'UNKNOWN',
      `promote=${ok} verifiedRefs=${invariant} lumen=${lumen.verdict}`,
    ))
  }

  {
    const conflict = recordEvidenceConflict({
      conflict_id: 'cf-1',
      claim_ids: ['c-a', 'c-b'],
      evidence_a: 'e1',
      evidence_b: 'e2',
      reason: 'two primary sources disagree on the routing claim',
      needed_evidence: 'an independent third primary paper',
    })
    const bound = bindClaimEvidence({
      mission_id: 'm-cf',
      mission_class: 'DEEP_RESEARCH',
      claims: [
        claimRow({ claim_id: 'c-a', text: 'Routing is sparse.', evidence_ids: ['e1'] }),
        claimRow({ claim_id: 'c-b', text: 'Routing is dense.', evidence_ids: ['e2'] }),
      ],
      evidence: [
        evidenceRow({ evidence_id: 'e1', url: 'https://arxiv.org/abs/1701.06538', summary: 'Sparsely-gated mixture-of-experts routing is sparse.' }),
        evidenceRow({ evidence_id: 'e2', url: 'https://arxiv.org/abs/2401.04088', summary: 'Some descriptions treat expert mixing as dense averaging.' }),
      ],
      conflicts: [{
        conflict_id: conflict.conflict_id,
        claim_ids: conflict.claim_ids,
        reason: conflict.reason,
        required_test: conflict.needed_evidence,
        contradicting_evidence_ids: ['e1', 'e2'],
        open: true,
        agent_id: 'PHOENIX',
        round: 1,
      }],
    })
    results.push(check(
      'ENGINE01-10',
      bound.conflicts.some(row => row.conflict_id === 'cf-1' && row.resolution_state === 'open')
      && bound.graph.ebc_canonical === true
      && bound.graph.contradiction_edges.length >= 1,
      `conflicts=${bound.conflicts.map(row => row.conflict_id).join(',')} edges=${bound.graph.contradiction_edges.length}`,
    ))
  }

  {
    const one = calibrateUncertainty({
      mission_id: 'm-cal-1',
      assessments: [assessSourceAuthority({
        mission_id: 'm-cal-1',
        prompt: MOE,
        url: 'https://arxiv.org/abs/1701.06538',
        title: 'Outrageously Large Neural Networks',
        text: 'Sparsely-gated mixture-of-experts layers route each token to a subset of experts during inference.',
        extraction_ok: true,
        now: NOW,
      })],
    })
    results.push(check(
      'ENGINE01-11',
      one.state === 'SINGLE_SOURCE' && one.reasons.some(row => /independent/i.test(row)),
      `state=${one.state} reasons=${one.reasons.join('; ')}`,
    ))
  }

  {
    const two = calibrateUncertainty({
      mission_id: 'm-cal-2',
      assessments: [
        assessSourceAuthority({
          mission_id: 'm-cal-2',
          prompt: MOE,
          url: 'https://arxiv.org/abs/1701.06538',
          title: 'Outrageously Large Neural Networks',
          text: 'Sparsely-gated mixture-of-experts layers route each token to a subset of experts during inference.',
          extraction_ok: true,
          now: NOW,
        }),
        assessSourceAuthority({
          mission_id: 'm-cal-2',
          prompt: MOE,
          url: 'https://arxiv.org/abs/2401.04088',
          title: 'Mixtral of Experts',
          text: 'Mixtral of Experts describes sparse mixture-of-experts routing where each token is processed by a small set of experts during inference.',
          extraction_ok: true,
          now: NOW,
        }),
      ],
    })
    results.push(check(
      'ENGINE01-12',
      (two.state === 'HIGH_SUPPORT' || two.state === 'MODERATE_SUPPORT')
      && two.signals.independent_source_count >= 2
      && String(two.state) !== 'SINGLE_SOURCE',
      `state=${two.state} independent=${two.signals.independent_source_count}`,
    ))
  }

  {
    const conflicting = calibrateUncertainty({
      mission_id: 'm-cal-c',
      assessments: [
        assessSourceAuthority({
          mission_id: 'm-cal-c',
          prompt: MOE,
          url: 'https://arxiv.org/abs/1701.06538',
          title: 'Outrageously Large Neural Networks',
          text: 'Sparsely-gated mixture-of-experts layers route each token to a subset of experts during inference.',
          extraction_ok: true,
          now: NOW,
        }),
        assessSourceAuthority({
          mission_id: 'm-cal-c',
          prompt: MOE,
          url: 'https://arxiv.org/abs/2401.04088',
          title: 'Mixtral of Experts',
          text: 'Mixtral of Experts describes sparse mixture-of-experts routing where each token is processed by a small set of experts during inference.',
          extraction_ok: true,
          now: NOW,
        }),
      ],
      conflicts: [recordEvidenceConflict({
        conflict_id: 'cf-strong',
        claim_ids: ['c-a'],
        evidence_a: 'e1',
        evidence_b: 'e2',
        reason: 'primary sources disagree',
        needed_evidence: 'third independent paper',
      })],
    })
    results.push(check(
      'ENGINE01-13',
      conflicting.state === 'CONFLICTING' && conflicting.commander_facing === 'sources conflict',
      `state=${conflicting.state} facing=${conflicting.commander_facing}`,
    ))
  }

  {
    const zero = calibrateUncertainty({ mission_id: 'm-zero' })
    results.push(check(
      'ENGINE01-14',
      zero.state === 'INSUFFICIENT_EVIDENCE' && zero.signals.usable_source_count === 0,
      `state=${zero.state}`,
    ))
  }

  {
    const board = createEvidenceBoard({
      mission_id: 'm-aurora',
      mission_class: 'DEEP_RESEARCH',
      question: MOE,
      agents: ['PULSAR', 'LUMEN', 'AURORA'],
      ttl_seconds: 60,
      budget_tokens: 1000,
      budget_ms: 1000,
    })
    board.claims.push(claimRow({
      claim_id: 'c-unbound',
      text: 'MoE is verified without sources.',
      evidence_ids: ['ghost'],
      status: 'VERIFIED',
    }))
    const aurora = synthesizeAurora(boardSnapshot(board), 'UNVERIFIED', 0.4)
    const consume = auroraConsumeEngines({
      aurora,
      bindings: [{
        claim_id: 'c-unbound',
        claim_text: 'MoE is verified without sources.',
        evidence_refs: [],
        source_refs: [],
        support_type: 'INSUFFICIENT',
        support_strength: 'none',
        freshness_state: 'DATE_UNKNOWN',
        verification_state: 'VERIFIED',
        contradiction_refs: [],
      }],
    })
    results.push(check(
      'ENGINE01-15',
      aurora.verified_facts.length === 0
      && consume.unbound_external_claims_excluded === false
      && consume.commander_authority === 'REQUIRED_FOR_ACTION',
      `verified=${aurora.verified_facts.length} unbound_excluded=${consume.unbound_external_claims_excluded}`,
    ))
  }

  {
    const board = createEvidenceBoard({
      mission_id: 'm-ebc',
      mission_class: 'DEEP_RESEARCH',
      question: MOE,
      agents: ['PULSAR', 'LUMEN', 'PHOENIX', 'AURORA'],
      ttl_seconds: 60,
      budget_tokens: 1000,
      budget_ms: 1000,
    })
    const row = evidenceRow({
      evidence_id: 'e-moe',
      url: 'https://arxiv.org/abs/1701.06538',
      final_url: 'https://arxiv.org/abs/1701.06538',
      summary: 'Sparsely-gated mixture-of-experts layers route each token to a subset of experts during inference.',
    })
    board.evidence.push(row)
    board.claims.push(claimRow({ claim_id: 'c-moe', text: 'MoE routing is sparse.', evidence_ids: ['e-moe'] }))
    const aurora = synthesizeAurora(boardSnapshot(board), 'PARTIALLY_VERIFIED', 0.5)
    const overlay = attachCouncilEnginePublic({ board, lumen: [], aurora })
    const invented = overlay.claim_evidence_links.some(link => link.claim_id !== 'c-moe')
    results.push(check(
      'ENGINE01-16',
      overlay.ebc_canonical === true && invented === false && overlay.schema.startsWith('council-engine-01'),
      `canonical=${overlay.ebc_canonical} invented=${invented}`,
    ))
  }

  {
    const aurora = synthesizeAurora(boardSnapshot(createEvidenceBoard({
      mission_id: 'm-auth',
      mission_class: 'DEEP_RESEARCH',
      question: MOE,
      agents: ['AURORA'],
      ttl_seconds: 60,
      budget_tokens: 100,
      budget_ms: 100,
    })), 'UNVERIFIED', 0)
    results.push(check(
      'ENGINE01-17',
      aurora.commander_authority === 'REQUIRED_FOR_ACTION',
      aurora.commander_authority,
    ))
  }

  {
    const state = createSimulatedSessionState()
    simulateSelectSession(state, 'sess-a', [{ messageType: 'decree', content: MOE }, { messageType: 'response', content: 'moe reply' }])
    simulateSelectSession(state, 'sess-b', [{ messageType: 'decree', content: 'what is the status' }, { messageType: 'response', content: 'status reply' }])
    simulateSelectSession(state, 'sess-a', [{ messageType: 'decree', content: MOE }, { messageType: 'response', content: 'moe reply' }])
    results.push(check(
      'ENGINE01-18',
      sidebarPaneIdentitiesAgree({ sidebarSessionId: state.activeSessionId, paneOwnerId: state.transcriptOwnerId })
      && state.activeSessionId === 'sess-a',
      `active=${state.activeSessionId} owner=${state.transcriptOwnerId}`,
    ))
  }

  {
    const stop = decideDiscoveryStop({
      usable_count: 2,
      independent_count: 2,
      primary_count: 1,
      inspected_count: 3,
      candidate_budget: 5,
      freshness_skips: 0,
      remaining_ms: 20_000,
      min_usable: 2,
      required_freshness: false,
    })
    const orion = orionConsumeEnginePacket({
      question: MOE,
      plan: planResearchDiscovery({ mission_id: 'm-orion', question: MOE }),
      conflicts: [recordEvidenceConflict({
        conflict_id: 'cf-orion',
        claim_ids: ['c1'],
        reason: 'gap',
        needed_evidence: 'another primary paper',
      })],
    })
    const phoenix = phoenixTargetsFromEngines({
      bindings: bindClaimEvidence({
        mission_id: 'm-px',
        mission_class: 'DEEP_RESEARCH',
        claims: [claimRow({ claim_id: 'c-thin', text: 'unsupported', evidence_ids: [] })],
        evidence: [],
      }).bindings,
    })
    const pulsar = pulsarConsumeAssessments(
      pulsarConsumeDiscovery({ mission_id: 'm-p', question: SEC }),
      [{
        url: 'https://www.sec.gov/Archives/edgar/data/1318605/000162828024002390/tsla-20231231.htm',
        title: 'Tesla 10-K',
        text: 'Tesla, Inc. Form 10-K annual report filed with the SEC EDGAR system covering fiscal year financial statements. Filed: 2026-09-10.',
        published_at: '2026-09-10T00:00:00.000Z',
        extraction_ok: true,
        now: NOW,
      }],
      SEC,
      'm-p',
    )
    results.push(check(
      'ENGINE01-INTEGRATION',
      stop.condition === 'PRIMARY_PLUS_CORROBORATION'
      && orion.open_conflicts.length === 1
      && phoenix.some(row => row.challenge_type === 'MISSING_TEST')
      && pulsar.accepted.length === 1,
      `stop=${stop.condition} orion=${orion.open_conflicts.length} phoenix=${phoenix.map(row => row.challenge_type).join(',')} accepted=${pulsar.accepted.length}`,
    ))
  }

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCouncilEngine01Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`COUNCIL_ENGINE_01 ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
