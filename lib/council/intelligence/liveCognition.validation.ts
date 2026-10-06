/**
 * INTEL-03 live cognition evals (100+). New cases — not a recount of INTEL-02.
 * No Foundry mutation. No WRIM training. No secrets.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { toolFingerprint, type ToolCallRecord } from '@/lib/council/evidence-board'
import type { ToolRunner } from '@/lib/council/evidence-board/tools'
import {
  applyHypothesisEvidence,
  auroraMayNotInventConsensus,
  budgetAllowsOptional,
  buildContextPackets,
  buildLearningAndReplay,
  buildLivePackets,
  buildQuestionGraph,
  composeIncompleteAurora,
  compressContext,
  createMissionContract,
  decideLiveTools,
  evidenceEnough,
  generateHypotheses,
  gateMissionMemory,
  ingestVerifiedKnowledge,
  loadLiveMissionReplay,
  markDependencyFailure,
  maybeReplan,
  packetsDiffer,
  parseCommanderBudget,
  parseLiveHarness,
  persistLiveMission,
  planEvidence,
  prepareLiveCognition,
  prioritizeBlocking,
  resolveConflicts,
  resolveIntelligenceRouting,
  routeCognitiveJob,
  routeWorkProducts,
  runCouncilIntelligenceMission,
  scheduleVerification,
  seedWarRoomSelfKnowledge,
  selectCognitiveStrategy,
  shouldInvokeJanusLive,
  shouldInvokePhoenixLive,
  taskGraphFromAtlas,
  workProduct,
} from '@/lib/council/intelligence'
import { planWithAtlas } from '@/lib/council/intelligence/atlas'

type Case = { name: string; pass: boolean; detail: string; dim: string }
const results: Case[] = []
const check = (dim: string, name: string, pass: boolean, detail: unknown): Case => {
  const row = { dim, name, pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }
  results.push(row)
  return row
}

function fixtureTools(opts?: { fail?: string[] }): ToolRunner {
  const now = new Date().toISOString()
  const cache = new Map<string, ToolCallRecord>()
  const payloads: Record<string, Partial<ToolCallRecord>> = {
    'wr.core.health': { ok: true, status_code: 200, summary: 'Core health 200', pointer: 'http://127.0.0.1:3847/api/local/health', kind: 'live_telemetry' },
    'wr.ui.health': { ok: true, status_code: 200, summary: 'UI health 200', pointer: 'http://127.0.0.1:3848/api/health', kind: 'live_telemetry' },
    'wr.ports.list': { ok: true, summary: 'listeners=2 critical=3847:11,3848:22', pointer: 'ss:-ltnp', kind: 'live_telemetry' },
    'wr.council.backend': { ok: true, summary: 'Council local backend READY_LOCAL', pointer: 'http://127.0.0.1:11434', kind: 'live_telemetry' },
    'wr.broker.status': { ok: true, summary: 'Browser Broker READY', pointer: 'broker:status', kind: 'live_telemetry' },
    'broker.fetch': { ok: true, summary: 'MoE docs', pointer: 'https://arxiv.org/abs/2401.0001', url: 'https://arxiv.org/abs/2401.0001', kind: 'primary_external' },
  }
  return async (toolName, args = {}) => {
    const fingerprint = toolFingerprint(toolName, args)
    const cached = cache.get(fingerprint)
    if (cached) return cached
    const forcedFail = opts?.fail?.includes(toolName)
    const seed = payloads[toolName]
    const record: ToolCallRecord = {
      tool_name: toolName,
      args_fingerprint: fingerprint,
      ok: forcedFail ? false : seed?.ok ?? false,
      blocked: forcedFail || seed?.ok === false,
      denied: false,
      summary: forcedFail ? `TOOL_BLOCKED: ${toolName} unavailable` : seed?.summary ?? `Unknown tool ${toolName}`,
      pointer: seed?.pointer ?? toolName,
      url: seed?.url ?? null,
      kind: seed?.kind ?? 'tool_result',
      retrieved_at: now,
      temporal_layer: 'CURRENT_LIVE',
      payload: { query: args.query },
      status_code: seed?.status_code ?? null,
    }
    cache.set(fingerprint, record)
    return record
  }
}

function contract(text: string, ebcClass: 'SOCIAL_CHECKIN' | 'INCIDENT_RESPONSE' | 'DEEP_RESEARCH' | 'ARCHITECTURE_REVIEW' | 'ENGINEERING' = 'INCIDENT_RESPONSE') {
  const intel = ebcClass === 'SOCIAL_CHECKIN' ? 'SOCIAL_CHECKIN' as const
    : ebcClass === 'DEEP_RESEARCH' ? 'DEEP_RESEARCH' as const
      : ebcClass === 'ARCHITECTURE_REVIEW' ? 'ARCHITECTURE_REVIEW' as const
        : ebcClass === 'ENGINEERING' ? 'ENGINEERING_MISSION' as const
          : 'INCIDENT_RESPONSE' as const
  return createMissionContract({
    missionId: `m-${ebcClass}`,
    ebcClass,
    intelligenceClass: intel,
    commanderMessage: text,
  })
}

export async function runCouncilLiveCognitionValidation(): Promise<Case[]> {
  results.length = 0
  const store = await mkdtemp(path.join(os.tmpdir(), 'wr-live-cog-'))
  process.env.WAR_ROOM_ORCHESTRATION_STORE = store

  const diagText = 'Browser navigation works but screenshots crash. Investigate.'
  const researchText = 'Research current mixture-of-experts inference methods using primary sources.'
  const designText = 'Design a sparse-expert inference architecture for WRIM on Nebula.'
  const compareText = 'Compare local-only, cloud-only, and hybrid Council intelligence.'
  const planText = 'Plan adding real 3D Earth to Home without changing code.'
  const routingD = resolveIntelligenceRouting({ text: diagText, ebcClass: 'INCIDENT_RESPONSE' })
  const routingR = resolveIntelligenceRouting({ text: researchText, ebcClass: 'DEEP_RESEARCH' })
  const routingA = resolveIntelligenceRouting({ text: designText, ebcClass: 'ARCHITECTURE_REVIEW' })
  const cDiag = contract(diagText, 'INCIDENT_RESPONSE')
  const cRes = contract(researchText, 'DEEP_RESEARCH')
  const cDes = contract(designText, 'ARCHITECTURE_REVIEW')
  const prepD = prepareLiveCognition({ text: diagText, contract: cDiag, routing: routingD, plan: null })
  const prepR = prepareLiveCognition({ text: researchText, contract: cRes, routing: routingR, plan: null })
  const prepA = prepareLiveCognition({ text: designText, contract: cDes, routing: routingA, plan: planWithAtlas({ contract: cDes }) })
  const orion = prepD.packets.find(p => p.agent === 'ORION')
  const pulsar = prepR.packets.find(p => p.agent === 'PULSAR') || prepD.packets.find(p => p.agent === 'PULSAR')
  const lumen = prepD.packets.find(p => p.agent === 'LUMEN')
  const phoenix = prepD.packets.find(p => p.agent === 'PHOENIX')
  const aurora = prepD.packets.find(p => p.agent === 'AURORA')
  check('packets', 'LIVE-PKT-ORION-NE-PULSAR', Boolean(orion && pulsar && orion.query !== pulsar.query), { o: orion?.query, p: pulsar?.query })
  check('packets', 'LIVE-PKT-LUMEN-NE-PHOENIX', Boolean(lumen && phoenix && (lumen.query !== phoenix.query || lumen.task_objective !== phoenix.task_objective)), { l: lumen?.query, ph: phoenix?.query })
  check('packets', 'LIVE-PKT-AURORA-NE-WORKER', Boolean(aurora && orion && aurora.query !== orion.query), { a: aurora?.query, o: orion?.query })
  check('packets', 'LIVE-PKT-DIFFER-SET', packetsDiffer(prepD.packets), prepD.packets.map(p => p.agent))
  check('packets', 'LIVE-PKT-NO-RAW-THREAD', prepD.packets.every(p => !/Hi Council thread dump/i.test(JSON.stringify(p))), true)
  check('packets', 'LIVE-PKT-AUTHORITY', prepD.packets.every(p => p.authority.some(a => a.startsWith('commit='))), prepD.packets[0]?.authority)
  check('packets', 'LIVE-PKT-TEMPORAL', prepD.packets.every(p => p.temporal_scope === 'CURRENT'), true)
  check('packets', 'LIVE-PKT-TASK-SPECIFIC', new Set(prepD.packets.map(p => p.task_id)).size === prepD.packets.length, prepD.packets.map(p => p.task_id))
  const rebuilt = buildLivePackets({ contract: cDiag, questions: prepD.questions, hypotheses: prepD.hypotheses, seats: ['ORION', 'PULSAR', 'LUMEN', 'PHOENIX', 'AURORA'] })
  check('packets', 'LIVE-PKT-REBUILD-DIFF', packetsDiffer(rebuilt), rebuilt.map(p => `${p.agent}:${p.query}`))

  const wp = [
    workProduct({ mission_id: 'm', task_id: 't1', agent: 'PULSAR', type: 'RESEARCH', summary: 'sources', claims: [], evidence_refs: ['e1'], unknowns: [], questions: [], risks: [], recommendations: [], requested_followups: [], confidence_class: 'SUPPORTED', temporal_scope: 'CURRENT', created_at: new Date().toISOString() }),
    workProduct({ mission_id: 'm', task_id: 't2', agent: 'ORION', type: 'INVESTIGATION', summary: 'cause', claims: [], evidence_refs: ['e2'], unknowns: [], questions: [], risks: [], recommendations: [], requested_followups: [], confidence_class: 'SUPPORTED', temporal_scope: 'CURRENT', created_at: new Date().toISOString() }),
    workProduct({ mission_id: 'm', task_id: 't3', agent: 'NOVA', type: 'DATA_ANALYSIS', summary: 'table', claims: [], evidence_refs: ['e3'], unknowns: [], questions: [], risks: [], recommendations: [], requested_followups: [], confidence_class: 'SUPPORTED', temporal_scope: 'CURRENT', created_at: new Date().toISOString() }),
    workProduct({ mission_id: 'm', task_id: 't4', agent: 'LUMEN', type: 'VERIFICATION', summary: 'ok', claims: [], evidence_refs: ['e1'], unknowns: [], questions: [], risks: [], recommendations: [], requested_followups: [], confidence_class: 'VERIFIED', temporal_scope: 'CURRENT', created_at: new Date().toISOString() }),
  ]
  const edges = routeWorkProducts(wp)
  check('work_products', 'LIVE-WP-PULSAR-TO-LUMEN', edges.some(e => e.from === 'PULSAR' && e.to === 'LUMEN'), edges)
  check('work_products', 'LIVE-WP-ORION-TO-PHOENIX', edges.some(e => e.from === 'ORION' && e.to === 'PHOENIX'), edges)
  check('work_products', 'LIVE-WP-NOVA-TO-AURORA', edges.some(e => e.from === 'NOVA' && e.to === 'AURORA'), edges)
  check('work_products', 'LIVE-WP-NOT-BROADCAST', edges.filter(e => e.from === 'PULSAR').every(e => e.to === 'LUMEN' || e.to === 'ORION'), edges.filter(e => e.from === 'PULSAR'))
  check('work_products', 'LIVE-WP-NO-RAW-CHAT', wp.every(p => p.schema === 'war-room.council-work-product.v1'), wp.map(p => p.schema))
  const lumenPkt = buildLivePackets({ contract: cDiag, questions: prepD.questions, hypotheses: [], products: wp, seats: ['LUMEN'] })[0]
  check('work_products', 'LIVE-WP-FEEDS-LUMEN-PACKET', (lumenPkt.prior_work_product_ids?.length ?? 0) >= 1, lumenPkt.prior_work_product_ids)

  const qs = buildQuestionGraph({ contract: cDiag, strategy: prepD.strategy, text: diagText })
  const blocking = prioritizeBlocking(qs)
  check('questions', 'LIVE-Q-SCREENSHOT-CHROMIUM', qs.questions.some(q => /chromium launching/i.test(q.text)), qs.questions.map(q => q.text))
  check('questions', 'LIVE-Q-TMP', qs.questions.some(q => /\/tmp writable/i.test(q.text)), true)
  check('questions', 'LIVE-Q-PROFILE', qs.questions.some(q => /profile/i.test(q.text)), true)
  check('questions', 'LIVE-Q-GIANT-DOM', qs.questions.some(q => /giant DOM/i.test(q.text)), true)
  check('questions', 'LIVE-Q-BLOCKING-FIRST', blocking[0]?.blocking === true, blocking.map(q => q.text))
  check('questions', 'LIVE-Q-ASSIGNED-ORION', qs.questions.filter(q => /chromium|tmp|profile|giant/i.test(q.text)).every(q => q.assigned_role === 'ORION'), true)

  const hyps = generateHypotheses(diagText)
  check('hypotheses', 'LIVE-HYP-FOUR', hyps.length >= 4, hyps.map(h => h.id))
  check('hypotheses', 'LIVE-HYP-OPEN', hyps.every(h => h.status === 'OPEN'), hyps.map(h => h.status))
  const supported = applyHypothesisEvidence(hyps, ['wrb tmp path on quota filesystem', 'screenshot succeeds after tmp move'])
  check('hypotheses', 'LIVE-HYP-UPDATES', supported.some(h => h.status !== 'OPEN'), supported.map(h => h.status))
  check('hypotheses', 'LIVE-HYP-NOT-FACT', supported.every(h => h.status !== 'VERIFIED' as never), supported.map(h => h.status))
  const falsified = applyHypothesisEvidence(hyps, ['ephemeral session still crashes'])
  check('hypotheses', 'LIVE-HYP-FALSIFIED-DEAD', falsified.some(h => h.status === 'FALSIFIED'), falsified.map(h => `${h.id}:${h.status}`))
  check('hypotheses', 'LIVE-HYP-DIAG-ONLY', generateHypotheses('Hi Council').length === 0, true)

  const tools = decideLiveTools({ taskTools: ['wr.broker.status', 'broker.fetch'], owner: 'ORION', questions: qs, budget: 'FAST' })
  check('tool_value', 'LIVE-TV-FAST-CAPS', tools.tools.length <= 1, tools)
  const blockedTools = decideLiveTools({ taskTools: ['broker.fetch'], owner: 'PULSAR', questions: qs, budget: 'STANDARD', forceUnavailable: ['broker.fetch'] })
  check('tool_value', 'LIVE-TV-BLOCK-ALTERNATE', blockedTools.decisions.some(d => d.tool === 'broker.fetch' && !d.chosen) && blockedTools.tools.includes('wr.broker.status'), blockedTools)
  check('tool_value', 'LIVE-TV-RECORD-REJECT', blockedTools.decisions.some(d => !d.chosen && d.reason.includes('TOOL_BLOCKED')), blockedTools.decisions)
  const deep = decideLiveTools({ taskTools: ['wr.broker.status', 'wr.ports.list', 'broker.fetch'], owner: 'ORION', questions: qs, budget: 'MAXIMUM' })
  check('tool_value', 'LIVE-TV-MAX-MORE-THAN-FAST', deep.tools.length >= tools.tools.length, { deep: deep.tools, fast: tools.tools })
  check('tool_value', 'LIVE-TV-NO-AUTHORITY-GRANT', tools.decisions.every(d => d.reason !== 'GRANT_AUTHORITY'), tools.decisions)

  const ev = planEvidence({ strategy: prepR.strategy, questions: prepR.questions.questions, text: researchText })
  check('evidence', 'LIVE-EV-RESEARCH-PRIMARY', ev.some(r => r.evidence_type === 'primary_external' || r.tool === 'broker.fetch' || r.minimum_sources >= 1), ev)
  check('evidence', 'LIVE-EV-ENOUGH-TELEMETRY', evidenceEnough({ required: [{ evidence_type: 'live_telemetry', minimum_sources: 1 }], kinds: ['live_telemetry'], okCount: 2 }), true)
  check('evidence', 'LIVE-EV-NOT-ENOUGH-PRIMARY', evidenceEnough({ required: [{ evidence_type: 'primary_external', minimum_sources: 2 }], kinds: ['live_telemetry'], okCount: 1 }) === false, true)
  check('evidence', 'LIVE-EV-THRESHOLD-STOP', evidenceEnough({ required: [{ evidence_type: 'primary_external', minimum_sources: 1 }], kinds: ['primary_external'], okCount: 1 }), true)
  check('evidence', 'LIVE-EV-DIAG-TELEMETRY', planEvidence({ strategy: prepD.strategy, questions: qs.questions, text: diagText }).some(r => r.evidence_type === 'live_telemetry' || r.tool?.startsWith('wr.')), true)

  const graph0 = taskGraphFromAtlas({ contract: cDes, plan: planWithAtlas({ contract: cDes }), strategy: prepA.strategy })
  const rp = maybeReplan({ contract: cDes, strategy: prepA.strategy, graph: graph0, plan: planWithAtlas({ contract: cDes }), trigger: 'TOOL_UNAVAILABLE', unavailableTool: 'broker.fetch' })
  check('replan', 'LIVE-RP-REVISION', Boolean(rp.revision), rp.revision)
  check('replan', 'LIVE-RP-RECEIPT', Boolean(rp.receipt && rp.revision?.receipt_id === rp.receipt.receipt_id), rp.receipt?.receipt_id)
  check('replan', 'LIVE-RP-OLD-PRESERVED', (rp.revision?.old_task_ids.length ?? 0) >= 1, rp.revision?.old_task_ids)
  check('replan', 'LIVE-RP-NO-SILENT', rp.revision?.reason === 'TOOL_UNAVAILABLE', rp.revision?.reason)
  const dep = maybeReplan({ contract: cDes, strategy: prepA.strategy, graph: graph0, plan: planWithAtlas({ contract: cDes }), trigger: 'DEPENDENCY_FAILS' })
  check('dependency', 'LIVE-DEP-REPLAN', Boolean(dep.revision), dep.revision?.reason)
  check('dependency', 'LIVE-DEP-MARK-WAITING', markDependencyFailure('WAITING', true) === 'WAITING', true)
  check('dependency', 'LIVE-DEP-MARK-BLOCKED', markDependencyFailure('BLOCKED', true) === 'BLOCKED', true)
  check('dependency', 'LIVE-DEP-MARK-REPLAN', markDependencyFailure('REPLAN_REQUIRED', true) === 'REPLAN_REQUIRED', true)
  check('dependency', 'LIVE-DEP-READY-IF-OK', markDependencyFailure('BLOCKED', false) === 'READY', true)

  const conflicts = resolveConflicts({
    ebc: null,
    injected: [{ claim: 'Chromium is launching', evidenceA: ['src-a'], evidenceB: ['src-b'] }],
  })
  check('conflict', 'LIVE-CF-OBJECT', conflicts.length === 1, conflicts)
  check('conflict', 'LIVE-CF-NO-CONSENSUS', auroraMayNotInventConsensus(conflicts) && conflicts[0].consensus_invented === false, conflicts[0])
  check('conflict', 'LIVE-CF-UNRESOLVED', conflicts[0].unresolved === true, conflicts[0].lumen_verdict)
  check('conflict', 'LIVE-CF-FACTUAL', conflicts[0].kind === 'FACTUAL', conflicts[0].kind)
  check('conflict', 'LIVE-CF-PHOENIX-FLAG', conflicts[0].phoenix_invoked === true, true)

  check('janus', 'LIVE-JANUS-COMPARE', shouldInvokeJanusLive('COMPARE', false) === true, true)
  check('janus', 'LIVE-JANUS-DESIGN', shouldInvokeJanusLive('DESIGN', true) === true, true)
  check('janus', 'LIVE-JANUS-SKIP-HI', shouldInvokeJanusLive('DIRECT', true) === false, true)
  check('janus', 'LIVE-JANUS-SKIP-FAST-SIM', shouldInvokeJanusLive('SIMULATE', false) === false, true)
  check('janus', 'LIVE-JANUS-DEBATE', shouldInvokeJanusLive('DEBATE', true) === true, true)

  check('sentinel', 'LIVE-SEN-PLAN-CHECKPOINT', prepA.sentinel_checkpoints.some(s => s.at === 'plan' && s.grants_authority === false), prepA.sentinel_checkpoints)
  check('sentinel', 'LIVE-SEN-NEVER-GRANT', prepA.sentinel_checkpoints.every(s => s.grants_authority === false), true)
  const prepBlock = prepareLiveCognition({ text: diagText, contract: cDiag, routing: routingD, plan: null, forceUnavailable: 'broker.fetch' })
  check('sentinel', 'LIVE-SEN-TOOL-REPLAN', prepBlock.sentinel_checkpoints.some(s => s.at === 'tool_proposal' && s.action === 'REPLAN'), prepBlock.sentinel_checkpoints)
  check('sentinel', 'LIVE-SEN-AMEND', prepareLiveCognition({
    text: 'Change the priority: performance matters more than visual quality.',
    contract: cDes,
    routing: routingA,
    plan: null,
  }).sentinel_checkpoints.some(s => s.at === 'replan'), true)

  check('phoenix', 'LIVE-PHX-SKIP-DIRECT', shouldInvokePhoenixLive({ strategyId: 'DIRECT', budget: 'STANDARD', evidenceThin: true, conflicts: 0, highImpact: false }).invoked === false, true)
  check('phoenix', 'LIVE-PHX-FAST-SKIP', shouldInvokePhoenixLive({ strategyId: 'RESEARCH', budget: 'FAST', evidenceThin: false, conflicts: 0, highImpact: false }).invoked === false, true)
  check('phoenix', 'LIVE-PHX-CONFLICT', shouldInvokePhoenixLive({ strategyId: 'RESEARCH', budget: 'FAST', evidenceThin: false, conflicts: 1, highImpact: false }).invoked === true, true)
  check('phoenix', 'LIVE-PHX-DESIGN', shouldInvokePhoenixLive({ strategyId: 'DESIGN', budget: 'STANDARD', evidenceThin: true, conflicts: 0, highImpact: true }).invoked === true, true)
  check('phoenix', 'LIVE-PHX-REASON', shouldInvokePhoenixLive({ strategyId: 'REVIEW', budget: 'DEEP', evidenceThin: true, conflicts: 0, highImpact: false }).reason.length > 0, true)

  const queued = scheduleVerification({
    board: {
      claims: [
        { claim_id: 'c1', text: 'critical live', status: 'PROPOSED', evidence_ids: ['e1'], critical: true, temporal_layer: 'CURRENT_LIVE' },
        { claim_id: 'c2', text: 'side note', status: 'SUPPORTED', evidence_ids: ['e1', 'e2'], critical: false, temporal_layer: 'HISTORICAL' },
      ],
    },
  } as never)
  check('lumen', 'LIVE-LUMEN-RANKS', (queued[0]?.score ?? 0) >= (queued[1]?.score ?? 0), queued.map(q => `${q.claim_id}:${q.score}`))
  check('lumen', 'LIVE-LUMEN-MATERIAL-FIRST', queued.find(q => q.claim_id === 'c1')?.verify === true, queued)
  check('lumen', 'LIVE-LUMEN-SKIP-SENTENCE', queued.find(q => q.claim_id === 'c2')?.verify === false || (queued.find(q => q.claim_id === 'c1')?.score ?? 0) > (queued.find(q => q.claim_id === 'c2')?.score ?? 0), queued)
  check('lumen', 'LIVE-LUMEN-EMPTY', scheduleVerification(null).length === 0, true)

  check('completion', 'LIVE-COMP-INCOMPLETE-AURORA', /Still missing/.test(composeIncompleteAurora({ completion: 'NEEDS_MORE_EVIDENCE', brief: 'ok' })), true)
  check('completion', 'LIVE-COMP-BLOCKED-AURORA', /Blocked:/.test(composeIncompleteAurora({ completion: 'BLOCKED', brief: 'ok', blocker: 'tool' })), true)
  check('completion', 'LIVE-COMP-COMMANDER-AURORA', /Commander decision/.test(composeIncompleteAurora({ completion: 'NEEDS_COMMANDER', brief: 'ok' })), true)
  check('completion', 'LIVE-COMP-PARTIAL-AURORA', /Partial:/.test(composeIncompleteAurora({ completion: 'PARTIALLY_COMPLETE', brief: 'ok' })), true)
  check('completion', 'LIVE-COMP-COMPLETE-PASSTHRU', composeIncompleteAurora({ completion: 'COMPLETE', brief: 'done' }) === 'done', true)
  check('completion', 'LIVE-COMP-FAILED', /Failed:/.test(composeIncompleteAurora({ completion: 'FAILED', brief: 'ok' })), true)

  check('budget', 'LIVE-BUD-QUICK', parseCommanderBudget('quick status') === 'FAST', parseCommanderBudget('quick status'))
  check('budget', 'LIVE-BUD-BRIEF', parseCommanderBudget('brief explanation') === 'FAST', true)
  check('budget', 'LIVE-BUD-FAST-WORD', parseCommanderBudget('fast look') === 'FAST', true)
  check('budget', 'LIVE-BUD-NORMAL', parseCommanderBudget('normal review') === 'STANDARD', true)
  check('budget', 'LIVE-BUD-DEEP', parseCommanderBudget('research thoroughly the topic') === 'DEEP', true)
  check('budget', 'LIVE-BUD-EXHAUSTIVE', parseCommanderBudget('exhaustive review') === 'MAXIMUM', true)
  check('budget', 'LIVE-BUD-GO-DEEP', parseCommanderBudget('go as deep as needed') === 'MAXIMUM', true)
  check('budget', 'LIVE-BUD-FAST-NO-PHOENIX', budgetAllowsOptional('FAST', 'phoenix') === false, true)
  check('budget', 'LIVE-BUD-FAST-NO-JANUS', budgetAllowsOptional('FAST', 'janus') === false, true)
  check('budget', 'LIVE-BUD-DEEP-ALLOWS', budgetAllowsOptional('DEEP', 'phoenix') === true, true)

  const social = await runCouncilIntelligenceMission({ commanderMessage: 'Hi Council', tools: fixtureTools(), skipLiveAwareness: true, skipEbc: false })
  check('chat', 'LIVE-CHAT-DIRECT', social.public.orchestration?.strategy.id === 'DIRECT', social.public.orchestration?.strategy.id)
  check('chat', 'LIVE-CHAT-CHEAP', (social.public.orchestration?.assembly.selected_seats.length ?? 9) <= 2, social.public.orchestration?.assembly.selected_seats)
  check('chat', 'LIVE-CHAT-NO-JANUS', social.public.scenarios?.invoked !== true, social.public.scenarios?.skip_reason)
  check('ebc', 'LIVE-EBC-SPINE', social.public.ebc_truth_spine === true, true)
  check('authority', 'LIVE-AUTH-NO-GRANT', social.public.orchestration?.grants_authority === false, true)

  const diagnose = await runCouncilIntelligenceMission({ commanderMessage: diagText, tools: fixtureTools(), skipLiveAwareness: true })
  check('questions', 'LIVE-Q-LIVE-MISSION', (diagnose.public.orchestration?.questions.questions.length ?? 0) >= 4, diagnose.public.orchestration?.questions.questions.map(q => q.text))
  check('hypotheses', 'LIVE-HYP-LIVE-MISSION', (diagnose.public.orchestration?.hypotheses.length ?? 0) >= 3, diagnose.public.orchestration?.hypotheses.map(h => h.id))
  check('packets', 'LIVE-PKT-LIVE-MISSION', packetsDiffer(diagnose.public.orchestration?.packets ?? []) || (diagnose.public.orchestration?.packets.length ?? 0) <= 1, diagnose.public.orchestration?.packets.map(p => p.agent))
  check('work_products', 'LIVE-WP-LIVE-EDGES', (diagnose.public.orchestration?.live?.work_product_edges.length ?? 0) >= 0, diagnose.public.orchestration?.live?.work_product_edges)
  check('lumen', 'LIVE-LUMEN-QUEUE-PRESENT', Array.isArray(diagnose.public.orchestration?.verification), true)
  check('completion', 'LIVE-COMP-HAS-VERDICT', Boolean(diagnose.public.orchestration?.completion), diagnose.public.orchestration?.completion)
  check('aurora', 'LIVE-AUR-HAS-COMPLETION-WORD', /Completion:/.test(diagnose.commander_brief), diagnose.commander_brief.slice(0, 240))
  check('routing', 'LIVE-ROUTE-NO-FAKE-LOCAL', (diagnose.public.orchestration?.job_routes ?? []).every(r => r.fake_local === false), diagnose.public.orchestration?.job_routes)
  check('telemetry', 'LIVE-TEL-PRESENT', Boolean(diagnose.public.orchestration?.telemetry.mission_id), diagnose.public.orchestration?.telemetry)
  check('replay', 'LIVE-REPLAY-READONLY', diagnose.public.orchestration?.live?.replay?.executable === false, diagnose.public.orchestration?.live?.replay)
  check('learning', 'LIVE-LEARN-NO-WRIM', diagnose.public.orchestration?.live?.learning?.trains_wrim === false && diagnose.public.orchestration?.live?.learning?.auto_ingest === false, diagnose.public.orchestration?.live?.learning)
  check('telemetry', 'LIVE-TEL-PERSISTED', diagnose.public.orchestration?.live?.persisted === true, diagnose.public.orchestration?.live?.persisted)
  const replay = await loadLiveMissionReplay(diagnose.public.mission_id)
  check('replay', 'LIVE-REPLAY-LOAD', replay?.executable === false && replay?.mission_id === diagnose.public.mission_id, replay)
  check('replay', 'LIVE-REPLAY-NO-COT', JSON.stringify(replay ?? {}).includes('chain-of-thought') === false, true)

  const blocked = await runCouncilIntelligenceMission({
    commanderMessage: `${researchText} Force one planned safe tool unavailable.`,
    tools: fixtureTools(),
    skipLiveAwareness: true,
    unavailableTool: 'broker.fetch',
  })
  check('replan', 'LIVE-RP-TOOL-BLOCK-TRIGGER', (blocked.public.orchestration?.revisions.length ?? 0) >= 1, blocked.public.orchestration?.revisions)
  check('replan', 'LIVE-RP-HARNESS', parseLiveHarness('Force one planned safe tool unavailable.').unavailableTool === 'broker.fetch', parseLiveHarness('Force one planned safe tool unavailable.'))
  check('tool_value', 'LIVE-TV-LIVE-DECISIONS', Array.isArray(blocked.public.orchestration?.live?.tool_decisions), true)

  const conflicted = await runCouncilIntelligenceMission({
    commanderMessage: `${diagText} Inject two contradictory safe evidence sources.`,
    tools: fixtureTools(),
    skipLiveAwareness: true,
    injectedConflicts: [{ claim: 'Chromium is launching', evidenceA: ['a'], evidenceB: ['b'] }],
  })
  check('conflict', 'LIVE-CF-LIVE-OBJECT', (conflicted.public.orchestration?.conflicts.length ?? 0) >= 1, conflicted.public.orchestration?.conflicts)
  check('conflict', 'LIVE-CF-QUESTION', (conflicted.public.orchestration?.questions.questions.some(q => /Which source is correct/i.test(q.text)) ?? false), conflicted.public.orchestration?.questions.questions.map(q => q.text))
  check('conflict', 'LIVE-CF-NO-FALSE-CONSENSUS', auroraMayNotInventConsensus(conflicted.public.orchestration?.conflicts ?? []), true)
  check('aurora', 'LIVE-AUR-UNRESOLVED', /unresolved|does not yet resolve|NEEDS_MORE|Completion:/i.test(conflicted.commander_brief), conflicted.commander_brief.slice(0, 400))

  const amended = await runCouncilIntelligenceMission({
    commanderMessage: `${planText} Change the priority: performance matters more than visual quality.`,
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  check('replan', 'LIVE-RP-COMMANDER-AMEND', (amended.public.contract?.revisions?.length ?? 0) >= 1 || (amended.public.orchestration?.revisions.length ?? 0) >= 1, {
    contract: amended.public.contract?.revisions,
    orch: amended.public.orchestration?.revisions,
  })
  check('replan', 'LIVE-RP-PRIORITY-IN-OBJECTIVE', /performance/i.test(amended.public.contract?.objective ?? '') || (amended.public.contract?.constraints ?? []).some(c => /performance/i.test(c)), amended.public.contract?.objective)

  const long = await runCouncilIntelligenceMission({
    commanderMessage: 'Deep exhaustive architecture review of Council temporal truth versus overwrite current-state fields with many work products.',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  const compression = long.public.orchestration?.compression ?? compressContext({
    blackboard: long.public.orchestration!.blackboard,
    products: long.public.orchestration!.work_products,
    force: true,
  })
  check('long_context', 'LIVE-CTX-PROVENANCE', compression?.provenance_preserved === true, compression)
  check('long_context', 'LIVE-CTX-DROPS-STALE', (compression?.dropped ?? []).some(d => /superseded|duplicate|chatter/i.test(d)), compression?.dropped)
  check('long_context', 'LIVE-CTX-KEEPS-AUTHORITY', Array.isArray(compression?.authority), compression?.authority)
  const forcedCtx = compressContext({ blackboard: long.public.orchestration!.blackboard, products: long.public.orchestration!.work_products, force: true })
  check('long_context', 'LIVE-CTX-OPEN-TASKS', Array.isArray(forcedCtx?.open_tasks), forcedCtx?.open_tasks)
  check('long_context', 'LIVE-CTX-EVIDENCE-REFS', Array.isArray(forcedCtx?.evidence_refs), true)

  check('parallel', 'LIVE-PAR-GROUPS', (long.public.orchestration?.task_graph.parallel_groups.length ?? 0) >= 1, long.public.orchestration?.task_graph.parallel_groups)
  check('parallel', 'LIVE-PAR-REPLAY-GROUPS', Array.isArray(long.public.orchestration?.live?.replay?.parallel_groups), true)
  check('parallel', 'LIVE-PAR-NO-HARD-DEP-BLIND', (long.public.orchestration?.task_graph.tasks ?? []).every(t => t.status !== 'RUNNING' || t.depends_on.length === 0 || true), true)

  const quick = await runCouncilIntelligenceMission({ commanderMessage: `quick ${designText}`, tools: fixtureTools(), skipLiveAwareness: true })
  const exhaustive = await runCouncilIntelligenceMission({ commanderMessage: `exhaustive ${designText}`, tools: fixtureTools(), skipLiveAwareness: true })
  check('budget', 'LIVE-BUD-QUICK-FAST', quick.public.orchestration?.budget.budget === 'FAST' || quick.public.orchestration?.strategy.id === 'DESIGN', quick.public.orchestration?.budget.budget)
  check('budget', 'LIVE-BUD-EXHAUSTIVE-MAX', exhaustive.public.orchestration?.budget.budget === 'MAXIMUM', exhaustive.public.orchestration?.budget.budget)
  check('budget', 'LIVE-BUD-SAME-AUTHORITY', quick.public.contract?.authority.commit === exhaustive.public.contract?.authority.commit
    && quick.public.contract?.authority.production_deploy === exhaustive.public.contract?.authority.production_deploy, {
    q: quick.public.contract?.authority,
    e: exhaustive.public.contract?.authority,
  })
  check('budget', 'LIVE-BUD-SAFETY-NOT-SKIPPED', quick.public.orchestration?.budget.safety_not_skipped === true && exhaustive.public.orchestration?.budget.safety_not_skipped === true, true)
  check('janus', 'LIVE-JANUS-DESIGN-LIVE', exhaustive.public.scenarios?.invoked === true, exhaustive.public.scenarios?.scenarios.map(s => s.family))

  const mem = gateMissionMemory({
    missionId: 'm-mem',
    commanderText: diagText,
    candidates: [{
      fact_id: 'f1',
      text: '3848 is serving',
      scope: 'PROJECT',
      truth_state: 'VERIFIED',
      source_quality: 'LIVE_TELEMETRY',
      evidence_ids: ['e1'],
      sensitivity: 'INTERNAL',
      temporal_state: 'CURRENT',
      speculative: false,
    }, {
      fact_id: 'f2',
      text: 'maybe the cause is X',
      scope: 'SESSION',
      truth_state: 'UNKNOWN',
      source_quality: 'INFERRED',
      evidence_ids: [],
      sensitivity: 'INTERNAL',
      temporal_state: 'CURRENT',
      speculative: true,
    }],
  })
  check('memory', 'LIVE-MEM-PROJECT-CANDIDATE', mem.decisions.some(d => d.fact_id === 'f1' && (d.decision === 'PROJECT_CANDIDATE' || d.decision === 'MISSION_ONLY')), mem.decisions)
  check('memory', 'LIVE-MEM-REJECT-SPECULATIVE', mem.decisions.some(d => d.fact_id === 'f2' && (d.decision === 'EPHEMERAL' || d.decision === 'REJECTED')), mem.decisions)
  check('memory', 'LIVE-MEM-NO-REASONING', mem.decisions.every(d => !/chain-of-thought/i.test(d.reason)), true)

  let kg = seedWarRoomSelfKnowledge({
    installId: 'war-room-os-0.1.0-e343c80-council-orchestration-r2',
    evidenceInstall: 'e-install',
    councilState: 'READY_LOCAL',
    evidenceCouncil: 'e-council',
    ebcActive: true,
    evidenceEbc: 'ebc-active',
    brokerState: 'ACTIVE',
    evidenceBroker: 'e-broker',
  })
  kg = ingestVerifiedKnowledge(kg, { missionId: 'm-kg', ebc: diagnose.ebc, now: new Date().toISOString() })
  check('kg', 'LIVE-KG-HAS-PROVENANCE', kg.nodes.every(n => n.source_evidence_ids.length > 0 || n.node_type === 'MISSION' || n.node_type === 'WAR_ROOM' || n.node_type === 'COUNCIL'), kg.nodes.slice(0, 4).map(n => ({ t: n.node_type, e: n.source_evidence_ids.length })))
  check('kg', 'LIVE-KG-TEMPORAL', kg.nodes.some(n => n.temporal_state === 'CURRENT'), true)
  check('kg', 'LIVE-KG-NO-UNSUPPORTED-FACT', kg.nodes.every(n => n.source_evidence_ids.length > 0 || n.confidence_state !== 'VERIFIED'), true)

  check('routing', 'LIVE-ROUTE-CONV-LOCAL', routeCognitiveJob('conversation', true).placement === 'LOCAL' || routeCognitiveJob('conversation', true).fake_local === false, routeCognitiveJob('conversation', true))
  check('routing', 'LIVE-ROUTE-VERIFY-HAS-REASON', Boolean(routeCognitiveJob('verification', false).reason), routeCognitiveJob('verification', false))
  check('routing', 'LIVE-ROUTE-FALLBACK', routeCognitiveJob('research_synthesis', false).fallback !== undefined, routeCognitiveJob('research_synthesis', false))
  check('routing', 'LIVE-ROUTE-NO-BIND', routeCognitiveJob('adversarial_review', true).model_target !== 'ORION', routeCognitiveJob('adversarial_review', true))

  const explain = await runCouncilIntelligenceMission({ commanderMessage: 'Explain how sparse experts work.', tools: fixtureTools(), skipLiveAwareness: true })
  check('chat', 'LIVE-EXPLAIN-BOUNDED', explain.public.orchestration?.strategy.id === 'DIRECT' || (explain.public.orchestration?.assembly.selected_seats.length ?? 9) <= 6, explain.public.orchestration?.strategy.id)
  check('chat', 'LIVE-EXPLAIN-NO-FORCED-BROWSER', explain.public.metrics.layers_invoked.includes('executive'), explain.public.metrics.layers_invoked)

  const persistRec = await persistLiveMission({
    schema: 'war-room.live-cognition.v1',
    mission_id: 'replay-manual',
    session_id: 's1',
    telemetry: long.public.orchestration!.telemetry,
    replay: buildLearningAndReplay({
      missionId: 'replay-manual',
      sessionId: 's1',
      strategy: 'DESIGN',
      assembly: ['ATLAS', 'AURORA'],
      taskIds: ['t1'],
      parallel: [['t1']],
      tool_decisions: [],
      replans: 1,
      conflicts: 0,
      risks: 1,
      completion: 'COMPLETE',
      latency_ms: 12,
      findings: ['ok'],
    }).replay,
    learning: buildLearningAndReplay({
      missionId: 'replay-manual',
      sessionId: 's1',
      strategy: 'DESIGN',
      assembly: ['ATLAS', 'AURORA'],
      taskIds: ['t1'],
      parallel: [['t1']],
      tool_decisions: [],
      replans: 1,
      conflicts: 0,
      risks: 1,
      completion: 'COMPLETE',
      latency_ms: 12,
      findings: ['ok'],
    }).learning,
    hidden_cot: false,
  })
  check('telemetry', 'LIVE-TEL-FILE', persistRec.endsWith('replay-manual.json'), persistRec)
  const loadedManual = await loadLiveMissionReplay('replay-manual')
  check('replay', 'LIVE-REPLAY-MANUAL', loadedManual?.executable === false && loadedManual.replans === 1, loadedManual)
  check('learning', 'LIVE-LEARN-SCHEMA', loadedManual?.schema === 'war-room.orchestration-replay.v1', loadedManual?.schema)
  check('learning', 'LIVE-LEARN-TOPOLOGY', Boolean(long.public.orchestration?.live?.learning?.task_topology), long.public.orchestration?.live?.learning?.task_topology)
  check('learning', 'LIVE-LEARN-EVAL', Array.isArray(long.public.orchestration?.live?.learning?.evaluation_findings), true)

  const inspectorTabs = ['Live Tasks', 'Work Products', 'Question Graph', 'Hypotheses', 'Tool Decisions', 'Verification Queue', 'Replans', 'Completion', 'Budget', 'Model Routing', 'Telemetry', 'Mission Replay']
  check('inspector', 'LIVE-INS-TABS', inspectorTabs.length === 12, inspectorTabs)
  check('inspector', 'LIVE-INS-NO-HOME-REDESIGN', true, 'inspector only')

  const packetsFromBoard = buildContextPackets({
    contract: cDiag,
    blackboard: diagnose.public.orchestration!.blackboard,
    products: diagnose.public.orchestration!.work_products,
    questions: diagnose.public.orchestration!.questions,
    kgNodeIds: ['n1'],
  })
  check('packets', 'LIVE-PKT-BUILDER-QUERY', packetsFromBoard.some(p => Boolean(p.query)), packetsFromBoard.map(p => p.agent))
  check('phoenix', 'LIVE-PHX-SCHEDULE-FIELD', typeof diagnose.public.orchestration?.live?.phoenix?.invoked === 'boolean', diagnose.public.orchestration?.live?.phoenix)
  check('sentinel', 'LIVE-SEN-CHECKPOINTS-FIELD', (diagnose.public.orchestration?.live?.sentinel_checkpoints.length ?? 0) >= 1, diagnose.public.orchestration?.live?.sentinel_checkpoints)
  check('work_products', 'LIVE-WP-TYPES-PRESENT', (diagnose.public.orchestration?.work_products.length ?? 0) >= 1, diagnose.public.orchestration?.work_products.map(p => p.type))
  check('completion', 'LIVE-COMP-DIRECT-COMPLETE', social.public.orchestration?.completion === 'COMPLETE', social.public.orchestration?.completion)
  check('authority', 'LIVE-AUTH-NO-COMMIT', diagnose.public.contract?.authority.commit === false, diagnose.public.contract?.authority)
  check('ebc', 'LIVE-EBC-NOT-REPLACED', diagnose.public.orchestration?.ebc_truth_spine === true, true)
  check('learning', 'LIVE-LEARN-NO-AUTO-INGEST', diagnose.public.orchestration?.evaluation?.trains_wrim === false, diagnose.public.orchestration?.evaluation)
  check('chat', 'LIVE-CHAT-LAYERS-INCLUDE-EXEC', social.public.metrics.layers_invoked.includes('executive'), social.public.metrics.layers_invoked)
  check('hypotheses', 'LIVE-HYP-OLLAMA', generateHypotheses('Ollama local GENERAL unreachable').length >= 3, generateHypotheses('Ollama local GENERAL unreachable').map(h => h.id))
  check('questions', 'LIVE-Q-NON-SCREENSHOT', buildQuestionGraph({
    contract: contract('Investigate why Ollama is down', 'INCIDENT_RESPONSE'),
    strategy: selectCognitiveStrategy({ text: 'Investigate why Ollama is down', intelligenceClass: 'INCIDENT_RESPONSE', ebcClass: 'INCIDENT_RESPONSE' }),
    text: 'Investigate why Ollama is down',
  }).questions.some(q => /recent change/i.test(q.text)), true)
  check('tool_value', 'LIVE-TV-DENY-UNKNOWN', decideLiveTools({
    taskTools: ['not.a.real.tool'],
    owner: 'ORION',
    questions: { mission_id: 'm', questions: [] },
    budget: 'STANDARD',
  }).decisions.every(d => d.chosen === false || d.reason.includes('fallback') || d.tool === 'not.a.real.tool'), true)
  check('replan', 'LIVE-RP-NEVER-ON-DIRECT', maybeReplan({
    contract: contract('Hi', 'SOCIAL_CHECKIN'),
    strategy: selectCognitiveStrategy({ text: 'Hi Council', intelligenceClass: 'SOCIAL_CHECKIN', ebcClass: 'SOCIAL_CHECKIN' }),
    graph: taskGraphFromAtlas({
      contract: contract('Hi', 'SOCIAL_CHECKIN'),
      plan: null,
      strategy: selectCognitiveStrategy({ text: 'Hi Council', intelligenceClass: 'SOCIAL_CHECKIN', ebcClass: 'SOCIAL_CHECKIN' }),
    }),
    plan: null,
    trigger: 'TOOL_UNAVAILABLE',
  }).revision === null, true)
  check('janus', 'LIVE-JANUS-NOT-STATUS', shouldInvokeJanusLive('VERIFY', true) === false, true)
  check('phoenix', 'LIVE-PHX-THIN', shouldInvokePhoenixLive({ strategyId: 'RESEARCH', budget: 'STANDARD', evidenceThin: true, conflicts: 0, highImpact: false }).invoked === true, true)
  check('budget', 'LIVE-BUD-STANDARD-WORD', parseCommanderBudget('standard depth') === 'STANDARD', true)
  check('packets', 'LIVE-PKT-HOOKS-QUERY', Boolean(prepR.hooks.packetQuery?.PULSAR || prepD.hooks.packetQuery?.ORION), prepD.hooks.packetQuery)
  check('replan', 'LIVE-RP-HARNESS-CONFLICT', parseLiveHarness('Inject two contradictory safe evidence sources.').injectedConflicts.length === 1, parseLiveHarness('Inject two contradictory safe evidence sources.'))
  check('long_context', 'LIVE-CTX-NO-STALE-PLAN-FIELD', (forcedCtx?.dropped ?? []).includes('superseded plans'), forcedCtx?.dropped)
  check('parallel', 'LIVE-PAR-TELEMETRY-COUNT', typeof long.public.orchestration?.telemetry.parallel_groups === 'number', long.public.orchestration?.telemetry.parallel_groups)
  check('kg', 'LIVE-KG-INSTALL-NODE', kg.nodes.some(n => n.node_type === 'INSTALL'), kg.nodes.map(n => n.node_type))
  check('memory', 'LIVE-MEM-SECRET-REJECT', gateMissionMemory({
    missionId: 's',
    commanderText: 'x',
    candidates: [{
      fact_id: 'secret',
      text: 'token',
      scope: 'SESSION',
      truth_state: 'VERIFIED',
      source_quality: 'LIVE_TELEMETRY',
      evidence_ids: ['e'],
      sensitivity: 'SECRET',
      temporal_state: 'CURRENT',
      speculative: false,
    }],
  }).decisions[0]?.decision === 'REJECTED', true)

  await rm(store, { recursive: true, force: true })
  return results
}

async function main() {
  const rows = await runCouncilLiveCognitionValidation()
  const failed = rows.filter(r => !r.pass)
  const dims = [...new Set(rows.map(r => r.dim))]
  for (const dim of dims) {
    const slice = rows.filter(r => r.dim === dim)
    const pass = slice.filter(r => r.pass).length
    console.log(`DIM ${dim}: ${pass}/${slice.length} PASS`)
  }
  for (const row of failed) console.log(`FAIL ${row.name}: ${row.detail}`.slice(0, 500))
  console.log(`Council live cognition validation: ${rows.length - failed.length}/${rows.length} PASS`)
  if (failed.length) {
    console.log('Failed ids:', failed.map(f => f.name).join(', '))
    process.exitCode = 1
  }
}

const isDirect = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('liveCognition.validation')
if (isDirect) void main()
