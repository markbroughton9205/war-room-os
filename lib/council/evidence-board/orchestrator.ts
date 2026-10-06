import {
  AGENT_ENVELOPE_SCHEMA,
  MAX_PHOENIX_HARD_PASSES,
  MISSION_TELEMETRY_SCHEMA,
  type AgentEnvelopeV1,
  type AssemblyPlanV1,
  type EbcAgentId,
  type EbcClaim,
  type EbcEvidence,
  type EbcMissionResult,
  type EbcUnknown,
  type MissionClassifierOutput,
  type ToolCallRecord,
} from './types'
import { canonicalizeSourceKey } from '@/lib/council/gi/lumenQuality'
import { classifyEvidenceBoardMission } from './classifier'
import { decomposeTasks, missionRequiresLiveEvidence, round1WorkerAgents } from './assembly'
import { appendEnvelope, appendTasks, boardSnapshot, createEvidenceBoard, demoteStaleEvidence, evidenceIsFresh, lastVerifiedLabel, normalizeSourceUrl, toolFingerprint } from './board'
import { validateEnvelope } from './envelope'
import { createToolRunner, type ToolRunner, type ToolRuntimeOptions } from './tools'
import { demoteSourcelessExternalClaims, isExternalResearchMission, isUsableExternalEvidence, noUsableSourcesBrief, researchSourceCounts } from './researchTruth'
import { runRecoveryFetches, transparencyBrief, type ResearchLedger } from './evidenceRecovery'
import { attachCouncilEnginePublic } from '@/lib/council/engines/integration/ebc'
import {
  applyLumenPromotion,
  applyLumenToBoard,
  deriveCompletionState,
  deriveConfidence,
  gapTasksFromReview,
  phoenixChallenge,
  refuseFoundryExecution,
  synthesizeAurora,
  verifyClaimLumen,
} from './verify'

export type LiveEbcHooks = {
  forceUnavailable?: string[]
  packetQuery?: Partial<Record<EbcAgentId, string>>
  maxToolsPerTask?: number
  skipOptionalPhoenix?: boolean
  verifyOnlyMaterial?: boolean
  maxConcurrentWorkers?: number
  maxLocalModelWorkers?: number
}

const LIVE_ALTERNATE_TOOLS: Record<string, string> = {
  'broker.fetch': 'wr.broker.status',
  'browser.navigate': 'broker.fetch',
  'browser.screenshot': 'wr.broker.status',
  'wr.core.health': 'wr.ui.health',
}

async function runLimited<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (!items.length) return
  let i = 0
  const n = Math.max(1, Math.min(limit || items.length, items.length))
  async function worker() {
    while (i < items.length) {
      const idx = i
      i += 1
      await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()))
}

export type EbcRunInput = {
  commanderMessage: string
  missionId?: string
  now?: number
  tools?: ToolRunner
  toolOptions?: ToolRuntimeOptions
  plantEnvelopes?: AgentEnvelopeV1[]
  policyRefuse?: boolean
  echoThreshold?: number
  live?: LiveEbcHooks
}

function id(prefix: string, n: number): string {
  return `${prefix}${n}`
}

function recordToEvidence(agent_id: EbcAgentId, mission_id: string, record: ToolCallRecord, index: number, round: number): EbcEvidence {
  const payload = record.payload as { sources?: Array<{ published_at?: string | null; relevance_decision?: string; ok?: boolean }> } | undefined
  const published = payload?.sources?.find(row => row.published_at)?.published_at ?? null
  const failedDecision = payload?.sources?.find(row => row.ok === false)?.relevance_decision
  return {
    evidence_id: id(`e-${agent_id}-r${round}-`, index),
    kind: record.kind,
    summary: record.summary,
    pointer: record.pointer,
    source: record.tool_name,
    url: record.url ?? null,
    final_url: record.url ?? null,
    title: record.title ?? null,
    source_type: record.kind === 'primary_external' ? 'primary_external' : record.kind === 'tool_result' ? 'tool_result' : null,
    worker_id: agent_id,
    retrieved_at: record.retrieved_at,
    observed_at: record.retrieved_at,
    valid_from: published,
    verified_at: record.ok ? record.retrieved_at : null,
    verification_method: record.tool_name,
    tool_name: record.tool_name,
    ok: record.ok,
    temporal_layer: record.temporal_layer,
    args_fingerprint: record.args_fingerprint,
    agent_id,
    round,
    status_code: record.status_code ?? null,
    stale_reason: record.ok ? null : (failedDecision || null),
  }
}

function extraSourceEvidence(agent_id: EbcAgentId, mission_id: string, record: ToolCallRecord, primary: EbcEvidence, round: number): EbcEvidence[] {
  const payload = record.payload as {
    sources?: Array<{
      url?: string
      final_url?: string
      title?: string
      snippet?: string
      retrieved_at?: string
      published_at?: string | null
      source_type?: string
      ok?: boolean
      relevance_decision?: string
    }>
    failed_sources?: Array<{ url?: string; title?: string; reason?: string }>
  } | undefined
  const failedMapped = (payload?.failed_sources ?? []).map(row => ({
    url: row.url,
    final_url: row.url,
    title: row.title,
    snippet: '',
    retrieved_at: record.retrieved_at,
    published_at: null as string | null,
    source_type: 'tool_result',
    ok: false,
    relevance_decision: row.reason,
  }))
  const sources = [...(payload?.sources ?? []), ...failedMapped]
  const extras: EbcEvidence[] = []
  const seen = new Set<string>([canonicalizeSourceKey(primary.final_url || primary.url || primary.pointer)])
  sources.forEach((source, index) => {
    const url = source.final_url || source.url || ''
    const key = canonicalizeSourceKey(url)
    const snippet = String(source.snippet || '').trim()
    if (!key || seen.has(key)) return
    seen.add(key)
    const usable = source.ok !== false && snippet.length >= 24 && /^https?:\/\//i.test(url)
    extras.push({
      evidence_id: `${primary.evidence_id}-src${index}`,
      kind: usable ? 'primary_external' : 'tool_result',
      summary: usable ? `${source.title || 'source'} — ${url}\n${snippet}`.slice(0, 720) : `${source.title || 'source'} — ${url}`.slice(0, 240),
      pointer: url,
      source: record.tool_name,
      url,
      final_url: url,
      title: source.title ?? null,
      source_type: usable ? 'primary_external' : 'tool_result',
      worker_id: agent_id,
      retrieved_at: source.retrieved_at || record.retrieved_at,
      observed_at: source.retrieved_at || record.retrieved_at,
      valid_from: source.published_at || null,
      verified_at: usable ? (source.retrieved_at || record.retrieved_at) : null,
      verification_method: record.tool_name,
      tool_name: record.tool_name,
      ok: usable,
      temporal_layer: 'CURRENT_LIVE',
      args_fingerprint: record.args_fingerprint,
      agent_id,
      round,
      stale_reason: usable ? null : (source.relevance_decision || 'REJECT_EXTRACTION_FAILED'),
    })
  })
  return extras
}

function claimFromRecord(agent_id: EbcAgentId, record: ToolCallRecord, evidence_id: string, index: number, round: number, missionClass: AssemblyPlanV1['mission_class']): EbcClaim {
  const critical = missionRequiresLiveEvidence(missionClass)
  let text = record.summary
  let temporal = record.temporal_layer
  if (!record.ok && record.blocked) {
    text = `${record.tool_name} ${record.denied ? 'denied' : 'blocked'}: ${record.summary}`
  }
  if (record.tool_name === 'wr.council.backend' && record.ok) {
    text = 'Council local backend READY_LOCAL'
  }
  if (temporal === 'LAST_VERIFIED') {
    text = lastVerifiedLabel(record.retrieved_at, record.tool_name)
  }
  return {
    claim_id: id(`c-${agent_id}-r${round}-`, index),
    text,
    status: record.ok ? 'PROPOSED' : record.blocked ? 'TOOL_BLOCKED' : 'UNVERIFIED',
    evidence_ids: [evidence_id],
    confidence: record.ok ? 0.7 : 0.2,
    label: record.ok ? 'VERIFIED_FACT' : 'INFERENCE',
    temporal_layer: temporal,
    critical,
    agent_id,
    round,
  }
}

async function runWorkerTasks(input: {
  plan: AssemblyPlanV1
  tasks: ReturnType<typeof decomposeTasks>
  tools: ToolRunner
  round: number
  peerLog: EbcMissionResult['hidden_first_pass']['worker_contexts']
  commanderMessage: string
  live?: LiveEbcHooks
}): Promise<{ envelopes: AgentEnvelopeV1[]; calls: ToolCallRecord[]; unknowns: EbcUnknown[] }> {
  const workers = round1WorkerAgents(input.plan, input.tasks)
  const envelopes: AgentEnvelopeV1[] = []
  const calls: ToolCallRecord[] = []
  const unknowns: EbcUnknown[] = []
  const started = Date.now()

  const eligible = input.tasks.filter(task => workers.includes(task.owner))
  const limit = input.live?.maxConcurrentWorkers ?? eligible.length
  const localLimit = Math.max(1, input.live?.maxLocalModelWorkers ?? 1)
  const localOwners = new Set(['ORION', 'NOVA'])
  const localTasks = eligible.filter(task => localOwners.has(task.owner))
  const otherTasks = eligible.filter(task => !localOwners.has(task.owner))
  const runOne = async (task: (typeof eligible)[number]) => {
    input.peerLog.push({ agent_id: task.owner, task_id: task.task_id, saw_sibling_draft: false })
    const used: ToolCallRecord[] = []
    const cap = input.live?.maxToolsPerTask
    const selectedTools = typeof cap === 'number' ? task.tools.slice(0, Math.max(1, cap)) : task.tools
    for (const toolName of selectedTools) {
      if (refuseFoundryExecution(input.plan.mission_class, toolName)) {
        used.push({
          tool_name: toolName,
          args_fingerprint: toolFingerprint(toolName, { mission: input.plan.mission_id }),
          ok: false,
          blocked: true,
          denied: true,
          summary: 'REFUSED: Council ENGINEERING cannot execute Foundry mutation',
          pointer: toolName,
          kind: 'tool_result',
          retrieved_at: new Date().toISOString(),
          temporal_layer: 'CURRENT_LIVE',
        })
        continue
      }
      if (input.live?.forceUnavailable?.includes(toolName)) {
        used.push({
          tool_name: toolName,
          args_fingerprint: toolFingerprint(toolName, { mission: input.plan.mission_id, blocked: true }),
          ok: false,
          blocked: true,
          denied: false,
          summary: `TOOL_BLOCKED: ${toolName} unavailable`,
          pointer: toolName,
          kind: 'tool_result',
          retrieved_at: new Date().toISOString(),
          temporal_layer: 'CURRENT_LIVE',
        })
        const alternate = LIVE_ALTERNATE_TOOLS[toolName]
        if (alternate && !input.live.forceUnavailable.includes(alternate)) {
          used.push(await input.tools(alternate, {
            mission_id: input.plan.mission_id,
            task_id: task.task_id,
            query: input.live.packetQuery?.[task.owner] ?? task.objective,
            objective: task.objective,
            live_packet: true,
          }))
        }
        continue
      }
      const packetQuery = input.live?.packetQuery?.[task.owner]
      used.push(await input.tools(toolName, {
        mission_id: input.plan.mission_id,
        task_id: task.task_id,
        query: toolName === 'broker.fetch'
          ? input.commanderMessage
          : packetQuery,
        objective: task.objective,
        live_packet: Boolean(packetQuery),
      }))
    }
    calls.push(...used)
    const evidence = used.flatMap((record, index) => {
      const baseIndex = Number(task.task_id.replace(/\D/g, '') || index + 1) * 10 + index
      const primary = recordToEvidence(task.owner, input.plan.mission_id, record, baseIndex, input.round)
      const extras = extraSourceEvidence(task.owner, input.plan.mission_id, record, primary, input.round)
      return [primary, ...extras]
    })
    const claims = evidence.map((row, index) => ({
      claim_id: id(`c-${task.owner}-r${input.round}-`, Number(task.task_id.replace(/\D/g, '') || index + 1) * 10 + index),
      text: row.url ? `${row.title || row.tool_name} — ${row.final_url || row.url}` : row.summary,
      status: row.ok ? 'PROPOSED' as const : row.kind === 'primary_external' && !row.ok ? 'TOOL_BLOCKED' as const : 'UNVERIFIED' as const,
      evidence_ids: [row.evidence_id],
      confidence: row.ok ? 0.7 : 0.2,
      label: row.ok ? 'VERIFIED_FACT' as const : 'INFERENCE' as const,
      temporal_layer: row.temporal_layer,
      critical: missionRequiresLiveEvidence(input.plan.mission_class) || Boolean(row.url),
      agent_id: task.owner,
      round: input.round,
    }))
    if (task.owner === 'NOVA' && used.some(record => record.tool_name === 'wr.ports.list' && record.ok)) {
      const payload = used.find(record => record.tool_name === 'wr.ports.list')?.payload as { listeners?: Array<{ port: number; pid: number | null; processName: string | null; knownRole: string | null }> } | undefined
      const structured: EbcEvidence = {
        evidence_id: `e-NOVA-struct-${task.task_id}`,
        kind: 'tool_result',
        summary: 'Normalized port inventory',
        pointer: `nova:ports.normalized:${task.task_id}`,
        retrieved_at: new Date().toISOString(),
        tool_name: 'wr.ports.list',
        ok: true,
        temporal_layer: 'CURRENT_LIVE',
        agent_id: 'NOVA',
        round: input.round,
      }
      evidence.push(structured)
      claims.push({
        claim_id: `c-NOVA-ports-${task.task_id}`,
        text: JSON.stringify({
          schema: 'wr.ports.list.v1',
          listeners: payload?.listeners ?? [],
        }),
        status: 'PROPOSED',
        evidence_ids: [structured.evidence_id],
        confidence: 0.8,
        label: 'VERIFIED_FACT',
        temporal_layer: 'CURRENT_LIVE',
        critical: false,
        agent_id: 'NOVA',
        round: input.round,
      })
    }
    const envelope: AgentEnvelopeV1 = {
      schema: AGENT_ENVELOPE_SCHEMA,
      agent_id: task.owner,
      mission_id: input.plan.mission_id,
      mission_class: input.plan.mission_class,
      round: input.round,
      claims,
      evidence,
      contradictions: [],
      risks: [],
      tests_recommended: [],
      unknowns: used.filter(record => record.blocked && !record.ok).map((record, index) => ({
        unknown_id: `u-${task.task_id}-${index}`,
        text: record.summary,
        agent_id: task.owner,
      })),
      novelty: { adds: evidence.length ? ['NEW_EVIDENCE'] : claims.length ? ['NEW_CLAIM'] : [], suppressed: false },
      omit_reason: !task.tools.length && !claims.length ? 'no_tools_assigned' : null,
      tools_used: used.map(record => record.tool_name),
      tokens_used: 0,
      latency_ms: Date.now() - started,
      peer_visibility: 'HIDDEN',
      sibling_draft_tokens_seen: 0,
      prose: null,
    }
    if (!envelope.claims.length && !envelope.evidence.length && !envelope.omit_reason) {
      envelope.omit_reason = 'nothing_to_add'
    }
    envelopes.push(envelope)
    unknowns.push(...envelope.unknowns)
  }
  await Promise.all([
    runLimited(localTasks, localLimit, runOne),
    runLimited(otherTasks, Math.max(1, Math.min(limit, otherTasks.length || 1)), runOne),
  ])
  envelopes.sort((a, b) => `${a.agent_id}:${a.round}`.localeCompare(`${b.agent_id}:${b.round}`))

  return { envelopes, calls, unknowns }
}

function socialEnvelope(classification: MissionClassifierOutput): AgentEnvelopeV1 {
  return {
    schema: AGENT_ENVELOPE_SCHEMA,
    agent_id: 'AURORA',
    mission_id: classification.mission_id,
    mission_class: 'SOCIAL_CHECKIN',
    round: 1,
    claims: [],
    evidence: [],
    contradictions: [],
    risks: [],
    tests_recommended: [],
    unknowns: [],
    novelty: { adds: [], suppressed: false },
    omit_reason: 'social_checkin_presence_only',
    tools_used: [],
    tokens_used: 32,
    latency_ms: 1,
    peer_visibility: 'HIDDEN',
    sibling_draft_tokens_seen: 0,
    prose: 'Council present. No research, no six-seat assembly, no synthesis essay.',
  }
}

export async function runEvidenceBoardCouncil(input: EbcRunInput): Promise<EbcMissionResult> {
  const started = Date.now()
  const classification = classifyEvidenceBoardMission({
    commanderMessage: input.commanderMessage,
    missionId: input.missionId,
    now: input.now,
  })
  const tools = input.tools ?? createToolRunner(input.toolOptions)
  const mutationAsk = classification.mission_class === 'ENGINEERING'
    && /\b(commit|push|deploy|foundry(?:\s+execute)?|execute foundry|write files|mutate production)\b/i.test(input.commanderMessage)
  const board = createEvidenceBoard({
    mission_id: classification.mission_id,
    mission_class: classification.mission_class,
    question: input.commanderMessage,
    agents: classification.selected_agents,
    ttl_seconds: classification.ttl_seconds,
    budget_tokens: classification.budget_tokens,
    budget_ms: classification.budget_ms,
  })
  const tasks = decomposeTasks(classification, input.commanderMessage)
  appendTasks(board, tasks)
  const hidden_first_pass: EbcMissionResult['hidden_first_pass'] = {
    peer_visibility: 'HIDDEN',
    sibling_draft_tokens_before_submit: 0,
    worker_contexts: [],
  }
  const acceptedEnvelopes: AgentEnvelopeV1[] = []
  const suppressed: EbcMissionResult['suppressed'] = []
  const fallback_lineage: EbcMissionResult['telemetry']['fallback_lineage'] = []
  let allCalls: ToolCallRecord[] = []
  let unknowns: EbcUnknown[] = []
  let tokens_per_agent: Record<string, number> = {}
  let latency_per_agent: Record<string, number> = {}

  if (classification.mission_class === 'SOCIAL_CHECKIN') {
    const envelope = socialEnvelope(classification)
    const parsed = validateEnvelope(envelope)
    if (parsed.ok) {
      appendEnvelope(board, parsed.envelope, { echoThreshold: input.echoThreshold })
      acceptedEnvelopes.push(parsed.envelope)
      tokens_per_agent.AURORA = envelope.tokens_used
      latency_per_agent.AURORA = envelope.latency_ms
    }
    hidden_first_pass.worker_contexts.push({ agent_id: 'AURORA', task_id: tasks[0]?.task_id ?? 't1', saw_sibling_draft: false })
  } else {
    const round1 = await runWorkerTasks({
      plan: classification,
      tasks,
      tools,
      round: 1,
      peerLog: hidden_first_pass.worker_contexts,
      commanderMessage: input.commanderMessage,
      live: input.live,
    })
    allCalls = round1.calls
    unknowns = round1.unknowns
    const seenUrls = new Set<string>()
    for (const envelope of round1.envelopes) {
      envelope.evidence = envelope.evidence.filter(row => {
        const key = normalizeSourceUrl(row.final_url || row.url)
        if (!key) return true
        if (seenUrls.has(key)) {
          envelope.claims = envelope.claims.filter(claim => !claim.evidence_ids.includes(row.evidence_id))
          return false
        }
        seenUrls.add(key)
        return true
      })
    }
    for (const planted of input.plantEnvelopes ?? []) {
      round1.envelopes.push(planted)
    }
    for (const envelope of round1.envelopes) {
      const parsed = validateEnvelope(envelope)
      if (!parsed.ok) {
        suppressed.push({ envelope, reason: parsed.reason })
        board.suppressed.push({
          envelope,
          reason: parsed.reason,
          mission_id: board.mission.mission_id,
          agent_id: envelope.agent_id,
          round: envelope.round,
          timestamp: new Date().toISOString(),
          provenance: 'schema_gate',
        })
        continue
      }
      const novelty = appendEnvelope(board, parsed.envelope, { echoThreshold: input.echoThreshold })
      if (novelty.accepted) acceptedEnvelopes.push({ ...parsed.envelope, novelty: novelty.novelty })
      else suppressed.push({ envelope: parsed.envelope, reason: novelty.reason })
      tokens_per_agent[envelope.agent_id] = (tokens_per_agent[envelope.agent_id] ?? 0) + envelope.tokens_used
      latency_per_agent[envelope.agent_id] = (latency_per_agent[envelope.agent_id] ?? 0) + envelope.latency_ms
    }
  }

  demoteStaleEvidence(board, input.now ?? Date.now())

  let researchLedger: ResearchLedger | null = null
  if (isExternalResearchMission(classification.mission_class)) {
    const priorQueries = allCalls
      .filter(call => call.tool_name === 'broker.fetch')
      .map(call => String((call.payload as { queries?: string[] } | undefined)?.queries?.[0] ?? call.summary))
      .filter(Boolean)
    const authBlocked = allCalls.some(call => call.tool_name === 'broker.fetch' && call.denied)
    const recovery = await runRecoveryFetches({
      missionId: classification.mission_id,
      objective: input.commanderMessage,
      tools,
      priorQueries: priorQueries.length ? priorQueries : [input.commanderMessage],
      usableCount: board.evidence.filter(isUsableExternalEvidence).length,
      authBlocked,
      maxWaves: 3,
    })
    researchLedger = recovery.ledger
    const stamp = (row: { retrieved_at?: string }, agent: 'PULSAR') => ({
      mission_id: classification.mission_id,
      agent_id: agent,
      round: 2,
      timestamp: row.retrieved_at || new Date().toISOString(),
      provenance: 'evidence-recovery',
    })
    recovery.records.forEach((record, index) => {
      allCalls.push(record)
      const evidence = recordToEvidence('PULSAR', classification.mission_id, record, board.evidence.length + index, 2)
      board.evidence.push({ ...evidence, ...stamp(evidence, 'PULSAR') })
      for (const extra of extraSourceEvidence('PULSAR', classification.mission_id, record, evidence, 2)) {
        board.evidence.push({ ...extra, ...stamp(extra, 'PULSAR') })
      }
      if (record.ok) {
        const claim = claimFromRecord('PULSAR', record, evidence.evidence_id, board.claims.length, 2, classification.mission_class)
        board.claims.push({
          ...claim,
          mission_id: classification.mission_id,
          agent_id: 'PULSAR',
          round: 2,
          timestamp: record.retrieved_at,
          provenance: 'evidence-recovery',
        })
      }
    })
  }

  const requiredToolNames = classification.required_tools
  const requiredToolsBlocked = requiredToolNames.length > 0 && requiredToolNames.every(name => {
    const hits = allCalls.filter(call => call.tool_name === name)
    return hits.length === 0 || hits.every(call => call.blocked || !call.ok)
  })
  const tool_blocks = allCalls
    .filter(call => call.blocked || call.denied)
    .map(call => ({ tool_name: call.tool_name, reason: call.summary }))

  const lumen = classification.selected_agents.includes('LUMEN') && board.claims.length
    ? await Promise.all(board.claims.filter(claim => (input.live?.verifyOnlyMaterial ? claim.critical : true)).map(async (claim) => {
      const supporting = board.evidence.filter(row => claim.evidence_ids.includes(row.evidence_id))
      const sample = supporting[0]
      const rechecked: ToolCallRecord[] = []
      if (sample && (sample.kind === 'live_telemetry' || sample.kind === 'tool_result')) {
        const replay = await tools(sample.tool_name, { mission_id: classification.mission_id, recheck: true, original: sample.evidence_id })
        rechecked.push(replay)
        if (!replay.ok && sample.ok) {
          fallback_lineage.push({
            primary: `${sample.tool_name}:${sample.evidence_id}`,
            fallback: replay.args_fingerprint,
            primary_failure: replay.summary,
          })
        }
      }
      return verifyClaimLumen({
        claim,
        evidence: board.evidence,
        ttlSeconds: classification.ttl_seconds,
        missionClass: classification.mission_class,
        rechecked,
        now: input.now ?? Date.now(),
      })
    }))
    : []
  applyLumenToBoard(board, lumen)
  if (isExternalResearchMission(classification.mission_class)) {
    const demoted = demoteSourcelessExternalClaims(board.claims, board.evidence, lumen)
    board.claims.splice(0, board.claims.length, ...demoted.claims)
    lumen.splice(0, lumen.length, ...demoted.lumen)
  }

  const phoenix: EbcMissionResult['phoenix'] = []
  const phoenixOptionalSkip = Boolean(input.live?.skipOptionalPhoenix) && board.conflicts.length === 0
  if (classification.phoenix_required && board.claims.length && !phoenixOptionalSkip) {
    const first = phoenixChallenge({ board, pass: 1 })
    phoenix.push(first)
    const criticalOpen = board.conflicts.some(conflict => conflict.open) && board.claims.some(claim => claim.critical && claim.status === 'CONTRADICTED')
    if (criticalOpen && classification.phoenix_max_hard_passes >= 2 && classification.phoenix_max_hard_passes <= MAX_PHOENIX_HARD_PASSES) {
      const second = phoenixChallenge({ board, pass: 2 })
      phoenix.push(second)
    }
  }

  applyLumenPromotion(board, lumen)
  if (isExternalResearchMission(classification.mission_class)) {
    const demoted = demoteSourcelessExternalClaims(board.claims, board.evidence, lumen)
    board.claims.splice(0, board.claims.length, ...demoted.claims)
    lumen.splice(0, lumen.length, ...demoted.lumen)
  }

  let early_stop_reason: string | null = null
  const criticalAfterR1 = board.claims.filter(claim => claim.critical)
  const allVerified = criticalAfterR1.length > 0 && criticalAfterR1.every(claim => claim.status === 'VERIFIED') && !board.conflicts.some(conflict => conflict.open)
  const gaps = (!allVerified && classification.max_substantive_rounds >= 2)
    ? gapTasksFromReview(lumen, phoenix)
    : []
  if (allVerified) early_stop_reason = 'all_critical_verified_r1'
  else if (!gaps.length) early_stop_reason = early_stop_reason ?? 'no_gap_wave_needed'
  else {
    const gapRound = await runWorkerTasks({
      plan: classification,
      tasks: gaps.map((gap, index) => ({
        task_id: `g${index + 1}`,
        mission_id: classification.mission_id,
        owner: gap.owner,
        objective: gap.objective,
        tools: gap.tools,
        acceptance: 'targeted evidence for tagged gap',
        depends_on: [],
        parallel_group: 'GAP',
        critical: true,
      })),
      tools,
      round: 2,
      peerLog: hidden_first_pass.worker_contexts,
      commanderMessage: input.commanderMessage,
      live: input.live,
    })
    allCalls.push(...gapRound.calls)
    for (const envelope of gapRound.envelopes) {
      const parsed = validateEnvelope(envelope)
      if (!parsed.ok) {
        suppressed.push({ envelope, reason: parsed.reason })
        continue
      }
      const novelty = appendEnvelope(board, parsed.envelope, { echoThreshold: input.echoThreshold })
      if (novelty.accepted) acceptedEnvelopes.push(parsed.envelope)
      else suppressed.push({ envelope: parsed.envelope, reason: novelty.reason })
    }
    early_stop_reason = 'gap_wave_completed'
  }

  const requiredBlocked = requiredToolsBlocked && missionRequiresLiveEvidence(classification.mission_class)
  const completion_state = deriveCompletionState({
    policyRefuse: input.policyRefuse || mutationAsk,
    requiredToolsBlocked: requiredBlocked,
    claims: board.claims,
    conflicts: board.conflicts,
    budgetExhausted: Date.now() - started > classification.budget_ms,
  })
  const confidence = deriveConfidence({
    claims: board.claims,
    evidence: board.evidence,
    lumen,
    conflicts: board.conflicts,
  })
  const snapshot = boardSnapshot(board, {
    unknowns,
    tool_blocks,
    risks: phoenix.flatMap(pass => pass.risks),
    tests_recommended: phoenix.flatMap(pass => pass.tests_recommended),
  })
  const aurora = classification.aurora_required || classification.mission_class !== 'SOCIAL_CHECKIN'
    ? synthesizeAurora(snapshot, completion_state, confidence)
    : synthesizeAurora({ ...snapshot, claims: [], evidence: [] }, completion_state, confidence)

  if (classification.mission_class === 'SOCIAL_CHECKIN') {
    aurora.verified_facts = []
    aurora.completion_state = 'UNVERIFIED'
    aurora.unknowns = []
    aurora.next_actions = []
    aurora.confidence = 0
  }

  const sourceCounts = researchSourceCounts(board.evidence, {
    discovered_source_count: allCalls.reduce((sum, call) => {
      const payload = call.payload as { discovered_source_count?: number } | undefined
      return Math.max(sum, payload?.discovered_source_count ?? 0)
    }, 0),
    selected_source_count: allCalls.reduce((sum, call) => {
      const payload = call.payload as { selected_source_count?: number } | undefined
      return Math.max(sum, payload?.selected_source_count ?? 0)
    }, 0),
    opened_source_count: allCalls.reduce((sum, call) => {
      const payload = call.payload as { opened_source_count?: number } | undefined
      return Math.max(sum, payload?.opened_source_count ?? 0)
    }, 0),
  })
  const telemetry = {
    schema: MISSION_TELEMETRY_SCHEMA,
    mission_id: classification.mission_id,
    mission_class: classification.mission_class,
    agent_count: classification.selected_agents.length,
    selected_agents: classification.selected_agents,
    tool_count: new Set(allCalls.map(call => call.args_fingerprint)).size,
    tool_fingerprints: [...new Set(allCalls.map(call => call.args_fingerprint))],
    tokens_per_agent,
    latency_per_agent,
    total_latency_ms: Date.now() - started,
    completion_state: classification.mission_class === 'SOCIAL_CHECKIN' ? aurora.completion_state : completion_state,
    claims_count: board.claims.length,
    evidence_count: board.evidence.length,
    phoenix_challenges: phoenix.filter(pass => pass.successful).length,
    phoenix_hard_passes: phoenix.length,
    aurora_exclusions: suppressed.length + (classification.aurora_required ? 0 : 1),
    early_stop_reason,
    estimated_cost: Object.values(tokens_per_agent).reduce((a, b) => a + b, 0) * 0.000002,
    peer_visibility_round1: 'HIDDEN' as const,
    sibling_draft_tokens_before_submit: hidden_first_pass.sibling_draft_tokens_before_submit,
    fallback_lineage,
    unique_source_count: sourceCounts.unique_source_count,
    discovered_source_count: sourceCounts.discovered_source_count,
    selected_source_count: sourceCounts.selected_source_count,
    opened_source_count: sourceCounts.opened_source_count,
    usable_source_count: sourceCounts.usable_source_count,
    primary_source_count: sourceCounts.primary_source_count,
    failed_source_count: sourceCounts.failed_source_count,
  }

  const commander_brief = formatCommanderBrief(classification, aurora, board, researchLedger)

  return {
    classification,
    assembly: classification,
    board,
    envelopes: acceptedEnvelopes,
    suppressed,
    lumen,
    phoenix,
    aurora,
    telemetry,
    snapshot: {
      mission_id: classification.mission_id,
      mission_class: classification.mission_class,
      selected_agents: classification.selected_agents,
      tasks: tasks.map(task => ({ task_id: task.task_id, owner: task.owner, objective: task.objective, tools: [...task.tools] })),
      tool_calls: allCalls.map(call => ({ tool_name: call.tool_name, ok: call.ok, fingerprint: call.args_fingerprint })),
      evidence_count: board.evidence.length,
      unique_source_count: telemetry.unique_source_count,
      discovered_source_count: telemetry.discovered_source_count,
      selected_source_count: telemetry.selected_source_count,
      opened_source_count: telemetry.opened_source_count,
      primary_source_count: telemetry.primary_source_count,
      failed_source_count: telemetry.failed_source_count,
      claims_count: board.claims.length,
      lumen,
      phoenix_conflicts: board.conflicts,
      aurora,
      completion_state: telemetry.completion_state,
      confidence: aurora.confidence,
      latency_ms: telemetry.total_latency_ms,
      suppressed_contributions: suppressed.length,
      peer_visibility_round1: 'HIDDEN',
      ...(() => {
        const researchPayload = allCalls.find(call => call.tool_name === 'broker.fetch')?.payload as { research_domain?: string; freshness_window_days?: number | null } | undefined
        const records = publicSourceRecords(board, lumen, researchPayload)
        return {
          sources: records.sources,
          evidence: records.evidence,
          usable_source_count: records.usable_source_count,
          research_domain: records.research_domain,
          freshness_window_days: records.freshness_window_days,
          engines: attachCouncilEnginePublic({ board, lumen, aurora, mission_class: classification.mission_class }),
          research_ledger: researchLedger ?? undefined,
        }
      })(),
    },
    commander_brief,
    research_ledger: researchLedger ?? undefined,
    hidden_first_pass,
  }
}

export function publicSourceRecords(
  board: ReturnType<typeof createEvidenceBoard>,
  lumen: EbcMissionResult['lumen'],
  payload?: { research_domain?: string; freshness_window_days?: number | null },
) {
  const sources = board.evidence.map(row => {
    const usable = isUsableExternalEvidence(row)
    const url = String(row.final_url || row.url || '')
    return {
      id: row.evidence_id,
      url,
      title: String(row.title || row.summary.split('\n')[0] || url).slice(0, 180),
      source_type: String(row.source_type || row.kind),
      primary: row.kind === 'primary_external' || row.source_type === 'primary_external',
      authoritative: usable && (row.kind === 'primary_external' || row.kind === 'live_telemetry'),
      published_at: row.valid_from || row.summary.match(/^(?:Published|Updated):\s*(\d{4}-\d{2}-\d{2})/im)?.[1] || null,
      observed_at: row.observed_at || row.retrieved_at || null,
      relevance_decision: usable ? 'ACCEPT' : (row.stale_reason || (row.ok ? 'REJECT_OFF_TOPIC' : 'REJECT_EXTRACTION_FAILED')),
      usable,
    }
  })
  const evidence = board.evidence.map(row => {
    const usable = isUsableExternalEvidence(row)
    const claim_ids = board.claims.filter(claim => claim.evidence_ids.includes(row.evidence_id)).map(claim => claim.claim_id)
    const bound = lumen.find(item => (item.evidence_refs ?? []).includes(row.evidence_id))
    return {
      id: row.evidence_id,
      source_id: row.evidence_id,
      claim_ids,
      support_type: row.kind,
      usable,
      verification_state: bound?.verdict || (usable ? 'UNKNOWN' : 'UNSUPPORTED'),
    }
  })
  const usable_source_count = sources.filter(row => row.usable).length
  return { sources, evidence, usable_source_count, research_domain: payload?.research_domain ?? null, freshness_window_days: payload?.freshness_window_days ?? null }
}

function stripBriefIds(text: string): string {
  return text.replace(/\b(claim_[^\s]+|TOOL_BLOCKED|CURRENT_LIVE|e-[\w-]+)\b/g, '').replace(/\s{2,}/g, ' ').trim()
}

function isFailedRetrievalCopy(text: string): boolean {
  return /opened no usable sources|browser probe failed|could not complete the live page fetch|broker\.fetch/i.test(text)
}

function usableFindings(
  aurora: EbcMissionResult['aurora'],
  board: ReturnType<typeof createEvidenceBoard>,
): string[] {
  const fromClaims = [
    ...aurora.verified_facts.map(fact => stripBriefIds(fact.text)),
    ...aurora.partially_verified.map(fact => stripBriefIds(fact.text)),
  ].filter(Boolean)
  const fromEvidence = board.evidence
    .filter(row => {
      if (!row.ok) return false
      if (row.kind === 'live_telemetry' || row.kind === 'tool_result' || row.kind === 'repo_config') return true
      return isUsableExternalEvidence(row)
    })
    .map(row => stripBriefIds((row.summary.split('\n')[0] || row.summary)))
    .filter(Boolean)
  const merged: string[] = []
  for (const item of [...fromClaims, ...fromEvidence]) {
    if (isFailedRetrievalCopy(item)) continue
    if (merged.some(existing => existing === item || existing.includes(item) || item.includes(existing))) continue
    merged.push(item)
  }
  return merged
}

export function formatCommanderBrief(
  classification: MissionClassifierOutput,
  aurora: EbcMissionResult['aurora'],
  board: ReturnType<typeof createEvidenceBoard>,
  ledger?: ResearchLedger | null,
): string {
  if (classification.mission_class === 'SOCIAL_CHECKIN') {
    // Live Commander chat overwrites this via generateConversationalAurora.
    // This is an EBC-only placeholder for skipLive unit paths — never a canned greeting
    // shipped as the installed Home response.
    return aurora.verified_facts.length || aurora.partially_verified.length
      ? usableFindings(aurora, board).join('\n')
      : ''
  }
  if (classification.mission_class === 'SYSTEM_STATUS') {
    const statusFindings = usableFindings(aurora, board).filter(item => !isFailedRetrievalCopy(item))
    if (!statusFindings.length) {
      return 'I could not verify the live War Room status because local telemetry was not returned. Browser research is not a substitute for that probe.'
    }
    return ['War Room status from local probes.', ...statusFindings.slice(0, 6).map(item => `- ${item}`)].join('\n')
  }
  const question = board.mission.question?.trim() || ''
  const findings = usableFindings(aurora, board)
  const blocked = aurora.tool_blocks.map(item => stripBriefIds(item)).filter(Boolean)
  const unknowns = [...new Set(aurora.unknowns.map(item => stripBriefIds(item)).filter(Boolean))]
  const conflicts = aurora.conflicts.map(conflict => conflict.summary).filter(text => !/none/i.test(text))
  const failedRetrievals = board.evidence.filter(row => !row.ok && (row.tool_name === 'broker.fetch' || /broker/i.test(row.tool_name || '')))
  const sources: string[] = []
  const seenSources = new Set<string>()
  for (const row of board.evidence) {
    if (!isUsableExternalEvidence(row)) continue
    const key = canonicalizeSourceKey(row.final_url || row.url)
    if (!key || seenSources.has(key)) continue
    seenSources.add(key)
    const dated = row.summary.match(/^(?:Published|Updated):\s*(\d{4}-\d{2}-\d{2})/im)
    const published = row.valid_from ? row.valid_from.slice(0, 10) : (dated?.[1] || '')
    sources.push(`${row.title || 'source'} — ${row.final_url || row.url}${published ? ` (${published})` : ''}`.replace(/\s{2,}/g, ' ').trim())
  }
  const researchMission = classification.mission_class === 'DEEP_RESEARCH' || classification.mission_class === 'CURRENT_INTEL'
  if (researchMission && !sources.length) {
    if (ledger && ledger.wave_number > 1 && ledger.termination_reason) return transparencyBrief(ledger)
    return noUsableSourcesBrief()
  }
  const lines: string[] = []
  if (findings.length) {
    if (researchMission) {
      const datedFindings = board.evidence
        .filter(isUsableExternalEvidence)
        .map(row => {
          const dated = row.summary.match(/^(?:Published|Updated):\s*\d{4}-\d{2}-\d{2}/im)?.[0] || ''
          const prose = row.summary.split('\n').map(line => line.trim()).find(line =>
            line.length >= 24 && !/^(?:Published|Updated):/i.test(line) && !/ — https?:\/\//i.test(line)
          ) || ''
          return [dated, prose].filter(Boolean).join(' ')
        })
        .filter(Boolean)
      const shown = datedFindings.length ? datedFindings : findings
      lines.push(shown[0])
      lines.push('What I found:')
      for (const finding of shown.slice(0, 4)) lines.push(`- ${finding}`)
      const verifiedLines = aurora.verified_facts
        .map(fact => stripBriefIds(fact.text).trim())
        .filter(text => text && !/ — https?:\/\//i.test(text) && !shown.includes(text))
      if (verifiedLines.length) {
        lines.push('What is verified:')
        for (const fact of verifiedLines.slice(0, 3)) lines.push(`- ${fact}`)
      }
      if (failedRetrievals.length && sources.length) {
        lines.push('What remains uncertain: one selected source could not be opened, so coverage is narrower than the full set.')
      } else if (failedRetrievals.length || (blocked.length && aurora.completion_state !== 'VERIFIED')) {
        lines.push('What remains uncertain: a second retrieval did not return an independent source, so corroboration is limited.')
      }
      if (sources.length) {
        lines.push('Sources:')
        for (const source of sources.slice(0, 4)) lines.push(`- ${source}`)
      }
      return lines.join('\n').replace(/\b(ORION|LUMEN|PULSAR|NOVA|PHOENIX|AURORA) says\b/gi, '').trim()
    }
    lines.push(findings[0])
    for (const fact of findings.slice(1, 4)) lines.push(fact)
  } else if (blocked.length) {
    const brokerFailed = blocked.some(item => /broker/i.test(item))
    lines.push(brokerFailed
      ? 'I couldn\'t verify the current value because the browser probe failed.'
      : 'I could not verify that from live probes.')
  } else if (question) {
    lines.push(`On that: I do not yet have verified evidence for a complete answer.`)
  } else {
    lines.push('I do not have verified evidence for a complete answer yet.')
  }
  const extraUnknown = unknowns.filter(item => !findings.some(fact => fact.includes(item)) && !lines[0]?.includes(item) && !isFailedRetrievalCopy(item))
  if (extraUnknown.length && aurora.completion_state !== 'VERIFIED' && !findings.length) {
    lines.push(`What I could not confirm: ${extraUnknown[0]}`)
  }
  if (conflicts.length) {
    lines.push(`One conflict matters: ${conflicts[0]}`)
  }
  if (aurora.next_actions[0] && aurora.completion_state !== 'VERIFIED' && !findings.length) {
    lines.push(aurora.next_actions[0].action)
  }
  return lines.join(' ').replace(/\s{2,}/g, ' ').replace(/\b(ORION|LUMEN|PULSAR|NOVA|PHOENIX|AURORA) says\b/gi, '').trim()
}

export function evidenceIsCurrentLive(row: { temporal_layer: string; retrieved_at: string }, ttlSeconds: number, now = Date.now()): boolean {
  return row.temporal_layer === 'CURRENT_LIVE' && evidenceIsFresh(row, ttlSeconds, now)
}
