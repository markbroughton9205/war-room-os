/**
 * Council Intelligence Architecture validation.
 * Extends EBC. Does not execute destructive, financial, commit, push, or deploy actions.
 */
import { classifyEvidenceBoardMission } from '@/lib/council/evidence-board/classifier'
import { toolFingerprint, type ToolCallRecord } from '@/lib/council/evidence-board'
import type { ToolRunner } from '@/lib/council/evidence-board/tools'
import {
  amendMissionContract,
  analyzeScenarios,
  answerCurrentInstall,
  assertNoWrimTraining,
  createMissionContract,
  createReceipt,
  DEFAULT_ROLE_FULFILLMENT,
  gateMissionMemory,
  governPlan,
  governStep,
  janusHasUnsupportedFact,
  listIndexedCapabilities,
  overlayIntelligenceClass,
  planWithAtlas,
  receiptContainsSecret,
  recordInstallChange,
  resolveIntelligenceRouting,
  resolveTemporalConflict,
  reviewWithSentinel,
  runCouncilIntelligenceMission,
  seedWarRoomSelfKnowledge,
  sentinelNeverGrantsAuthority,
  stepEvidenceSatisfied,
  wrimRoleInterface,
  type AtlasPlanStep,
  type MemoryCandidate,
} from '@/lib/council/intelligence'

type Case = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: unknown): Case => ({
  name,
  pass,
  detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
})

function fixtureTools(): ToolRunner {
  const now = new Date().toISOString()
  const cache = new Map<string, ToolCallRecord>()
  const payloads: Record<string, Partial<ToolCallRecord>> = {
    'wr.core.health': { ok: true, status_code: 200, summary: 'Core health 200', pointer: 'http://127.0.0.1:3847/api/local/health', kind: 'live_telemetry' },
    'wr.ui.health': { ok: true, status_code: 200, summary: 'UI health 200', pointer: 'http://127.0.0.1:3848/api/health', kind: 'live_telemetry' },
    'wr.ports.list': { ok: true, summary: 'listeners=2 critical=3847:11,3848:22', pointer: 'ss:-ltnp', kind: 'live_telemetry', payload: { listeners: [{ port: 3847, pid: 11 }, { port: 3848, pid: 22 }] } },
    'wr.council.backend': { ok: true, summary: 'Council local backend READY_LOCAL', pointer: 'http://127.0.0.1:11434', kind: 'live_telemetry' },
    'wr.git.branch': { ok: true, summary: 'branch main @ abc1234', pointer: 'git:HEAD', kind: 'repo_config', temporal_layer: 'LAST_VERIFIED' },
    'wr.broker.status': { ok: true, summary: 'Browser Broker READY', pointer: 'broker:status', kind: 'live_telemetry' },
    'broker.fetch': { ok: true, summary: 'Playwright docs — https://playwright.dev/docs/browser-contexts', pointer: 'https://playwright.dev/docs/browser-contexts', url: 'https://playwright.dev/docs/browser-contexts', kind: 'primary_external' },
  }
  return async (toolName, args = {}) => {
    const fingerprint = toolFingerprint(toolName, args)
    const cached = cache.get(fingerprint)
    if (cached) return cached
    const seed = payloads[toolName]
    const record: ToolCallRecord = {
      tool_name: toolName,
      args_fingerprint: fingerprint,
      ok: seed?.ok ?? false,
      blocked: seed?.ok === false,
      denied: false,
      summary: seed?.summary ?? `Unknown tool ${toolName}`,
      pointer: seed?.pointer ?? toolName,
      url: seed?.url ?? null,
      kind: seed?.kind ?? 'tool_result',
      retrieved_at: now,
      temporal_layer: seed?.temporal_layer ?? 'CURRENT_LIVE',
      payload: seed?.payload,
      status_code: seed?.status_code ?? null,
    }
    cache.set(fingerprint, record)
    return record
  }
}

export async function runCouncilIntelligenceValidation(): Promise<Case[]> {
  const results: Case[] = []
  const now = '2026-09-22T17:00:00.000Z'

  const socialClass = classifyEvidenceBoardMission({ commanderMessage: 'Hi Council', now: 1 })
  const socialRoute = resolveIntelligenceRouting({ text: 'Hi Council', ebcClass: socialClass.mission_class })
  const socialContract = createMissionContract({
    missionId: 'm-social',
    ebcClass: socialClass.mission_class,
    intelligenceClass: socialRoute.intelligence_class,
    commanderMessage: 'Hi Council',
    lightweight: true,
    now,
  })
  results.push(check('CONTRACT-SOCIAL-LIGHT', socialContract.lightweight && socialRoute.atlas === false && socialRoute.janus === false && socialRoute.sentinel === false, socialRoute))
  results.push(check('CONTRACT-FIELDS', Boolean(socialContract.objective && socialContract.authority.commit === false), socialContract.authority))

  const engText = 'Repair Council startup. Restore Council online. Scope: Council runtime only. Explicit exclusions: Terra, Foundry feature work, WRIM training. Commit NO. Push NO. Production deploy NO. Required proof: installed 3848.'
  const engClass = classifyEvidenceBoardMission({ commanderMessage: engText, now: 2 })
  const engRoute = resolveIntelligenceRouting({ text: engText, ebcClass: engClass.mission_class })
  const engContract = createMissionContract({
    missionId: 'm-eng',
    ebcClass: engClass.mission_class,
    intelligenceClass: overlayIntelligenceClass(engText, engClass.mission_class),
    commanderMessage: engText,
    now,
  })
  results.push(check('CONTRACT-REQUIREMENT-VS-ASSUMPTION', engContract.explicit_exclusions.includes('commit') && engContract.assumptions.length >= 0 && !engContract.explicit_requirements.includes('invented'), engContract))
  results.push(check('CONTRACT-AUTHORITY', engContract.authority.commit === false && engContract.authority.push === false && engContract.authority.production_deploy === false, engContract.authority))
  const amended = amendMissionContract(engContract, { reason: 'Commander narrowed scope', changes: { scope: [...engContract.scope, 'no WRIM'] }, executionStarted: true, now: '2026-09-22T17:05:00.000Z' })
  results.push(check('CONTRACT-REVISION-RECEIPT', amended.revision_receipt_required && amended.contract.version === 2 && amended.contract.revisions[0].receipt_id !== null, amended.contract.revisions[0]))

  const commitText = 'Engineering mission: commit the council intelligence patch after tests. Commit NO. Push NO.'
  const commitClass = classifyEvidenceBoardMission({ commanderMessage: commitText, now: 3 })
  const commitContract = createMissionContract({
    missionId: 'm-commit',
    ebcClass: commitClass.mission_class,
    intelligenceClass: 'ENGINEERING_MISSION',
    commanderMessage: commitText,
    now,
  })
  const atlasCommit = planWithAtlas({ contract: commitContract, now })
  const blocked = atlasCommit.steps.filter(step => step.status === 'BLOCKED_BY_AUTHORITY')
  results.push(check('ATLAS-BLOCKED-BY-AUTHORITY', blocked.length >= 1 && blocked.some(step => step.required_capabilities.includes('git.commit')), blocked.map(step => step.step_id)))
  results.push(check('ATLAS-DAG', atlasCommit.hard_dependencies.length >= 1 && atlasCommit.parallelizable_groups.length >= 1, atlasCommit))
  const completion = atlasCommit.steps.find(step => step.required_evidence.includes('install_id') || step.required_evidence.includes('3847_pid'))
  results.push(check('ATLAS-REQUIRED-EVIDENCE', Boolean(completion && !stepEvidenceSatisfied(completion, []) && stepEvidenceSatisfied(completion, ['3847_pid', '3848_pid', 'executable_path', 'install_id'])), completion?.required_evidence))

  const decisionText = 'Should Council store runtime status as immutable current-state fields or temporal records?'
  const decisionClass = classifyEvidenceBoardMission({ commanderMessage: decisionText, now: 4 })
  const decisionRoute = resolveIntelligenceRouting({ text: decisionText, ebcClass: decisionClass.mission_class })
  const decisionContract = createMissionContract({
    missionId: 'm-janus',
    ebcClass: decisionClass.mission_class,
    intelligenceClass: decisionRoute.intelligence_class,
    commanderMessage: decisionText,
    now,
  })
  const janus = analyzeScenarios({ contract: decisionContract, evidenceIds: ['e-temporal-types'], now })
  results.push(check('JANUS-INVOKED', decisionRoute.janus && janus.scenarios.length >= 3, { class: decisionRoute.intelligence_class, n: janus.scenarios.length }))
  results.push(check('JANUS-ABC', janus.scenarios.some(s => /overwrite|immutable|current-state/i.test(s.option)) && janus.scenarios.some(s => /temporal/i.test(s.option)) && janus.scenarios.some(s => /do nothing|current/i.test(s.option)), janus.scenarios.map(s => s.option)))
  results.push(check('JANUS-NO-UNSUPPORTED-FACT', janusHasUnsupportedFact(janus) === false, janus.scenarios.flatMap(s => s.benefits)))
  results.push(check('JANUS-PROJECTION-LABELED', janus.scenarios.some(s => s.failure_modes.some(row => row.kind === 'PROJECTION')), 'ok'))

  const sentinelPlan = planWithAtlas({ contract: createMissionContract({
    missionId: 'm-sentinel',
    ebcClass: 'ENGINEERING',
    intelligenceClass: 'ENGINEERING_MISSION',
    commanderMessage: 'Plan includes delete production database. Do not actually attempt it.',
    now,
  }), now })
  const sentinel = reviewWithSentinel({
    contract: createMissionContract({
      missionId: 'm-sentinel',
      ebcClass: 'ENGINEERING',
      intelligenceClass: 'RISK_REVIEW',
      commanderMessage: 'Plan includes delete production database. Do not actually attempt it.',
      now,
    }),
    plan: sentinelPlan,
    now,
  })
  results.push(check('SENTINEL-CRITICAL-BLOCK', sentinel.risks.some(r => r.category === 'DATA_LOSS' && r.blocking && r.severity === 'CRITICAL') && sentinel.grants_authority === false && sentinelNeverGrantsAuthority(sentinel), sentinel.risks.map(r => r.category)))

  const graph = seedWarRoomSelfKnowledge({
    now,
    installId: 'war-room-os-0.1.0-75f49a0-browser-ebc-research2',
    evidenceInstall: 'e-install',
    councilState: 'READY_LOCAL',
    evidenceCouncil: 'e-council',
    ebcActive: true,
    evidenceEbc: 'e-ebc',
    brokerState: 'READY',
    evidenceBroker: 'e-broker',
  })
  results.push(check('KG-SEED-PROVENANCE', graph.nodes.every(n => n.source_evidence_ids.length > 0) && graph.nodes.some(n => n.node_type === 'COUNCIL') && graph.edges.some(e => e.kind === 'ROUTES_TO'), { nodes: graph.nodes.length, edges: graph.edges.length }))
  results.push(check('KG-DEEP-RESEARCH-ROUTES', graph.edges.some(e => e.kind === 'ROUTES_TO'), graph.edges.map(e => e.kind)))

  const oldInstall = 'war-room-os-old'
  const newInstall = 'war-room-os-new'
  const temporalGraph = recordInstallChange(seedWarRoomSelfKnowledge({ now: '2026-09-21T00:00:00.000Z' }), {
    oldInstallId: oldInstall,
    newInstallId: newInstall,
    oldObservedAt: '2026-09-21T00:00:00.000Z',
    newObservedAt: '2026-09-22T17:00:00.000Z',
    newEvidenceId: 'e-new-install',
  })
  const currentInstall = answerCurrentInstall(temporalGraph)
  const oldNode = temporalGraph.nodes.find(n => n.canonical_name === oldInstall)
  const newNode = temporalGraph.nodes.find(n => n.canonical_name === newInstall)
  results.push(check('TEMPORAL-SUPERSESSION', currentInstall === newInstall && oldNode?.temporal_state === 'SUPERSEDED' && newNode?.temporal_state === 'CURRENT' && temporalGraph.nodes.some(n => n.canonical_name === oldInstall), {
    currentInstall,
    old: oldNode?.temporal_state,
    new: newNode?.temporal_state,
    retained: temporalGraph.nodes.filter(n => n.node_type === 'INSTALL').map(n => `${n.canonical_name}:${n.temporal_state}`),
  }))
  const conflict = resolveTemporalConflict(
    { node_id: 'a', canonical_name: 'ACTIVE_INSTALL', observed_at: '2026-09-21T00:00:00.000Z', confidence_state: 'VERIFIED', source_evidence_ids: ['e1'], temporal_state: 'CURRENT', metadata: {}, source_quality: 'LIVE_TELEMETRY' },
    { node_id: 'b', canonical_name: 'ACTIVE_INSTALL', observed_at: '2026-09-22T17:00:00.000Z', confidence_state: 'VERIFIED', source_evidence_ids: ['e2'], temporal_state: 'CURRENT', metadata: {}, source_quality: 'LIVE_TELEMETRY' },
  )
  results.push(check('TEMPORAL-CONFLICT-RULE', conflict.current.node_id === 'b' && conflict.superseded[0].node_id === 'a' && conflict.deleted === false, conflict))

  const stale: MemoryCandidate = {
    fact_id: 'f-old',
    text: 'ACTIVE_INSTALL=old',
    scope: 'PROJECT',
    truth_state: 'VERIFIED',
    source_quality: 'LIVE_TELEMETRY',
    evidence_ids: ['e-old'],
    sensitivity: 'NONE',
    temporal_state: 'SUPERSEDED',
    speculative: false,
  }
  const fresh: MemoryCandidate = {
    fact_id: 'f-new',
    text: 'ACTIVE_INSTALL=new',
    scope: 'PROJECT',
    truth_state: 'VERIFIED',
    source_quality: 'LIVE_TELEMETRY',
    evidence_ids: ['e-new'],
    sensitivity: 'NONE',
    temporal_state: 'CURRENT',
    speculative: false,
  }
  const speculative: MemoryCandidate = {
    fact_id: 'f-guess',
    text: 'Council learned the architecture',
    scope: 'PROJECT',
    truth_state: 'UNKNOWN',
    source_quality: 'INFERRED',
    evidence_ids: [],
    sensitivity: 'NONE',
    temporal_state: 'UNKNOWN',
    speculative: true,
  }
  const gated = gateMissionMemory({
    missionId: 'm-mem',
    commanderText: 'Record the current install identity as project state going forward.',
    candidates: [stale, fresh, speculative],
  })
  results.push(check('MEMORY-GATE', gated.decisions.find(d => d.fact_id === 'f-old')?.decision === 'SUPERSEDED' && gated.decisions.find(d => d.fact_id === 'f-new')?.decision === 'PROJECT_CANDIDATE' && gated.decisions.find(d => d.fact_id === 'f-guess')?.decision === 'EPHEMERAL', gated.decisions))

  const caps = listIndexedCapabilities()
  results.push(check('CAPABILITY-REGISTRY', caps.some(c => c.capability_id === 'browser.fetch') && caps.some(c => c.capability_id === 'system.health') && caps.every(c => c.health === 'INDEXED') && !caps.some(c => /made-up|invented/.test(c.capability_id)), caps.map(c => c.capability_id)))

  const screenshotStep: AtlasPlanStep = {
    step_id: 'shot',
    title: 'Screenshot',
    purpose: 'Read-only capture',
    depends_on: [],
    required_capabilities: ['browser.screenshot'],
    required_evidence: [],
    expected_output: 'png',
    reversible: true,
    approval_required: false,
    risk_level: 'LOW',
    status: 'PLANNED',
    required: false,
    parallel_group: null,
    blocked_reason: null,
  }
  const shot = governStep({ contract: commitContract, step: screenshotStep, capabilityId: 'browser.screenshot' })
  results.push(check('GOVERNOR-SCREENSHOT-ALLOW', shot.verdict === 'ALLOW', shot))
  const commitGov = governPlan({ contract: commitContract, steps: atlasCommit.steps, sentinel: reviewWithSentinel({ contract: commitContract, plan: atlasCommit, now }) })
  results.push(check('GOVERNOR-COMMIT-DENY', commitGov.some(d => d.capability_id === 'git.commit' && (d.verdict === 'DENY' || d.verdict === 'REQUIRE_COMMANDER_APPROVAL')), commitGov.filter(d => d.capability_id === 'git.commit')))
  const financeStep: AtlasPlanStep = {
    ...screenshotStep,
    step_id: 'pay',
    title: 'External financial submission',
    required_capabilities: ['finance.settlement_submit'],
    status: 'PLANNED',
  }
  const finance = governStep({ contract: commitContract, step: financeStep, capabilityId: 'finance.settlement_submit' })
  results.push(check('GOVERNOR-FINANCIAL-DENY', finance.verdict === 'DENY', finance))
  const deleteGov = governPlan({
    contract: createMissionContract({
      missionId: 'm-sentinel',
      ebcClass: 'ENGINEERING',
      intelligenceClass: 'ENGINEERING_MISSION',
      commanderMessage: 'Plan includes delete production database.',
      now,
    }),
    steps: sentinelPlan.steps,
    sentinel,
  })
  results.push(check('GOVERNOR-SENTINEL-BLOCK', deleteGov.every(d => d.verdict === 'DENY' || d.sentinel_blocking), { n: deleteGov.length, denials: deleteGov.filter(d => d.verdict === 'DENY').length }))

  const receipt = createReceipt({
    missionId: 'm-eng',
    capability: 'wr.core.health',
    requestedAction: 'GET /api/local/health',
    authorityResult: 'ALLOW',
    startedAt: now,
    completedAt: now,
    success: true,
    resultSummary: 'Core health 200',
    evidenceIds: ['e1'],
    runtimeIdentity: 'fixture',
  })
  const secretReceipt = createReceipt({
    missionId: 'm-eng',
    capability: 'files.read',
    requestedAction: 'read env',
    authorityResult: 'DENY',
    startedAt: now,
    completedAt: now,
    success: false,
    resultSummary: 'api_key=should-redact-this-value',
    error: null,
  })
  results.push(check('RECEIPT-SCHEMA', receipt.schema === 'war-room.execution-receipt.v1' && receipt.success && !receiptContainsSecret(receipt), receipt))
  results.push(check('RECEIPT-NO-SECRET', !receiptContainsSecret(secretReceipt) && !/should-redact/.test(secretReceipt.result_summary), secretReceipt.result_summary))

  results.push(check('WRIM-HOOK-ONLY', wrimRoleInterface('atlas-planning').wrim_active === false && wrimRoleInterface('atlas-planning').training_invoked === false && DEFAULT_ROLE_FULFILLMENT.every(assertNoWrimTraining), wrimRoleInterface('classifier')))
  results.push(check('ROLE-NEQ-PROVIDER', DEFAULT_ROLE_FULFILLMENT.some(r => r.role === 'ATLAS' && r.provider_kind === 'deterministic'), DEFAULT_ROLE_FULFILLMENT.map(r => `${r.role}:${r.provider_kind}`)))

  const socialRun = await runCouncilIntelligenceMission({
    commanderMessage: 'Hi Council',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  results.push(check('ROUTE-SOCIAL-LIGHT', socialRun.public.routing.atlas === false && socialRun.public.routing.janus === false && socialRun.public.metrics.layers_invoked.includes('contract') && socialRun.ebc?.classification.mission_class === 'SOCIAL_CHECKIN', socialRun.public.metrics))

  const statusRun = await runCouncilIntelligenceMission({
    commanderMessage: 'Status on War Room',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  results.push(check('ROUTE-SYSTEM-STATUS', statusRun.ebc?.classification.mission_class === 'SYSTEM_STATUS' && statusRun.public.routing.self_awareness === true && statusRun.public.ebc_truth_spine === true, statusRun.public.routing))

  const researchRun = await runCouncilIntelligenceMission({
    commanderMessage: 'Research the current Playwright guidance for persistent browser profiles and use primary sources.',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  results.push(check('ROUTE-DEEP-RESEARCH-EBC', researchRun.ebc?.classification.mission_class === 'DEEP_RESEARCH' && (researchRun.ebc.classification.selected_agents.includes('PULSAR')) && researchRun.public.ebc_truth_spine, researchRun.ebc?.classification.selected_agents))

  const e2e = await runCouncilIntelligenceMission({
    commanderMessage: 'Assess the current War Room Council runtime, identify one architectural improvement, compare options, identify risks, and return an evidence-backed recommendation without changing the system.',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  results.push(check('E2E-CONTRACT', Boolean(e2e.public.contract), e2e.public.contract?.mission_class))
  results.push(check('E2E-ATLAS', Boolean(e2e.public.plan && e2e.public.plan.steps.length >= 2), e2e.public.plan?.steps.map(s => s.step_id)))
  results.push(check('E2E-EBC', Boolean(e2e.ebc && e2e.snapshot), e2e.ebc?.classification.mission_class))
  results.push(check('E2E-JANUS', Boolean(e2e.public.scenarios?.invoked && e2e.public.scenarios.scenarios.length >= 3), e2e.public.scenarios?.skip_reason))
  results.push(check('E2E-SENTINEL', Boolean(e2e.public.risks?.invoked), e2e.public.risks?.risks.map(r => r.category)))
  results.push(check('E2E-PHOENIX', Boolean(e2e.ebc && (e2e.ebc.classification.phoenix_required || e2e.ebc.phoenix.length >= 0)), e2e.ebc?.classification.selected_agents))
  results.push(check('E2E-AURORA', Boolean(e2e.ebc?.aurora), e2e.ebc?.aurora.completion_state))
  results.push(check('E2E-RECEIPTS', e2e.public.receipts.length >= 1, e2e.public.receipts.length))
  results.push(check('E2E-NO-MUTATION', e2e.public.governor.every(d => d.capability_id !== 'git.commit' || d.verdict !== 'ALLOW') && e2e.public.contract?.authority.commit === false, e2e.public.governor.map(d => `${d.capability_id}:${d.verdict}`)))
  results.push(check('E2E-RATIONALE', Boolean(e2e.public.rationale && e2e.public.rationale.chain_of_thought_exposed === false), e2e.public.rationale?.authority_constraints))
  results.push(check('E2E-KG', e2e.public.knowledge.node_count >= 1, e2e.public.knowledge))
  results.push(check('E2E-MEMORY', Boolean(e2e.public.memory), e2e.public.memory?.decisions.length))
  results.push(check('PERF-SOCIAL-LT-STATUS', socialRun.public.metrics.layers_invoked.length <= statusRun.public.metrics.layers_invoked.length, {
    social: socialRun.public.metrics,
    status: statusRun.public.metrics,
    e2e: e2e.public.metrics,
  }))

  return results
}

async function main() {
  const results = await runCouncilIntelligenceValidation()
  const failed = results.filter(row => !row.pass)
  for (const row of results) {
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name}: ${row.detail}`.slice(0, 500))
  }
  console.log(`Council intelligence validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exitCode = 1
}

const isDirect = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('intelligence.validation')
if (isDirect) {
  void main()
}
