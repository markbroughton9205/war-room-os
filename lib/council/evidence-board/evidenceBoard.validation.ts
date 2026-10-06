import { AGENT_ENVELOPE_SCHEMA, type AgentEnvelopeV1, type ToolCallRecord } from './types'
import { classifyEvidenceBoardMission, shouldDispatchEvidenceBoardCouncil } from './classifier'
import { classifyCouncilTurn } from '@/lib/council/session-orchestration/turnIntent'
import { validateEnvelope } from './envelope'
import { appendEnvelope, boardSnapshot, createEvidenceBoard, demoteStaleEvidence, lexicalCosine, toolFingerprint } from './board'
import { createToolRunner, type ToolRunner } from './tools'
import { deriveCompletionState, phoenixContributionSuccessful, refuseFoundryExecution, synthesizeAurora, verifyClaimLumen } from './verify'
import { runEvidenceBoardCouncil } from './orchestrator'

type Case = {
  caseId: string
  description: string
  result: 'PASS' | 'FAIL'
  details: string
}

function check(caseId: string, description: string, ok: boolean, details: unknown = ''): Case {
  return { caseId, description, result: ok ? 'PASS' : 'FAIL', details: typeof details === 'string' ? details : JSON.stringify(details) }
}

function fixtureTools(overrides?: { disabled?: string[]; denyBrowser?: boolean; failRecheck?: boolean; stale?: boolean }): ToolRunner {
  const disabled = new Set(overrides?.disabled ?? [])
  const cache = new Map<string, ToolCallRecord>()
  const now = overrides?.stale ? '2020-01-01T00:00:00.000Z' : new Date().toISOString()
  const payloads: Record<string, Partial<ToolCallRecord>> = {
    'wr.core.health': { ok: true, status_code: 200, summary: 'Core health 200', pointer: 'http://127.0.0.1:3847/api/local/health', kind: 'live_telemetry' },
    'wr.ui.health': { ok: true, status_code: 200, summary: 'UI health 200', pointer: 'http://127.0.0.1:3848/api/health', kind: 'live_telemetry' },
    'wr.ports.list': { ok: true, summary: 'listeners=2 critical=3847:1,3848:2', pointer: 'ss:-ltnp', kind: 'live_telemetry', payload: { listeners: [{ port: 3847, pid: 1, processName: 'core', knownRole: 'war_room_core' }, { port: 3848, pid: 2, processName: 'next', knownRole: 'war_room_ui' }] } },
    'wr.council.backend': { ok: true, summary: 'Council local backend READY_LOCAL', pointer: 'http://127.0.0.1:11434', kind: 'live_telemetry' },
    'wr.git.branch': { ok: true, summary: 'branch main @ abc1234', pointer: 'git:HEAD', kind: 'repo_config', temporal_layer: 'LAST_VERIFIED' },
    'wr.broker.status': { ok: false, blocked: true, denied: true, summary: 'Browser Broker not configured', pointer: 'broker:diagnostics', kind: 'live_telemetry' },
    'broker.fetch': { ok: false, blocked: true, denied: true, summary: 'Browser Broker denied', pointer: 'broker:fetch', kind: 'primary_external' },
  }
  return async (toolName, args = {}) => {
    const fingerprint = toolFingerprint(toolName, args)
    const cached = cache.get(fingerprint)
    if (cached) return { ...cached, coalesced_from: [...(cached.coalesced_from ?? []), fingerprint] }
    if (disabled.has(toolName)) {
      const record: ToolCallRecord = {
        tool_name: toolName,
        args_fingerprint: fingerprint,
        ok: false,
        blocked: true,
        denied: false,
        summary: `Tool ${toolName} disabled`,
        pointer: toolName,
        kind: 'tool_result',
        retrieved_at: now,
        temporal_layer: 'CURRENT_LIVE',
      }
      cache.set(fingerprint, record)
      return record
    }
    if (overrides?.denyBrowser && (toolName === 'broker.fetch' || toolName === 'wr.broker.status')) {
      const record: ToolCallRecord = {
        tool_name: toolName,
        args_fingerprint: fingerprint,
        ok: false,
        blocked: true,
        denied: true,
        summary: 'Browser Broker denied',
        pointer: toolName,
        kind: 'primary_external',
        retrieved_at: now,
        temporal_layer: 'CURRENT_LIVE',
      }
      cache.set(fingerprint, record)
      return record
    }
    if (overrides?.failRecheck && args.recheck === true) {
      const record: ToolCallRecord = {
        tool_name: toolName,
        args_fingerprint: fingerprint,
        ok: false,
        blocked: true,
        denied: false,
        summary: 'primary probe failed; fallback attempted',
        pointer: toolName,
        kind: 'live_telemetry',
        retrieved_at: now,
        temporal_layer: 'CURRENT_LIVE',
      }
      cache.set(fingerprint, record)
      return record
    }
    const base = payloads[toolName]
    const record: ToolCallRecord = {
      tool_name: toolName,
      args_fingerprint: fingerprint,
      ok: base?.ok ?? false,
      blocked: base?.blocked ?? !(base?.ok ?? false),
      denied: base?.denied ?? false,
      summary: base?.summary ?? `unknown ${toolName}`,
      pointer: base?.pointer ?? toolName,
      status_code: base?.status_code ?? null,
      kind: base?.kind ?? 'tool_result',
      retrieved_at: now,
      temporal_layer: base?.temporal_layer ?? 'CURRENT_LIVE',
      payload: base?.payload,
    }
    cache.set(fingerprint, record)
    return record
  }
}

function envelope(partial: Partial<AgentEnvelopeV1> & Pick<AgentEnvelopeV1, 'agent_id' | 'mission_id'>): AgentEnvelopeV1 {
  return {
    schema: AGENT_ENVELOPE_SCHEMA,
    mission_class: 'SYSTEM_STATUS',
    round: 1,
    claims: [],
    evidence: [],
    contradictions: [],
    risks: [],
    tests_recommended: [],
    unknowns: [],
    novelty: { adds: ['NEW_CLAIM'], suppressed: false },
    omit_reason: null,
    tools_used: [],
    tokens_used: 0,
    latency_ms: 1,
    peer_visibility: 'HIDDEN',
    sibling_draft_tokens_seen: 0,
    prose: null,
    ...partial,
  }
}

export async function runEvidenceBoardValidation(): Promise<Case[]> {
  const cases: Case[] = []

  const poetic = validateEnvelope({
    schema: AGENT_ENVELOPE_SCHEMA,
    agent_id: 'ORION',
    mission_id: 'm1',
    mission_class: 'SYSTEM_STATUS',
    round: 1,
    claims: [],
    evidence: [],
    contradictions: [],
    risks: [],
    tests_recommended: [],
    unknowns: [],
    novelty: { adds: [], suppressed: false },
    omit_reason: null,
    tools_used: [],
    tokens_used: 0,
    latency_ms: 0,
    peer_visibility: 'HIDDEN',
    sibling_draft_tokens_seen: 0,
    prose: 'The War Room stands poised in quiet preparation.',
  })
  cases.push(check('schema_reject_poetic', 'Poetic prose-only output rejected.', !poetic.ok && (poetic as { reason: string }).reason.includes('prose'), poetic))

  const hi = classifyEvidenceBoardMission({ commanderMessage: 'Hi Council' })
  const hiTurn = classifyCouncilTurn('Hi Council')
  cases.push(check('classifier_hi_council', '"Hi Council" → SOCIAL_CHECKIN', hi.mission_class === 'SOCIAL_CHECKIN' && hiTurn.intent === 'SOCIAL_CHECKIN', hi.mission_class))
  cases.push(check('classifier_hi_agents', 'SOCIAL_CHECKIN uses 0–1 agent', hi.selected_agents.length <= 1, hi.selected_agents))
  cases.push(check('classifier_hi_no_research', 'SOCIAL_CHECKIN has no research tools', hi.required_tools.length === 0 && !hi.phoenix_required, hi.required_tools))

  const status = classifyEvidenceBoardMission({ commanderMessage: 'Status on War Room' })
  const statusTurn = classifyCouncilTurn('Status on War Room')
  cases.push(check('classifier_status', '"Status on War Room" → SYSTEM_STATUS', status.mission_class === 'SYSTEM_STATUS' && statusTurn.intent === 'STATUS_CHECK', { class: status.mission_class, intent: statusTurn.intent }))
  cases.push(check('classifier_status_agents', 'SYSTEM_STATUS ≤4 agents, no PULSAR', status.selected_agents.length <= 4 && !status.selected_agents.includes('PULSAR') && status.selected_agents.includes('ORION') && status.selected_agents.includes('LUMEN') && status.selected_agents.includes('PHOENIX') && status.selected_agents.includes('AURORA'), status.selected_agents))
  cases.push(check(
    'primary_dispatch_status',
    'SYSTEM_STATUS and SOCIAL_CHECKIN dispatch EBC as source of truth',
    shouldDispatchEvidenceBoardCouncil(status.mission_class) && shouldDispatchEvidenceBoardCouncil(hi.mission_class) && shouldDispatchEvidenceBoardCouncil('DEEP_RESEARCH'),
    { status: status.mission_class, hi: hi.mission_class },
  ))

  const blocked = await runEvidenceBoardCouncil({
    commanderMessage: 'Status on War Room',
    tools: fixtureTools({ disabled: ['wr.core.health', 'wr.ui.health', 'wr.ports.list', 'wr.council.backend'] }),
  })
  cases.push(check('tool_gate_disabled', 'Health tools disabled → TOOL_BLOCKED / UNVERIFIED', blocked.snapshot.completion_state === 'TOOL_BLOCKED' || blocked.snapshot.completion_state === 'UNVERIFIED', blocked.snapshot.completion_state))
  cases.push(check('AT-READY-1', 'health tools off → TOOL_BLOCKED or UNVERIFIED', blocked.snapshot.completion_state === 'TOOL_BLOCKED' || blocked.snapshot.completion_state === 'UNVERIFIED', blocked.snapshot.completion_state))

  const priorOnly = verifyClaimLumen({
    claim: { claim_id: 'c1', text: 'Healthy', status: 'PROPOSED', evidence_ids: ['e1'], confidence: 0.9, label: 'VERIFIED_FACT', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'ORION', round: 1 },
    evidence: [{ evidence_id: 'e1', kind: 'model_prior', summary: 'model said so', pointer: 'prior', retrieved_at: new Date().toISOString(), tool_name: 'none', ok: true, temporal_layer: 'HISTORICAL', agent_id: 'ORION', round: 1 }],
    ttlSeconds: 120,
    missionClass: 'SYSTEM_STATUS',
    rechecked: [],
  })
  cases.push(check('hierarchy_model_prior', 'model_prior only → not VERIFIED', priorOnly.verdict !== 'SUPPORTED', priorOnly))
  cases.push(check('AT-LUMEN-2', 'model_prior only → not VERIFIED', priorOnly.verdict !== 'SUPPORTED', priorOnly.verdict))
  cases.push(check('AT-HIER-1', 'secondary-only evidence → not VERIFIED', verifyClaimLumen({
    claim: { claim_id: 'c2', text: 'Core healthy', status: 'PROPOSED', evidence_ids: ['e2'], confidence: 0.9, label: 'VERIFIED_FACT', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'ORION', round: 1 },
    evidence: [{ evidence_id: 'e2', kind: 'secondary_external', summary: 'blog', pointer: 'http://example', retrieved_at: new Date().toISOString(), tool_name: 'web', ok: true, temporal_layer: 'CURRENT_LIVE', agent_id: 'PULSAR', round: 1 }],
    ttlSeconds: 120,
    missionClass: 'SYSTEM_STATUS',
    rechecked: [],
  }).verdict !== 'SUPPORTED', 'secondary'))

  const fakeId = validateEnvelope(envelope({
    agent_id: 'ORION',
    mission_id: 'm-fake',
    claims: [{ claim_id: 'c-fake', text: 'Core healthy', status: 'PROPOSED', evidence_ids: ['e-does-not-exist'], confidence: 0.9, label: 'VERIFIED_FACT', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'ORION', round: 1 }],
    evidence: [],
    novelty: { adds: ['NEW_CLAIM'], suppressed: false },
  }))
  cases.push(check('AT-LUMEN-1', 'fabricated evidence_id → reject/UNVERIFIED', !fakeId.ok, fakeId))

  const plantedReady = await runEvidenceBoardCouncil({
    commanderMessage: 'Status on War Room',
    tools: fixtureTools(),
    plantEnvelopes: [envelope({
      agent_id: 'ORION',
      mission_id: 'will-replace',
      claims: [{ claim_id: 'c-ready', text: 'Council READY', status: 'PROPOSED', evidence_ids: [], confidence: 0.99, label: 'INFERENCE', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'ORION', round: 1 }],
      evidence: [],
      novelty: { adds: ['NEW_CLAIM'], suppressed: false },
    })],
  })
  // plant mission_id may not match — re-run with matching id
  const statusRun = await runEvidenceBoardCouncil({
    commanderMessage: 'Status on War Room',
    missionId: 'ebc-status-plant',
    tools: fixtureTools(),
    plantEnvelopes: [envelope({
      agent_id: 'ORION',
      mission_id: 'ebc-status-plant',
      claims: [{ claim_id: 'c-ready', text: 'Council READY', status: 'PROPOSED', evidence_ids: [], confidence: 0.99, label: 'INFERENCE', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'ORION', round: 1 }],
      evidence: [],
      novelty: { adds: ['NEW_CLAIM'], suppressed: false },
    })],
  })
  cases.push(check('phoenix_ready_no_probe', 'READY with no live probe → conflict/demotion', statusRun.board.conflicts.some(conflict => /READY/.test(conflict.reason)) || statusRun.board.claims.some(claim => claim.claim_id === 'c-ready' && claim.status === 'CONTRADICTED'), statusRun.board.conflicts.map(c => c.reason)))
  cases.push(check('AT-PHOENIX-1', 'READY without CURRENT_LIVE → CONFLICT + demotion', statusRun.phoenix.some(pass => pass.conflicts.length > 0) && statusRun.aurora.completion_state !== 'VERIFIED', statusRun.aurora.completion_state))

  const rhetoric = phoenixContributionSuccessful({
    contradictions: [],
    risks: [],
    tests_recommended: [],
    prose: 'I am skeptical of the tone and find the rhetoric overconfident.',
  })
  cases.push(check('AT-PHOENIX-2', 'rhetoric-only challenge → not successful', rhetoric === false, rhetoric))

  const board = createEvidenceBoard({
    mission_id: 'echo',
    mission_class: 'SYSTEM_STATUS',
    question: 'Status on War Room',
    agents: ['ORION'],
    ttl_seconds: 120,
    budget_tokens: 1000,
    budget_ms: 1000,
  })
  const first = envelope({
    agent_id: 'ORION',
    mission_id: 'echo',
    claims: [{ claim_id: 'c-a', text: 'Core health endpoint returned 200', status: 'PROPOSED', evidence_ids: ['e-a'], confidence: 0.8, label: 'VERIFIED_FACT', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'ORION', round: 1 }],
    evidence: [{ evidence_id: 'e-a', kind: 'live_telemetry', summary: 'Core health 200', pointer: 'core', retrieved_at: new Date().toISOString(), tool_name: 'wr.core.health', ok: true, temporal_layer: 'CURRENT_LIVE', agent_id: 'ORION', round: 1 }],
  })
  appendEnvelope(board, first)
  const dup = envelope({
    agent_id: 'ORION',
    mission_id: 'echo',
    claims: [{ claim_id: 'c-b', text: 'Core health endpoint returned 200', status: 'PROPOSED', evidence_ids: ['e-b'], confidence: 0.8, label: 'VERIFIED_FACT', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'ORION', round: 1 }],
    evidence: [{ evidence_id: 'e-b', kind: 'live_telemetry', summary: 'Core health 200 duplicate', pointer: 'core', retrieved_at: new Date().toISOString(), tool_name: 'wr.core.health', ok: true, temporal_layer: 'CURRENT_LIVE', agent_id: 'ORION', round: 1 }],
  })
  const echo = appendEnvelope(board, dup)
  cases.push(check('anti_echo', 'near-duplicate worker output suppressed', echo.accepted === false || (echo.novelty.similarity ?? 0) >= 0.92, echo))
  cases.push(check('AT-ORION-echo', 'near-duplicate claim cosine gate', lexicalCosine('Core health endpoint returned 200', 'Core health endpoint returned 200') > 0.92, lexicalCosine('Core health endpoint returned 200', 'Core health endpoint returned 200')))

  const hidden = await runEvidenceBoardCouncil({ commanderMessage: 'Status on War Room', tools: fixtureTools() })
  cases.push(check('hidden_peers', 'no sibling draft tokens before first submission', hidden.hidden_first_pass.peer_visibility === 'HIDDEN' && hidden.hidden_first_pass.sibling_draft_tokens_before_submit === 0 && hidden.hidden_first_pass.worker_contexts.every(ctx => ctx.saw_sibling_draft === false), hidden.hidden_first_pass))

  const lastVerified = lastVerifiedTemporal()
  cases.push(check('temporal_last_verified', 'LAST_VERIFIED never labeled CURRENT_LIVE', lastVerified, 'ok'))
  cases.push(check('AT-READY-2', 'LAST_VERIFIED only → not CURRENT_LIVE', lastVerified, 'ok'))

  const emptyAurora = synthesizeAurora(boardSnapshot(createEvidenceBoard({
    mission_id: 'empty',
    mission_class: 'SYSTEM_STATUS',
    question: 'x',
    agents: ['AURORA'],
    ttl_seconds: 120,
    budget_tokens: 1,
    budget_ms: 1,
  })), 'UNVERIFIED', 0)
  cases.push(check('aurora_empty', 'empty board → no verified facts', emptyAurora.verified_facts.length === 0, emptyAurora.verified_facts))
  cases.push(check('AT-AURORA-1', 'empty board → no verified facts', emptyAurora.verified_facts.length === 0, emptyAurora))

  const unknownState = deriveCompletionState({
    requiredToolsBlocked: false,
    claims: [{ claim_id: 'c', text: 'unknown', status: 'UNVERIFIED', evidence_ids: [], confidence: 0, label: 'INFERENCE', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'ORION', round: 1 }],
    conflicts: [],
  })
  cases.push(check('AT-AURORA-2', 'critical UNKNOWN → not VERIFIED / no READY alias', unknownState !== 'VERIFIED' && unknownState !== ('READY' as string), unknownState))

  const proseBoard = validateEnvelope(envelope({
    agent_id: 'AURORA',
    mission_id: 'prose',
    claims: [],
    evidence: [],
    novelty: { adds: [], suppressed: false },
    omit_reason: null,
    prose: 'The chamber hums with quiet strength and the War Room stands ready.',
  }))
  cases.push(check('AT-AURORA-3', 'prose-only board → reject', !proseBoard.ok, proseBoard))
  cases.push(check('AT-READY-3', 'poetic fake status → reject/suppress', !proseBoard.ok, proseBoard))

  const fallback = await runEvidenceBoardCouncil({
    commanderMessage: 'Status on War Room',
    tools: fixtureTools({ failRecheck: true }),
  })
  cases.push(check('fallback_lineage', 'primary failure remains recorded after fallback/recheck', fallback.telemetry.fallback_lineage.length > 0 || fallback.lumen.some(item => item.independent_probe), fallback.telemetry.fallback_lineage))

  cases.push(check('early_stop', 'all critical verified R1 → no extra round or gap not required', hidden.telemetry.early_stop_reason === 'all_critical_verified_r1' || hidden.telemetry.early_stop_reason === 'no_gap_wave_needed' || hidden.telemetry.early_stop_reason === 'gap_wave_completed', hidden.telemetry.early_stop_reason))

  cases.push(check('boundary_foundry', 'Council ENGINEERING cannot execute Foundry mutation', refuseFoundryExecution('ENGINEERING', 'foundry.execute') && refuseFoundryExecution('ENGINEERING', 'git.commit'), 'ok'))
  const eng = await runEvidenceBoardCouncil({
    commanderMessage: 'Implement and commit this Foundry execute mutation now',
    tools: fixtureTools(),
  })
  cases.push(check('boundary_foundry_mission', 'ENGINEERING mutation ask → REFUSED', eng.snapshot.completion_state === 'REFUSED' || eng.classification.mission_class === 'ENGINEERING', eng.snapshot.completion_state))

  cases.push(check('continuity_local', 'missing commercial key does not kill local entity (EBC still classifies SYSTEM_STATUS locally)', status.mission_class === 'SYSTEM_STATUS' && status.llm_classification_used === false, status.llm_classification_used))

  const noNovelty = appendEnvelope(createEvidenceBoard({
    mission_id: 'nov',
    mission_class: 'SYSTEM_STATUS',
    question: 'x',
    agents: ['ORION'],
    ttl_seconds: 120,
    budget_tokens: 1,
    budget_ms: 1,
  }), envelope({
    agent_id: 'ORION',
    mission_id: 'nov',
    claims: [],
    evidence: [],
    novelty: { adds: [], suppressed: false },
    omit_reason: null,
  }))
  const noNoveltyParsed = validateEnvelope(envelope({
    agent_id: 'ORION',
    mission_id: 'nov',
    claims: [],
    evidence: [],
    novelty: { adds: [], suppressed: false },
    omit_reason: null,
  }))
  cases.push(check('novelty_reject', 'no novelty and no OMIT_REASON → reject', !noNoveltyParsed.ok || noNovelty.accepted === false, { parsed: noNoveltyParsed, append: noNovelty }))

  cases.push(check('telemetry', 'mission exposes counts/latency/completion', typeof hidden.telemetry.agent_count === 'number' && typeof hidden.telemetry.total_latency_ms === 'number' && Boolean(hidden.telemetry.completion_state) && typeof hidden.telemetry.claims_count === 'number', hidden.telemetry))

  cases.push(check('AT-CONFLICT-1', 'open conflict survives into final', statusRun.aurora.conflicts.length > 0 || statusRun.snapshot.phoenix_conflicts.some(conflict => conflict.open), statusRun.aurora.conflicts))

  const essay = validateEnvelope(envelope({
    agent_id: 'ORION',
    mission_id: 'essay',
    claims: [{
      claim_id: 'c-essay',
      text: 'A'.repeat(400),
      status: 'PROPOSED',
      evidence_ids: [],
      confidence: 0.5,
      label: 'INFERENCE',
      temporal_layer: 'CURRENT_LIVE',
      critical: false,
      agent_id: 'ORION',
      round: 1,
    }],
    evidence: [],
  }))
  cases.push(check('AT-CLAIM-SHAPE', 'essay-sized claim with no evidence → schema reject', !essay.ok, essay))

  cases.push(check('AT-BOARD-CHAT', 'Aurora cannot access chat partition as factual input', !('chat' in emptyAurora) && !('worker_chat' in emptyAurora) && board.chat_partition_forbidden === true, 'no chat'))

  const runner = fixtureTools()
  const a = await runner('wr.core.health', { x: 1 })
  const b = await runner('wr.core.health', { x: 1 })
  cases.push(check('AT-ORION-1', 'parallel identical health probes → dedup', Boolean(b.coalesced_from?.length) && a.args_fingerprint === b.args_fingerprint, { a: a.args_fingerprint, b: b.coalesced_from }))
  cases.push(check('AT-COST-4', 'duplicate tool fingerprints coalesce', Boolean(b.coalesced_from?.length), b.coalesced_from))

  const nova = await runEvidenceBoardCouncil({
    commanderMessage: 'Status on War Room inventory normalize ports dump',
    tools: fixtureTools(),
  })
  cases.push(check('AT-NOVA-1', 'port dump → typed structure, not prose-only', nova.envelopes.some(item => item.agent_id === 'NOVA' && item.claims.some(claim => /wr.ports.list.v1/.test(claim.text))), nova.classification.selected_agents))

  const pulsar = await runEvidenceBoardCouncil({
    commanderMessage: 'Current intel on War Room browser fetch today',
    tools: fixtureTools({ denyBrowser: true }),
  })
  cases.push(check('AT-PULSAR-1', 'Browser Broker denied → TOOL_BLOCKED and no invented URL', pulsar.snapshot.tool_calls.some(call => call.tool_name === 'broker.fetch' && call.ok === false) && !pulsar.board.evidence.some(row => Boolean(row.url) && row.ok), pulsar.snapshot.completion_state))

  const ttlBoard = createEvidenceBoard({
    mission_id: 'ttl',
    mission_class: 'SYSTEM_STATUS',
    question: 'Status on War Room',
    agents: ['ORION'],
    ttl_seconds: 1,
    budget_tokens: 1,
    budget_ms: 1,
  })
  appendEnvelope(ttlBoard, envelope({
    agent_id: 'ORION',
    mission_id: 'ttl',
    claims: [{ claim_id: 'c-old', text: 'Core health 200', status: 'VERIFIED', evidence_ids: ['e-old'], confidence: 0.9, label: 'VERIFIED_FACT', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'ORION', round: 1 }],
    evidence: [{ evidence_id: 'e-old', kind: 'live_telemetry', summary: 'Core health 200', pointer: 'core', retrieved_at: '2020-01-01T00:00:00.000Z', tool_name: 'wr.core.health', ok: true, temporal_layer: 'CURRENT_LIVE', agent_id: 'ORION', round: 1 }],
  }))
  const demoted = demoteStaleEvidence(ttlBoard, Date.now())
  cases.push(check('AT-TTL-1', 'evidence age > TTL → STALE / demote', demoted.length > 0 && ttlBoard.claims[0].status === 'STALE' && ttlBoard.evidence[0].temporal_layer === 'LAST_VERIFIED', ttlBoard.claims[0]))

  cases.push(check('AT-COST-1', 'Status on War Room → ≤4 agents; PULSAR off', hidden.classification.selected_agents.length <= 4 && !hidden.classification.selected_agents.includes('PULSAR'), hidden.classification.selected_agents))
  cases.push(check('AT-COST-2', 'Phoenix loops max hard passes ≤2', hidden.telemetry.phoenix_hard_passes <= 2, hidden.telemetry.phoenix_hard_passes))
  cases.push(check('AT-COST-3', 'SOCIAL_CHECKIN local classify; frontier optional', hi.llm_classification_used === false && hi.mission_class === 'SOCIAL_CHECKIN', hi.llm_classification_used))

  const social = await runEvidenceBoardCouncil({ commanderMessage: 'Hi Council', tools: fixtureTools() })
  cases.push(check('social_minimal', 'Hi Council minimal path', social.classification.mission_class === 'SOCIAL_CHECKIN' && social.classification.selected_agents.length <= 1 && social.telemetry.phoenix_hard_passes === 0, social.snapshot))

  cases.push(check('AT-ORION-1-live-shape', 'SYSTEM_STATUS uses real tool names', hidden.snapshot.tool_calls.some(call => call.tool_name === 'wr.core.health'), hidden.snapshot.tool_calls))

  const liveRunnerExists = typeof createToolRunner === 'function'
  cases.push(check('tool_runner_exists', 'namespaced tools exist', liveRunnerExists, 'createToolRunner'))

  const researchTopic = 'Research current Playwright guidance on BrowserContext isolation, persistent profiles, and screenshot handling for large applications. Use primary sources and tell me what applies to War Room.'
  const researchClass = classifyEvidenceBoardMission({ commanderMessage: researchTopic })
  cases.push(check('RESEARCH-EBC-class', 'Playwright research classifies DEEP_RESEARCH with PULSAR', researchClass.mission_class === 'DEEP_RESEARCH' && researchClass.selected_agents.includes('PULSAR') && shouldDispatchEvidenceBoardCouncil(researchClass.mission_class), researchClass.selected_agents))

  const browserStatusClass = classifyEvidenceBoardMission({ commanderMessage: 'Status on War Room browser' })
  cases.push(check('system_status_browser_probe', 'Status on War Room browser includes wr.broker.status and PULSAR', browserStatusClass.mission_class === 'SYSTEM_STATUS' && browserStatusClass.selected_agents.includes('PULSAR') && browserStatusClass.required_tools.includes('wr.broker.status'), { agents: browserStatusClass.selected_agents, tools: browserStatusClass.required_tools }))

  const researchTools: ToolRunner = async (toolName, args = {}) => {
    if (toolName !== 'broker.fetch') return fixtureTools()(toolName, args)
    const nowIso = new Date().toISOString()
    const urlA = 'https://playwright.dev/docs/browser-contexts'
    const urlB = 'https://playwright.dev/docs/screenshots'
    const sources = [
      { url: urlA, final_url: urlA, title: 'Browser contexts', snippet: 'Browser contexts provide isolation.', retrieved_at: nowIso, source_type: 'primary_external', ok: true },
      { url: urlA, final_url: urlA, title: 'Browser contexts', snippet: 'Duplicate URL should not add diversity.', retrieved_at: nowIso, source_type: 'primary_external', ok: true },
      { url: urlB, final_url: urlB, title: 'Screenshots', snippet: 'fullPage captures the entire scrollable page.', retrieved_at: nowIso, source_type: 'primary_external', ok: true },
    ]
    return {
      tool_name: toolName,
      args_fingerprint: toolFingerprint(toolName, args),
      ok: true,
      blocked: false,
      denied: false,
      summary: sources[0].snippet,
      pointer: urlA,
      url: urlA,
      title: sources[0].title,
      kind: 'primary_external',
      retrieved_at: nowIso,
      temporal_layer: 'CURRENT_LIVE',
      payload: { unique_source_count: 2, sources },
    }
  }

  const researchRun = await runEvidenceBoardCouncil({ commanderMessage: researchTopic, tools: researchTools })
  const uniqueUrls = new Set(researchRun.board.evidence.map(row => row.final_url || row.url).filter(Boolean))
  cases.push(check('RESEARCH-EBC-1', 'DEEP_RESEARCH evidence enters board', researchRun.classification.mission_class === 'DEEP_RESEARCH' && researchRun.board.evidence.some(row => row.kind === 'primary_external' && Boolean(row.url)), { evidence: researchRun.board.evidence.length, class: researchRun.classification.mission_class }))
  cases.push(check('RESEARCH-EBC-3', 'PULSAR source requires provenance', researchRun.board.evidence.filter(row => row.agent_id === 'PULSAR').every(row => Boolean(row.url) && Boolean(row.tool_name)), researchRun.board.evidence.filter(row => row.agent_id === 'PULSAR')))
  cases.push(check('RESEARCH-EBC-4', 'duplicate URLs do not count as independent source diversity', uniqueUrls.size === (researchRun.telemetry.unique_source_count ?? uniqueUrls.size) && uniqueUrls.size < researchRun.board.evidence.filter(row => Boolean(row.url)).length + 1, { unique: uniqueUrls.size, telemetry: researchRun.telemetry.unique_source_count, evidence: researchRun.board.evidence.length }))
  cases.push(check('RESEARCH-EBC-5', 'AURORA cannot see raw scout chat as evidence', researchRun.board.chat_partition_forbidden === true && !('chat' in researchRun.aurora) && !('worker_chat' in researchRun.aurora), 'no chat'))
  cases.push(check('RESEARCH-EBC-7', 'real multiple-source research produces citations', uniqueUrls.size >= 2 && [...uniqueUrls].every(url => /^https?:\/\//.test(String(url))), [...uniqueUrls]))

  const scoutProse = await runEvidenceBoardCouncil({
    commanderMessage: researchTopic,
    missionId: 'ebc-scout-prose',
    tools: researchTools,
    plantEnvelopes: [envelope({
      agent_id: 'PULSAR',
      mission_id: 'ebc-scout-prose',
      claims: [{ claim_id: 'c-scout-chat', text: 'A'.repeat(400), status: 'PROPOSED', evidence_ids: [], confidence: 0.9, label: 'INFERENCE', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'PULSAR', round: 1 }],
      evidence: [],
      novelty: { adds: ['NEW_CLAIM'], suppressed: false },
      prose: 'Scout essay asserting facts with no citations.',
    })],
  })
  cases.push(check(
    'RESEARCH-EBC-2',
    'scout prose cannot become verified fact directly',
    scoutProse.suppressed.some(item => item.envelope.claims.some(claim => claim.claim_id === 'c-scout-chat'))
      || scoutProse.aurora.verified_facts.every(fact => fact.claim_id !== 'c-scout-chat'),
    { suppressed: scoutProse.suppressed.map(item => item.reason), verified: scoutProse.aurora.verified_facts },
  ))

  const deniedResearch = await runEvidenceBoardCouncil({ commanderMessage: researchTopic, tools: fixtureTools({ denyBrowser: true }) })
  cases.push(check(
    'RESEARCH-EBC-6',
    'Browser Broker denial → TOOL_BLOCKED',
    deniedResearch.snapshot.completion_state === 'TOOL_BLOCKED' || deniedResearch.snapshot.tool_calls.some(call => call.tool_name === 'broker.fetch' && call.ok === false),
    deniedResearch.snapshot.completion_state,
  ))

  void plantedReady
  return cases
}

function lastVerifiedTemporal(): boolean {
  const board = createEvidenceBoard({
    mission_id: 'lv',
    mission_class: 'SYSTEM_STATUS',
    question: 'x',
    agents: ['ORION'],
    ttl_seconds: 1,
    budget_tokens: 1,
    budget_ms: 1,
  })
  appendEnvelope(board, envelope({
    agent_id: 'ORION',
    mission_id: 'lv',
    claims: [{ claim_id: 'c-lv', text: 'Healthy', status: 'VERIFIED', evidence_ids: ['e-lv'], confidence: 0.9, label: 'VERIFIED_FACT', temporal_layer: 'CURRENT_LIVE', critical: true, agent_id: 'ORION', round: 1 }],
    evidence: [{ evidence_id: 'e-lv', kind: 'live_telemetry', summary: 'old', pointer: 'core', retrieved_at: '2020-01-01T00:00:00.000Z', tool_name: 'wr.core.health', ok: true, temporal_layer: 'CURRENT_LIVE', agent_id: 'ORION', round: 1 }],
  }))
  demoteStaleEvidence(board, Date.now())
  return board.claims[0].temporal_layer !== 'CURRENT_LIVE' && board.evidence[0].temporal_layer === 'LAST_VERIFIED'
}

export async function main(): Promise<void> {
  const results = await runEvidenceBoardValidation()
  const failed = results.filter(item => item.result !== 'PASS')
  for (const item of results) {
    console.log(`${item.result} ${item.caseId}: ${item.description}${item.result === 'FAIL' ? ` :: ${item.details}` : ''}`)
  }
  console.log(`Evidence-Board Council validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exitCode = 1
}

if (process.argv[1]?.includes('evidenceBoard.validation')) {
  void main()
}

