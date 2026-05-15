import type {
  OverallStatus,
  SubsystemRow,
  SubsystemOperationalStatus,
  TruthLevel,
} from '@/lib/runtime/runtimeIntegrityTypes'

function riskForStatus(status: SubsystemOperationalStatus): SubsystemRow['risk'] {
  if (status === 'FAILING' || status === 'UNWIRED') return 'high'
  if (status === 'DEGRADED' || status === 'UNKNOWN') return 'medium'
  return 'low'
}

function row(
  partial: Omit<SubsystemRow, 'risk'> & { risk?: SubsystemRow['risk'] },
): SubsystemRow {
  return { ...partial, risk: partial.risk ?? riskForStatus(partial.status) }
}

/** Collapse subsystem states into a single headline status. */
export function computeOverallStatus(subsystems: SubsystemRow[]): OverallStatus {
  if (!subsystems.length) return 'UNKNOWN'
  const rank: Record<OverallStatus, number> = {
    FAILING: 5,
    DEGRADED: 4,
    PARTIAL: 3,
    UNKNOWN: 2,
    HEALTHY: 1,
  }
  let worst: OverallStatus = 'HEALTHY'
  for (const s of subsystems) {
    let o: OverallStatus
    if (s.status === 'FAILING') o = 'FAILING'
    else if (s.status === 'DEGRADED' || s.status === 'MOCK') o = 'DEGRADED'
    else if (s.status === 'UNWIRED' || s.status === 'UNKNOWN') o = 'PARTIAL'
    else if (s.status === 'CONFIGURED_ONLY') o = 'PARTIAL'
    else o = 'HEALTHY'
    if (rank[o] > rank[worst]) worst = o
  }
  return worst
}

export function mapEngineControlJson(json: unknown): SubsystemRow {
  const j = json as {
    engines?: { functional?: boolean; reachable?: boolean; configured?: boolean; id?: string }[]
    checkedAt?: string
  }
  const engines = Array.isArray(j.engines) ? j.engines : []
  const configured = engines.filter(e => e.configured).length
  const functional = engines.filter(e => e.functional).length
  const reachable = engines.filter(e => e.reachable).length
  const evidence = engines.length
    ? `${functional}/${engines.length} engines report functional; ${configured} configured; ${reachable} reachable. Checked ${j.checkedAt ?? 'n/a'}.`
    : 'Engine status payload missing engine list.'

  let status: SubsystemOperationalStatus = 'UNKNOWN'
  let truth: TruthLevel = 'UNKNOWN'
  if (!engines.length) {
    status = 'FAILING'
    truth = 'UNKNOWN'
  } else if (functional === engines.length) {
    status = 'HEALTHY'
    truth = 'VERIFIED'
  } else if (functional > 0) {
    status = 'DEGRADED'
    truth = 'VERIFIED'
  } else if (configured > 0) {
    status = 'DEGRADED'
    truth = 'PARTIAL'
  } else {
    status = 'UNWIRED'
    truth = 'DECLARED'
  }

  return row({
    id: 'engine_control',
    label: 'Engine control',
    status,
    truthLevel: truth,
    evidence,
    source: 'fetch',
    mock: false,
    unwired: configured === 0,
    configured: configured > 0,
    reachable: reachable > 0,
    recommendation:
      functional > 0
        ? 'Re-check /api/engine-control/status after changing local runtimes or API keys.'
        : 'Configure or repair at least one council engine (see Engine Control checklist).',
  })
}

export function mapProvidersHealthJson(json: unknown): SubsystemRow {
  const j = json as {
    availability?: Record<string, string>
    tool?: string
    status?: string
  }
  const av = j.availability && typeof j.availability === 'object' ? j.availability : {}
  const keys = Object.keys(av)
  const configured = keys.filter(k => av[k] === 'configured').length
  const notConfigured = keys.filter(k => av[k] === 'not_configured').length
  const evidence = keys.length
    ? `Credential hints: ${configured} configured provider slots, ${notConfigured} missing keys (declared only, no live LLM probe in this route).`
    : 'Provider health response missing availability map.'

  return row({
    id: 'providers_health',
    label: 'Provider configuration',
    status: configured > 0 ? 'CONFIGURED_ONLY' : 'UNWIRED',
    truthLevel: 'DECLARED',
    evidence,
    source: 'fetch',
    mock: false,
    unwired: configured === 0,
    configured: configured > 0,
    reachable: false,
    recommendation:
      'Use /api/engine-control/status for live functional probes; this route is configuration hints only.',
  })
}

export function mapRedSentinelJson(json: unknown): SubsystemRow {
  const j = json as {
    lastScanAt?: string | null
    scanAvailable?: boolean
    persistence?: boolean | string
    lastFindingsCount?: number
  }
  const persistenceOk =
    j.persistence === true || j.persistence === 'available' || j.persistence === 'ok'
  const evidence = [
    typeof j.lastScanAt === 'string' ? `lastScanAt=${j.lastScanAt}` : 'no last scan timestamp',
    `scanAvailable=${Boolean(j.scanAvailable)}`,
    `persistence=${String(j.persistence)}`,
    typeof j.lastFindingsCount === 'number' ? `findings=${j.lastFindingsCount}` : '',
  ]
    .filter(Boolean)
    .join('; ')

  const status: SubsystemOperationalStatus =
    j.scanAvailable === false ? 'DEGRADED' : persistenceOk ? 'HEALTHY' : 'DEGRADED'
  const truth: TruthLevel = j.scanAvailable ? 'VERIFIED' : 'PARTIAL'

  return row({
    id: 'red_sentinel',
    label: 'Red Sentinel (repo scan)',
    status,
    truthLevel: truth,
    evidence,
    source: 'fetch',
    mock: false,
    unwired: false,
    configured: true,
    reachable: j.scanAvailable !== false,
    recommendation: persistenceOk
      ? 'Review latest Sentinel scan findings in War Room tools.'
      : 'Enable Supabase persistence for scan history.',
  })
}

export function mapRedTeamCoderJson(json: unknown): SubsystemRow {
  const j = json as {
    status?: string
    persistence?: string
    message?: string
    approvalRequired?: boolean
  }
  const persistenceOk = j.persistence === 'available'
  const evidence =
    [j.status && `status=${j.status}`, j.message && j.message.slice(0, 200)].filter(Boolean).join(' · ') || 'red-team-coder status'

  const status: SubsystemOperationalStatus = j.status === 'error' ? 'DEGRADED' : persistenceOk ? 'HEALTHY' : 'DEGRADED'

  return row({
    id: 'red_team_coder',
    label: 'Red Team Coder',
    status,
    truthLevel: persistenceOk ? 'PARTIAL' : 'DECLARED',
    evidence,
    source: 'fetch',
    mock: false,
    unwired: !persistenceOk,
    configured: persistenceOk,
    reachable: persistenceOk,
    recommendation: 'Repairs require explicit approval in the action queue; no autonomous execution.',
  })
}

export function mapInternetStatusJson(json: unknown, httpStatus: number): SubsystemRow {
  if (httpStatus === 429) {
    return row({
      id: 'internet_layer',
      label: 'Internet / research layer',
      status: 'DEGRADED',
      truthLevel: 'PARTIAL',
      evidence: 'Rate limited (429) while building internet layer snapshot.',
      source: 'fetch',
      mock: false,
      unwired: false,
      configured: true,
      reachable: false,
      recommendation: 'Retry after Cooldown; workers limit protects the host.',
    })
  }

  const j = json as { error?: string; lastChecked?: string }
  if (typeof j.error === 'string') {
    return row({
      id: 'internet_layer',
      label: 'Internet / research layer',
      status: 'FAILING',
      truthLevel: 'UNKNOWN',
      evidence: j.error,
      source: 'fetch',
      mock: false,
      unwired: false,
      configured: false,
      reachable: false,
      recommendation: 'Check internet tool keys and resource limits.',
    })
  }

  const evidence = typeof j.lastChecked === 'string' ? `lastChecked=${j.lastChecked}` : 'internet layer snapshot present'

  return row({
    id: 'internet_layer',
    label: 'Internet / research layer',
    status: 'HEALTHY',
    truthLevel: 'VERIFIED',
    evidence,
    source: 'fetch',
    mock: false,
    unwired: false,
    configured: true,
    reachable: true,
    recommendation: 'If research fails in council, confirm rate limits and keys for Tavily / Firecrawl as configured.',
  })
}

export function mapLocalAgentJson(json: unknown): SubsystemRow {
  const j = json as {
    bridge?: string
    checkedAt?: string
    selectedEngine?: string | null
    engines?: Record<string, { functional?: boolean; status?: string }>
  }
  const engines = j.engines && typeof j.engines === 'object' ? Object.values(j.engines) : []
  const functional = engines.filter(e => e.functional).length
  const evidence = `bridge=${j.bridge ?? 'unknown'}; selectedEngine=${j.selectedEngine ?? 'none'}; functionalEntries=${functional}; checkedAt=${j.checkedAt ?? 'n/a'}`

  let status: SubsystemOperationalStatus = 'UNKNOWN'
  if (j.bridge === 'online') {
    status = functional > 0 ? 'HEALTHY' : 'DEGRADED'
  } else if (j.bridge === 'config_needed') {
    status = 'CONFIGURED_ONLY'
  } else if (j.bridge === 'error') {
    status = 'FAILING'
  } else {
    status = 'DEGRADED'
  }

  return row({
    id: 'local_agent',
    label: 'Local agent bridge',
    status,
    truthLevel: functional > 0 ? 'VERIFIED' : 'DECLARED',
    evidence,
    source: 'fetch',
    mock: false,
    unwired: j.bridge === 'config_needed',
    configured: j.bridge !== 'config_needed',
    reachable: j.bridge === 'online',
    recommendation: 'Moonshot/Kimi and Bridge Architect use /api/local-agent/invoke when this bridge is functional.',
  })
}

export function mapDeployStatusJson(json: unknown): SubsystemRow {
  const j = json as { error?: string; checkedAt?: string; runtime?: string; engines?: unknown[] }
  if (typeof j.error === 'string') {
    return row({
      id: 'deploy_status',
      label: 'Deploy/runtime bundle',
      status: 'FAILING',
      truthLevel: 'UNKNOWN',
      evidence: j.error,
      source: 'fetch',
      mock: false,
      unwired: false,
      configured: false,
      reachable: false,
      recommendation: 'See server logs; deploy status aggregates multiple probes.',
    })
  }

  const engines = Array.isArray(j.engines) ? j.engines : []
  const evidence = `${engines.length} engines summarized in deploy payload; runtime=${j.runtime ?? 'n/a'}; checkedAt=${j.checkedAt ?? 'n/a'}`

  return row({
    id: 'deploy_status',
    label: 'Deploy/runtime bundle',
    status: engines.length ? 'HEALTHY' : 'UNKNOWN',
    truthLevel: 'VERIFIED',
    evidence,
    source: 'fetch',
    mock: false,
    unwired: false,
    configured: true,
    reachable: true,
    recommendation: 'Use alongside Engine Control for redundant visibility during rollout verification.',
  })
}

export type SupabaseProbe = { ok: boolean; error?: string; hasRows?: boolean }

export function mapActionQueueProbe(probe: SupabaseProbe): SubsystemRow {
  const evidence = probe.ok
    ? probe.hasRows
      ? 'Read `war_room_actions` (limit 1) succeeded; table reachable.'
      : 'Read `war_room_actions` succeeded (zero rows is valid).'
    : probe.error ?? 'Supabase unavailable.'

  const status: SubsystemOperationalStatus = probe.ok ? 'HEALTHY' : 'FAILING'
  const truth: TruthLevel = probe.ok ? 'VERIFIED' : 'UNKNOWN'

  return row({
    id: 'action_queue',
    label: 'Action queue (Supabase)',
    status,
    truthLevel: truth,
    evidence,
    source: 'supabase',
    mock: false,
    unwired: !probe.ok,
    configured: probe.ok,
    reachable: probe.ok,
    recommendation: probe.ok ? 'Queued work uses approval gates; no auto-execution.' : 'Check Supabase credentials and RLS for service role.',
  })
}

export function mapConversationsProbe(probe: SupabaseProbe): SubsystemRow {
  const evidence = probe.ok
    ? 'Read `war_room_conversations` (limit 1) succeeded.'
    : probe.error ?? 'Supabase unavailable.'

  return row({
    id: 'supabase_conversations',
    label: 'Conversation persistence',
    status: probe.ok ? 'HEALTHY' : 'FAILING',
    truthLevel: probe.ok ? 'VERIFIED' : 'UNKNOWN',
    evidence,
    source: 'supabase',
    mock: false,
    unwired: !probe.ok,
    configured: probe.ok,
    reachable: probe.ok,
    recommendation: probe.ok ? 'Thread store is reachable for council dual-write paths.' : 'Repair Supabase grants for `war_room_conversations`.',
  })
}

export function mapMemoryProbe(probe: SupabaseProbe): SubsystemRow {
  const evidence = probe.ok
    ? 'Read `war_room_memory_proposals` (limit 1) succeeded.'
    : probe.error ?? 'Supabase unavailable.'

  return row({
    id: 'memory_proposals',
    label: 'Chronicle / memory proposals',
    status: probe.ok ? 'HEALTHY' : 'DEGRADED',
    truthLevel: probe.ok ? 'VERIFIED' : 'UNKNOWN',
    evidence,
    source: 'supabase',
    mock: false,
    unwired: !probe.ok,
    configured: probe.ok,
    reachable: probe.ok,
    recommendation: probe.ok ? 'Memory ingest paths can persist proposals for approval.' : 'Memory tables may be missing migrations or grants.',
  })
}

export function mapOrchestrationState(depth: number): SubsystemRow {
  const evidence = `In-memory orchestration queue depth=${depth} (process local).`

  return row({
    id: 'orchestration',
    label: 'Task orchestrator',
    status: 'UNKNOWN',
    truthLevel: 'DECLARED',
    evidence,
    source: 'import',
    mock: false,
    unwired: false,
    configured: true,
    reachable: true,
    recommendation:
      'Queue depth is declarative only; use /api/orchestration/task for enqueue semantics (requires approvals per policy).',
  })
}
