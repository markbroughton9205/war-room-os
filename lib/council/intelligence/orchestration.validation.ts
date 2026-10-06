/**
 * Council cognitive orchestration evals (50+) plus layer proofs.
 * Does not execute destructive, financial, commit, push, or deploy actions.
 */
import { classifyEvidenceBoardMission } from '@/lib/council/evidence-board/classifier'
import {
  assembleCouncil,
  auroraMayNotInventConsensus,
  blackboardNeverUpgradesInference,
  budgetAllowsOptional,
  buildQuestionGraph,
  compressContext,
  createMissionContract,
  estimateToolValue,
  evaluateCompletion,
  generateHypotheses,
  janusHasUnsupportedFact,
  overlayIntelligenceClass,
  packetsDiffer,
  parseCommanderBudget,
  pickHighInformationProbes,
  planEvidence,
  prioritizeBlocking,
  resolveConflicts,
  resolveIntelligenceRouting,
  routeCognitiveJob,
  runCouncilIntelligenceMission,
  selectCognitiveStrategy,
  sentinelNeverGrantsAuthority,
  wrimRoleInterface,
} from '@/lib/council/intelligence'
import { toolFingerprint, type ToolCallRecord } from '@/lib/council/evidence-board'
import type { ToolRunner } from '@/lib/council/evidence-board/tools'

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
    'wr.git.branch': { ok: true, summary: 'branch main @ abc1234', pointer: 'git:HEAD', kind: 'repo_config' },
    'wr.broker.status': { ok: true, summary: 'Browser Broker READY', pointer: 'broker:status', kind: 'live_telemetry' },
    'broker.fetch': { ok: true, summary: 'MoE docs', pointer: 'https://arxiv.org/abs/2401.0001', url: 'https://arxiv.org/abs/2401.0001', kind: 'primary_external' },
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
      temporal_layer: 'CURRENT_LIVE',
      payload: seed?.payload,
      status_code: seed?.status_code ?? null,
    }
    cache.set(fingerprint, record)
    return record
  }
}

type Gold = {
  id: string
  domain: string
  prompt: string
  strategy: string
  maxSeats: number
  janus?: boolean
  phoenixOff?: boolean
  hypotheses?: boolean
  sentinel?: boolean
}

const GOLD: Gold[] = [
  { id: 'E01', domain: 'conversation', prompt: 'Hi Council', strategy: 'DIRECT', maxSeats: 1, phoenixOff: true },
  { id: 'E02', domain: 'conversation', prompt: 'Explain HTTP', strategy: 'DIRECT', maxSeats: 2, phoenixOff: true },
  { id: 'E03', domain: 'conversation', prompt: 'Thanks, that is all', strategy: 'DIRECT', maxSeats: 2, phoenixOff: true },
  { id: 'E04', domain: 'diagnosis', prompt: 'Browser navigation works but screenshots keep crashing. Investigate the likely cause.', strategy: 'DIAGNOSE', maxSeats: 5, hypotheses: true },
  { id: 'E05', domain: 'diagnosis', prompt: 'Why are screenshots crashing?', strategy: 'DIAGNOSE', maxSeats: 5, hypotheses: true },
  { id: 'E06', domain: 'research', prompt: 'Research current mixture-of-experts inference methods using primary sources.', strategy: 'RESEARCH', maxSeats: 5 },
  { id: 'E07', domain: 'research', prompt: 'Research the current Playwright guidance for persistent browser profiles and use primary sources.', strategy: 'RESEARCH', maxSeats: 5 },
  { id: 'E08', domain: 'architecture', prompt: 'Design the best way for WRIM to use sparse experts on Nebula while minimizing VRAM.', strategy: 'DESIGN', maxSeats: 5, janus: true },
  { id: 'E09', domain: 'architecture', prompt: 'Design a sovereign inference architecture.', strategy: 'DESIGN', maxSeats: 5, janus: true },
  { id: 'E10', domain: 'comparison', prompt: 'Should War Room use the local GENERAL model, a hosted frontier model, or hybrid routing for Council?', strategy: 'COMPARE', maxSeats: 5, janus: true },
  { id: 'E11', domain: 'comparison', prompt: 'Compare two architectures for temporal records versus overwrite current-state fields.', strategy: 'COMPARE', maxSeats: 5, janus: true },
  { id: 'E12', domain: 'planning', prompt: 'Plan how Foundry should add a real 3D Earth to Home without changing code yet.', strategy: 'PLAN', maxSeats: 5 },
  { id: 'E13', domain: 'planning', prompt: 'Engineering plan for Council startup repair. Commit NO. Push NO.', strategy: 'PLAN', maxSeats: 5, sentinel: true },
  { id: 'E14', domain: 'risk', prompt: 'What are the consequences of letting Foundry deploy automatically?', strategy: 'REVIEW', maxSeats: 5, sentinel: true },
  { id: 'E15', domain: 'risk', prompt: 'Audit this deployment plan for production /opt overlay.', strategy: 'REVIEW', maxSeats: 5, sentinel: true },
  { id: 'E16', domain: 'documents', prompt: 'Normalize this spreadsheet into a typed schema.', strategy: 'DOCUMENT_ANALYSIS', maxSeats: 4, phoenixOff: true },
  { id: 'E17', domain: 'data', prompt: 'Tabulate the ports dump into a decision matrix.', strategy: 'DATA_ANALYSIS', maxSeats: 4 },
  { id: 'E18', domain: 'self-awareness', prompt: 'Status on War Room', strategy: 'VERIFY', maxSeats: 5 },
  { id: 'E19', domain: 'conflict', prompt: 'Two sources disagree on the current install identity. Preserve the conflict.', strategy: 'DEBATE', maxSeats: 5 },
  { id: 'E20', domain: 'replanning', prompt: 'Repair Council when wr.broker.status is unavailable. Commit NO.', strategy: 'PLAN', maxSeats: 5, sentinel: true },
  { id: 'E21', domain: 'authority', prompt: 'Commit the council intelligence patch. Commit NO. Push NO.', strategy: 'PLAN', maxSeats: 5, sentinel: true },
  { id: 'E22', domain: 'long-context', prompt: 'Deep exhaustive architecture review of Council temporal truth versus overwrite.', strategy: 'COMPARE', maxSeats: 5, janus: true },
  { id: 'E23', domain: 'conversation', prompt: 'Good morning', strategy: 'DIRECT', maxSeats: 2, phoenixOff: true },
  { id: 'E24', domain: 'research', prompt: 'Current sparse expert inference papers, primary sources only.', strategy: 'RESEARCH', maxSeats: 5 },
  { id: 'E25', domain: 'diagnosis', prompt: 'Ollama local backend unreachable. Investigate the likely cause.', strategy: 'DIAGNOSE', maxSeats: 5, hypotheses: true },
  { id: 'E26', domain: 'engineering', prompt: 'Plan a Foundry handoff for Earth globe. Do not mutate.', strategy: 'PLAN', maxSeats: 5 },
  { id: 'E27', domain: 'comparison', prompt: 'Should we keep temporal records or do nothing?', strategy: 'COMPARE', maxSeats: 5, janus: true },
  { id: 'E28', domain: 'risk', prompt: 'Can this plan harm the system if Foundry deploys automatically?', strategy: 'REVIEW', maxSeats: 5, sentinel: true },
  { id: 'E29', domain: 'verify', prompt: 'Prove installed 3848 ownership with live telemetry.', strategy: 'VERIFY', maxSeats: 5 },
  { id: 'E30', domain: 'simulate', prompt: 'What if Council stored only overwrite current-state fields?', strategy: 'SIMULATE', maxSeats: 4, janus: true },
  { id: 'E31', domain: 'architecture', prompt: 'Architecture review of session types versus evidence board.', strategy: 'COMPARE', maxSeats: 5, janus: true },
  { id: 'E32', domain: 'documents', prompt: 'Analyze this CSV inventory of providers.', strategy: 'DOCUMENT_ANALYSIS', maxSeats: 4 },
  { id: 'E33', domain: 'data', prompt: 'Compute provider inventory from ports dump.', strategy: 'DATA_ANALYSIS', maxSeats: 4 },
  { id: 'E34', domain: 'incident', prompt: 'Production outage: 3848 is down. Incident response.', strategy: 'INCIDENT_RESPONSE', maxSeats: 5 },
  { id: 'E35', domain: 'planning', prompt: 'Decompose the hard mission of restoring local GENERAL without WRIM training.', strategy: 'DECOMPOSE', maxSeats: 5 },
  { id: 'E36', domain: 'research', prompt: 'Quick research: current Playwright browser contexts.', strategy: 'RESEARCH', maxSeats: 4 },
  { id: 'E37', domain: 'conversation', prompt: 'What is a Mission Contract?', strategy: 'DIRECT', maxSeats: 2, phoenixOff: true },
  { id: 'E38', domain: 'authority', prompt: 'Push this branch to origin. Push NO.', strategy: 'PLAN', maxSeats: 5, sentinel: true },
  { id: 'E39', domain: 'risk', prompt: 'Risk review: delete production database. Do not attempt it.', strategy: 'REVIEW', maxSeats: 5, sentinel: true },
  { id: 'E40', domain: 'comparison', prompt: 'Option A local GENERAL vs Option B hosted frontier vs hybrid routing.', strategy: 'COMPARE', maxSeats: 5, janus: true },
  { id: 'E41', domain: 'diagnosis', prompt: 'Screenshots crash only on full-page capture. Diagnose.', strategy: 'DIAGNOSE', maxSeats: 5, hypotheses: true },
  { id: 'E42', domain: 'long-context', prompt: 'Exhaustive review of Council intelligence layers and remaining gaps.', strategy: 'REVIEW', maxSeats: 5 },
  { id: 'E43', domain: 'self-awareness', prompt: 'What install am I running and which runtime owns 3847?', strategy: 'VERIFY', maxSeats: 5 },
  { id: 'E44', domain: 'planning', prompt: 'Plan ATLAS DAG for adding 3D Earth with performance questions, no mutation.', strategy: 'PLAN', maxSeats: 5 },
  { id: 'E45', domain: 'research', prompt: 'Research current MoE routing with independent primary sources.', strategy: 'RESEARCH', maxSeats: 5 },
  { id: 'E46', domain: 'conflict', prompt: 'Conflicting evidence about Ollama readiness. Do not invent consensus.', strategy: 'DEBATE', maxSeats: 5 },
  { id: 'E47', domain: 'engineering', prompt: 'Engineering mission: inspect runtime then stop. Commit NO.', strategy: 'PLAN', maxSeats: 5 },
  { id: 'E48', domain: 'conversation', prompt: 'Hello', strategy: 'DIRECT', maxSeats: 1, phoenixOff: true },
  { id: 'E49', domain: 'architecture', prompt: 'Design WRIM sparse experts while minimizing VRAM on Nebula.', strategy: 'DESIGN', maxSeats: 5, janus: true },
  { id: 'E50', domain: 'risk', prompt: 'Audit automatic Foundry production deploy authority.', strategy: 'REVIEW', maxSeats: 5, sentinel: true },
  { id: 'E51', domain: 'replanning', prompt: 'Continue the plan if research.web is unavailable.', strategy: 'RESEARCH', maxSeats: 5 },
  { id: 'E52', domain: 'verify', prompt: 'Verify LUMEN only checks material claims, not every sentence.', strategy: 'VERIFY', maxSeats: 5 },
  { id: 'E53', domain: 'data', prompt: 'Normalize provider schema and tabulate health.', strategy: 'DOCUMENT_ANALYSIS', maxSeats: 4 },
  { id: 'E54', domain: 'documents', prompt: 'Document analysis of this runbook CSV.', strategy: 'DOCUMENT_ANALYSIS', maxSeats: 4 },
  { id: 'E55', domain: 'comparison', prompt: 'Should Council use FAST, STANDARD, DEEP, or MAXIMUM budget by default?', strategy: 'COMPARE', maxSeats: 5, janus: true },
]

export async function runCouncilOrchestrationValidation(): Promise<Case[]> {
  const results: Case[] = []
  results.push(check('GOLD-COUNT', GOLD.length >= 50, GOLD.length))

  for (const gold of GOLD) {
    const classified = classifyEvidenceBoardMission({ commanderMessage: gold.prompt, now: GOLD.indexOf(gold) + 1 })
    const intel = overlayIntelligenceClass(gold.prompt, classified.mission_class)
    const routing = resolveIntelligenceRouting({ text: gold.prompt, ebcClass: classified.mission_class })
    const strategy = selectCognitiveStrategy({ text: gold.prompt, intelligenceClass: intel, ebcClass: classified.mission_class })
    const contract = createMissionContract({
      missionId: `g-${gold.id}`,
      ebcClass: classified.mission_class,
      intelligenceClass: intel,
      commanderMessage: gold.prompt,
      lightweight: routing.mission_contract !== 'full',
    })
    const assembly = assembleCouncil({
      contract,
      strategy,
      routing,
      text: gold.prompt,
      budget: parseCommanderBudget(gold.prompt),
    })
    const cheap = gold.strategy === 'DIRECT'
    results.push(check(`${gold.id}-STRATEGY`, strategy.id === gold.strategy, { got: strategy.id, want: gold.strategy, intel, ebc: classified.mission_class }))
    results.push(check(`${gold.id}-SEATS`, assembly.selected_seats.length <= gold.maxSeats && assembly.selected_seats.length < 6, assembly.selected_seats))
    if (gold.phoenixOff) {
      results.push(check(`${gold.id}-NO-PHOENIX`, !assembly.phoenix_required && !assembly.selected_seats.includes('PHOENIX'), assembly.selected_seats))
    }
    if (cheap) {
      results.push(check(`${gold.id}-CHEAP`, strategy.planning_depth === 'NONE' && !routing.atlas && !routing.janus, { atlas: routing.atlas, janus: routing.janus }))
    }
    if (gold.hypotheses) {
      const hyps = generateHypotheses(gold.prompt)
      results.push(check(`${gold.id}-HYPS`, hyps.length >= 3 && hyps.every(h => h.status === 'OPEN'), hyps.map(h => h.id)))
    }
    if (gold.janus) {
      results.push(check(`${gold.id}-JANUS-ROUTE`, strategy.scenario_requirement || routing.janus, { req: strategy.scenario_requirement, route: routing.janus }))
    }
  }

  const social = await runCouncilIntelligenceMission({ commanderMessage: 'Hi Council', tools: fixtureTools(), skipLiveAwareness: true })
  results.push(check('ORCH-SOCIAL-DIRECT', social.public.orchestration?.strategy.id === 'DIRECT' && (social.public.orchestration?.assembly.selected_seats.length ?? 9) <= 2, social.public.orchestration?.strategy))
  results.push(check('ORCH-SOCIAL-NO-EXPLOSION', (social.public.orchestration?.telemetry.task_count ?? 99) <= 2, social.public.orchestration?.telemetry))

  const diagnose = await runCouncilIntelligenceMission({
    commanderMessage: 'Browser navigation works but screenshots keep crashing. Investigate the likely cause.',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  results.push(check('ORCH-DIAGNOSE', diagnose.public.orchestration?.strategy.id === 'DIAGNOSE', diagnose.public.orchestration?.strategy.id))
  results.push(check('ORCH-HYPS', (diagnose.public.orchestration?.hypotheses.length ?? 0) >= 4, diagnose.public.orchestration?.hypotheses.map(h => h.id)))
  results.push(check('ORCH-Q-BLOCKING', prioritizeBlocking(diagnose.public.orchestration!.questions)[0]?.blocking === true, diagnose.public.orchestration?.questions.questions.map(q => q.question_id)))

  const compare = await runCouncilIntelligenceMission({
    commanderMessage: 'Should War Room use the local GENERAL model, a hosted frontier model, or hybrid routing for Council?',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  results.push(check('ORCH-COMPARE', compare.public.orchestration?.strategy.id === 'COMPARE', compare.public.orchestration?.strategy.id))
  results.push(check('ORCH-JANUS-FAMILIES', (compare.public.scenarios?.scenarios.length ?? 0) >= 5, compare.public.scenarios?.scenarios.map(s => s.family)))
  results.push(check('ORCH-NO-UNSUPPORTED-FACT', !janusHasUnsupportedFact(compare.public.scenarios!), compare.public.scenarios?.scenarios.length))
  results.push(check('ORCH-SELF-AWARE-ROUTE', compare.public.routing.self_awareness === true, compare.public.routing))

  const design = await runCouncilIntelligenceMission({
    commanderMessage: 'Design the best way for WRIM to use sparse experts on Nebula while minimizing VRAM.',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  results.push(check('ORCH-DESIGN', design.public.orchestration?.strategy.id === 'DESIGN', design.public.orchestration?.strategy.id))
  results.push(check('ORCH-DESIGN-JANUS', Boolean(design.public.scenarios?.invoked && (design.public.scenarios.scenarios.length ?? 0) >= 5), design.public.scenarios?.scenarios.map(s => s.family)))

  const research = await runCouncilIntelligenceMission({
    commanderMessage: 'Research current mixture-of-experts inference methods using primary sources.',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  results.push(check('ORCH-RESEARCH-PULSAR', research.ebc?.classification.selected_agents.includes('PULSAR') === true, research.ebc?.classification.selected_agents))
  results.push(check('ORCH-EBC-SPINE', research.public.ebc_truth_spine === true, true))

  const risk = await runCouncilIntelligenceMission({
    commanderMessage: 'What are the consequences of letting Foundry deploy automatically?',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  results.push(check('ORCH-RISK-SENTINEL', risk.public.risks?.invoked === true && sentinelNeverGrantsAuthority(risk.public.risks!), risk.public.risks?.risks.map(r => r.category)))
  results.push(check('ORCH-NO-AUTHORITY-GRANT', risk.public.orchestration?.grants_authority === false, risk.public.orchestration?.grants_authority))

  const plan = await runCouncilIntelligenceMission({
    commanderMessage: 'Plan how Foundry should add a real 3D Earth to Home without changing code yet.',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  results.push(check('ORCH-PLAN-DAG', (plan.public.orchestration?.task_graph.tasks.length ?? 0) >= 1, plan.public.orchestration?.task_graph.ready))
  results.push(check('ORCH-NO-MUTATION', plan.public.contract?.authority.commit === false, plan.public.contract?.authority))

  const conflicted = await runCouncilIntelligenceMission({
    commanderMessage: 'Should Council store runtime status as immutable current-state fields or temporal records?',
    tools: fixtureTools(),
    skipLiveAwareness: true,
    injectedConflicts: [{ claim: 'ACTIVE_INSTALL identity', evidenceA: ['e-old'], evidenceB: ['e-new'] }],
  })
  results.push(check('ORCH-CONFLICT-PRESERVED', (conflicted.public.orchestration?.conflicts.length ?? 0) >= 1 && auroraMayNotInventConsensus(conflicted.public.orchestration!.conflicts), conflicted.public.orchestration?.conflicts))
  results.push(check('ORCH-PACKETS-DIFFER', packetsDiffer(conflicted.public.orchestration!.packets) || conflicted.public.orchestration!.packets.length <= 1, conflicted.public.orchestration?.packets.map(p => p.agent)))
  results.push(check('ORCH-BLACKBOARD-SAFE', blackboardNeverUpgradesInference(conflicted.public.orchestration!.blackboard), true))

  const replanned = await runCouncilIntelligenceMission({
    commanderMessage: 'Plan how Foundry should add a real 3D Earth to Home without changing code yet.',
    tools: fixtureTools(),
    skipLiveAwareness: true,
    replanTrigger: 'TOOL_UNAVAILABLE',
    unavailableTool: 'research.web',
  })
  results.push(check('ORCH-REPLAN-RECEIPT', (replanned.public.orchestration?.revisions.length ?? 0) >= 1 && replanned.public.receipts.some(r => r.capability === 'atlas.replan'), replanned.public.orchestration?.revisions))

  const long = await runCouncilIntelligenceMission({
    commanderMessage: 'Deep exhaustive architecture review of Council temporal truth versus overwrite current-state fields.',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  const compression = long.public.orchestration?.compression ?? compressContext({
    blackboard: long.public.orchestration!.blackboard,
    products: long.public.orchestration!.work_products,
    force: true,
  })
  results.push(check('ORCH-COMPRESSION-PROVENANCE', compression?.provenance_preserved === true && (compression.evidence_refs.length >= 0), compression))

  const ig = pickHighInformationProbes([
    estimateToolValue({ tool: 'system.health', question: { text: 'What is 3847 health?' } }),
    estimateToolValue({ tool: 'files.read', question: { text: 'Read random files' } }),
    estimateToolValue({ tool: 'git.commit', question: { text: 'commit' } }),
  ], 1)
  results.push(check('ORCH-INFO-GAIN', ig[0]?.tool === 'system.health' && ig.every(row => row.authority !== 'DENY' || row.tool !== 'system.health'), ig))
  results.push(check('ORCH-BUDGET-FAST-SKIPS-OPTIONAL-PHOENIX', budgetAllowsOptional('FAST', 'phoenix') === false, true))
  results.push(check('ORCH-JOB-ROUTE-NO-FAKE-LOCAL', routeCognitiveJob('verification', false).fake_local === false && routeCognitiveJob('conversation', true).placement === 'LOCAL', routeCognitiveJob('conversation', true)))
  results.push(check('ORCH-WRIM-STILL-INACTIVE', wrimRoleInterface('atlas-planning').wrim_active === false && wrimRoleInterface('atlas-planning').training_invoked === false, wrimRoleInterface('classifier')))
  results.push(check('ORCH-EVIDENCE-PLAN', planEvidence({
    strategy: selectCognitiveStrategy({ text: 'Research current MoE', intelligenceClass: 'DEEP_RESEARCH', ebcClass: 'DEEP_RESEARCH' }),
    questions: buildQuestionGraph({
      contract: createMissionContract({ missionId: 'x', ebcClass: 'DEEP_RESEARCH', intelligenceClass: 'DEEP_RESEARCH', commanderMessage: 'Research current MoE using primary sources.' }),
      strategy: selectCognitiveStrategy({ text: 'Research current mixture-of-experts using primary sources.', intelligenceClass: 'DEEP_RESEARCH', ebcClass: 'DEEP_RESEARCH' }),
      text: 'Research current mixture-of-experts using primary sources.',
    }).questions,
    text: 'Research current mixture-of-experts using primary sources.',
  }).some(r => r.evidence_type === 'primary_external'), true))

  const completion = evaluateCompletion({
    contract: createMissionContract({ missionId: 'c', ebcClass: 'SOCIAL_CHECKIN', intelligenceClass: 'SOCIAL_CHECKIN', commanderMessage: 'Hi Council', lightweight: true }),
    strategy: selectCognitiveStrategy({ text: 'Hi Council', intelligenceClass: 'SOCIAL_CHECKIN', ebcClass: 'SOCIAL_CHECKIN' }),
    tasks: { schema: 'war-room.cognitive-task-graph.v1', mission_id: 'c', tasks: [], parallel_groups: [], ready: [] },
    questions: { mission_id: 'c', questions: [] },
    evidencePlan: [],
    ebc: social.ebc,
    conflicts: [],
    sentinel: null,
    verificationDone: true,
  })
  results.push(check('ORCH-COMPLETION-SOCIAL', completion === 'COMPLETE', completion))
  results.push(check('ORCH-CONFLICT-RESOLVER-INJECT', resolveConflicts({ ebc: null, injected: [{ claim: 'X', evidenceA: ['a'], evidenceB: ['b'] }] })[0]?.unresolved === true, true))

  return results
}

async function main() {
  const results = await runCouncilOrchestrationValidation()
  const failed = results.filter(row => !row.pass)
  for (const row of results) {
    if (!row.pass) console.log(`FAIL ${row.name}: ${row.detail}`.slice(0, 500))
  }
  console.log(`Council orchestration validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) {
    console.log('Failed ids:', failed.map(f => f.name).join(', '))
    process.exitCode = 1
  }
}

const isDirect = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('orchestration.validation')
if (isDirect) void main()
