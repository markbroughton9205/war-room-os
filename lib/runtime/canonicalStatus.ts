import 'server-only'

import { stat } from 'node:fs/promises'
import path from 'node:path'

import { collectEngineStatuses, buildEngineControlStatusResponse } from '@/lib/engine-control/status'
import type { EngineControlStatusResponse, EngineId, EngineStatus } from '@/lib/engine-control/types'
import { buildToolRoutingSnapshotFromOrigin } from '@/lib/engine-control/tool-snapshot'
import { listCommanderSnapshot } from '@/lib/commander'
import { getProviderRuntimeHealth, type ProviderRuntimeStatus, type ProviderRuntimeSummary } from '@/lib/providers/health'
import { listRevenueEngineSnapshot } from '@/lib/revenue-engine/persistence'
import { listPersistedSignalSnapshot } from '@/lib/signals'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import type { TruthBoundaryLabel } from '@/lib/runtime/operationalReliabilityTypes'

export type CanonicalRuntimeHealth = 'healthy' | 'degraded' | 'unavailable' | 'unknown'

export type CanonicalSubsystemStatus = {
  id: string
  label: string
  truthBoundary: TruthBoundaryLabel
  health: CanonicalRuntimeHealth
  confidence: number
  evidence: string[]
  missingEvidence: string[]
  downstreamImpact: string[]
  recommendedRecovery: string[]
  lastChecked: string
}

export type CanonicalProviderFamilyStatus = {
  family: 'claude' | 'chatgpt' | 'grok' | 'gemini' | 'kimi' | 'redteam'
  providerId: string
  label: string
  configured: boolean
  connected: boolean
  availability: 'CONFIGURED' | 'CONNECTED' | 'DEGRADED' | 'RATE_LIMITED' | 'INVALID_KEY' | 'NOT_CONFIGURED' | 'UNKNOWN'
  connectionStatus: 'online' | 'standby' | 'error' | 'not_connected'
  health: CanonicalRuntimeHealth
  confidence: number
  evidence: string[]
  missingEvidence: string[]
  lastChecked: string
  responseIntegrityStatus: string
  lastCompleteResponseAt: string | null
  lastIncompleteResponseAt: string | null
  consecutiveIntegrityFailures: number
  retryCount: number
  fallbackUsed: boolean
  degradedReason: string | null
  promptChars: number | null
  completionChars: number | null
  truncationDetected: boolean
  integrityFailureCount: number
  lastRetryStrategy: string | null
}

export type CanonicalRuntimeStatus = {
  generatedAt: string
  subsystems: CanonicalSubsystemStatus[]
  providers: CanonicalProviderFamilyStatus[]
  engineControl: EngineControlStatusResponse
  summary: {
    health: CanonicalRuntimeHealth
    confidence: number
    degradedSubsystems: string[]
    unavailableSubsystems: string[]
    uncertaintyDampening: string
  }
  guardrails: {
    fakeConnectedStates: false
    fakeSourceBackedClaims: false
    apiKeysExposed: false
    hiddenExecution: false
    autonomousFinancialAction: false
    browserShellExecution: false
    deploymentMutation: false
  }
}

const FAMILY_PROVIDER: Record<CanonicalProviderFamilyStatus['family'], { providerId: string; label: string }> = {
  claude: { providerId: 'anthropic', label: 'Anthropic · Claude' },
  chatgpt: { providerId: 'openai', label: 'OpenAI · ChatGPT' },
  grok: { providerId: 'xai', label: 'xAI · Grok' },
  gemini: { providerId: 'google', label: 'Google · Gemini' },
  kimi: { providerId: 'moonshot', label: 'Moonshot · Kimi' },
  redteam: { providerId: 'anthropic', label: 'War Room · Red Team (Claude-backed)' },
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function requestOrigin(req: Request): string | null {
  const url = new URL(req.url)
  return `${url.protocol}//${url.host}`
}

function statusFromProvider(provider: ProviderRuntimeStatus | undefined): Pick<
  CanonicalProviderFamilyStatus,
  'availability' | 'connectionStatus' | 'health' | 'confidence' | 'degradedReason'
> {
  if (!provider) {
    return { availability: 'UNKNOWN', connectionStatus: 'standby', health: 'unknown', confidence: 20, degradedReason: null }
  }
  const integrityDegraded =
    provider.integrity.consecutive_integrity_failures >= 2
    || provider.integrity.response_integrity_status === 'TRUNCATED'
    || provider.integrity.response_integrity_status === 'INCOMPLETE'
    || provider.integrity.response_integrity_status === 'DEGRADED_RESPONSE_QUALITY'
  const degradedReason = provider.integrity.degraded_reason ?? (integrityDegraded ? 'response integrity degraded' : null)
  if (provider.health === 'CONNECTED' && !integrityDegraded) {
    return { availability: 'CONNECTED', connectionStatus: 'online', health: 'healthy', confidence: 95, degradedReason: null }
  }
  if (provider.health === 'CONNECTED' && integrityDegraded) {
    return {
      availability: 'DEGRADED',
      connectionStatus: 'error',
      health: 'degraded',
      confidence: 62,
      degradedReason,
    }
  }
  if (provider.health === 'MISSING_KEY') {
    return { availability: 'NOT_CONFIGURED', connectionStatus: 'not_connected', health: 'unavailable', confidence: 90, degradedReason: null }
  }
  if (provider.health === 'INVALID_KEY') {
    return { availability: 'INVALID_KEY', connectionStatus: 'error', health: 'unavailable', confidence: 90, degradedReason: null }
  }
  if (provider.health === 'RATE_LIMITED') {
    return { availability: 'RATE_LIMITED', connectionStatus: 'error', health: 'degraded', confidence: 80, degradedReason: provider.note }
  }
  return { availability: 'DEGRADED', connectionStatus: 'error', health: 'degraded', confidence: 75, degradedReason: provider.note }
}

export function buildCanonicalProviderFamilies(runtime: ProviderRuntimeSummary): CanonicalProviderFamilyStatus[] {
  const byId = new Map(runtime.providers.map(provider => [provider.id, provider]))
  return (Object.keys(FAMILY_PROVIDER) as CanonicalProviderFamilyStatus['family'][]).map(family => {
    const meta = FAMILY_PROVIDER[family]
    const provider = byId.get(meta.providerId as ProviderRuntimeStatus['id'])
    const status = statusFromProvider(provider)
    const connected = status.availability === 'CONNECTED'
    const integrityConnected =
      connected && (provider?.integrity.consecutive_integrity_failures ?? 0) < 2
    return {
      family,
      providerId: meta.providerId,
      label: integrityConnected
        ? `${meta.label} · live connected`
        : connected
          ? `${meta.label} · reachable, response integrity degraded`
          : provider?.configured
            ? `${meta.label} · configured, live check ${provider.health.toLowerCase()}`
            : `${meta.label} · not configured`,
      configured: Boolean(provider?.configured),
      connected: integrityConnected,
      ...status,
      evidence: provider
        ? [
            `server-side provider probe health=${provider.health}`,
            `transport=${provider.integrity.transport_status}`,
            `response_integrity=${provider.integrity.response_integrity_status}`,
            `configured=${provider.configured}`,
            `checkedAt=${provider.checkedAt}`,
          ]
        : ['No canonical provider probe row was present.'],
      missingEvidence: integrityConnected
        ? []
        : [
            connected
              ? 'Provider probe connected but recent council responses failed integrity checks.'
              : 'No successful live provider response for this family in the current canonical snapshot.',
          ],
      lastChecked: provider?.checkedAt ?? runtime.generatedAt,
      responseIntegrityStatus: provider?.integrity.response_integrity_status ?? 'UNKNOWN',
      lastCompleteResponseAt: provider?.integrity.last_complete_response_at ?? null,
      lastIncompleteResponseAt: provider?.integrity.last_incomplete_response_at ?? null,
      consecutiveIntegrityFailures: provider?.integrity.consecutive_integrity_failures ?? 0,
      retryCount: provider?.integrity.retry_count ?? 0,
      fallbackUsed: provider?.integrity.fallback_used ?? false,
      promptChars: provider?.integrity.diagnostics?.prompt_chars ?? null,
      completionChars: provider?.integrity.diagnostics?.completion_chars ?? null,
      truncationDetected: provider?.integrity.diagnostics?.truncation_detected ?? false,
      integrityFailureCount: provider?.integrity.diagnostics?.integrity_failures ?? 0,
      lastRetryStrategy: provider?.integrity.diagnostics?.last_retry_strategy ?? null,
    }
  })
}

function providerSubsystem(runtime: ProviderRuntimeSummary, providers: CanonicalProviderFamilyStatus[], now: string): CanonicalSubsystemStatus {
  const required = providers.filter(provider => provider.family !== 'redteam')
  const connected = required.filter(provider => provider.connected)
  const configured = required.filter(provider => provider.configured)
  const health: CanonicalRuntimeHealth =
    connected.length === required.length
      ? 'healthy'
      : connected.length > 0 || configured.length > 0
        ? 'degraded'
        : 'unavailable'
  return {
    id: 'provider_runtime',
    label: 'Provider Runtime',
    truthBoundary: health === 'healthy' ? 'VERIFIED' : health === 'unavailable' ? 'UNAVAILABLE' : 'DEGRADED',
    health,
    confidence: clampConfidence(required.reduce((sum, provider) => sum + provider.confidence, 0) / Math.max(1, required.length)),
    evidence: [
      `${connected.length}/${required.length} cloud provider families live connected.`,
      `${configured.length}/${required.length} cloud provider families configured.`,
      `Provider runtime generated ${runtime.generatedAt}.`,
    ],
    missingEvidence: connected.length === required.length ? [] : ['One or more live provider probes did not return CONNECTED.'],
    downstreamImpact: ['Council attendance', 'Baby AI', 'Commander OS', 'Daily Briefing'],
    recommendedRecovery: ['Repair keys, quotas, or provider reachability; then refresh canonical runtime status.'],
    lastChecked: now,
  }
}

export function normalizeEngineControlPayload(input: unknown, fallbackTimestamp = new Date().toISOString()): EngineControlStatusResponse {
  const candidate = input && typeof input === 'object' ? input as Partial<EngineControlStatusResponse> : {}
  const engines = Array.isArray(candidate.engines) ? candidate.engines.filter(Boolean) as EngineStatus[] : []
  const response = buildEngineControlStatusResponse(engines)
  return {
    ...response,
    configuredProviders: Array.isArray(candidate.configuredProviders) ? candidate.configuredProviders as EngineId[] : response.configuredProviders,
    reachableProviders: Array.isArray(candidate.reachableProviders) ? candidate.reachableProviders as EngineId[] : response.reachableProviders,
    functionalProviders: Array.isArray(candidate.functionalProviders) ? candidate.functionalProviders as EngineId[] : response.functionalProviders,
    routingReadiness: candidate.routingReadiness ?? response.routingReadiness,
    approvalRequired: typeof candidate.approvalRequired === 'boolean' ? candidate.approvalRequired : response.approvalRequired,
    timestamp: typeof candidate.timestamp === 'string' ? candidate.timestamp : fallbackTimestamp,
    checkedAt: typeof candidate.checkedAt === 'string' ? candidate.checkedAt : fallbackTimestamp,
    degradedReason: typeof candidate.degradedReason === 'string' || candidate.degradedReason === null ? candidate.degradedReason : response.degradedReason,
  }
}

function engineSubsystem(engineControl: EngineControlStatusResponse): CanonicalSubsystemStatus {
  const health: CanonicalRuntimeHealth =
    engineControl.routingReadiness === 'ready'
      ? 'healthy'
      : engineControl.routingReadiness === 'degraded'
        ? 'degraded'
        : 'unavailable'
  return {
    id: 'engine_control',
    label: 'Engine Control',
    truthBoundary: health === 'healthy' ? 'VERIFIED' : health === 'unavailable' ? 'UNAVAILABLE' : 'DEGRADED',
    health,
    confidence: engineControl.engines.length ? (health === 'healthy' ? 95 : 70) : 25,
    evidence: [
      `${engineControl.functionalProviders.length}/${engineControl.engines.length} engines functional.`,
      `routingReadiness=${engineControl.routingReadiness}`,
      `approvalRequired=${engineControl.approvalRequired}`,
    ],
    missingEvidence: engineControl.engines.length ? [] : ['Structured engine list missing or empty.'],
    downstreamImpact: ['Council routing', 'provider attendance preflight', 'runtime diagnostics'],
    recommendedRecovery: [engineControl.degradedReason ?? 'Repair live provider checks or engine routing configuration.'],
    lastChecked: engineControl.timestamp,
  }
}

async function probeActionQueue(now: string): Promise<{ actionQueue: CanonicalSubsystemStatus; approvalGate: CanonicalSubsystemStatus; persistence: CanonicalSubsystemStatus }> {
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    const unavailable = (id: string, label: string, impact: string[]): CanonicalSubsystemStatus => ({
      id,
      label,
      truthBoundary: 'UNAVAILABLE',
      health: 'unavailable',
      confidence: 85,
      evidence: ['Supabase admin client is not configured.'],
      missingEvidence: ['Could not read War Room persistence tables.'],
      downstreamImpact: impact,
      recommendedRecovery: ['Restore Supabase server credentials and table grants.'],
      lastChecked: now,
    })
    return {
      actionQueue: unavailable('action_queue', 'Action Queue', ['Approval visibility', 'Commander OS', 'Feature Builder']),
      approvalGate: unavailable('approval_gate', 'Approval Gate', ['No system can claim execution approval.']),
      persistence: unavailable('persistence', 'Persistence', ['Council memory', 'runtime snapshots', 'outcomes']),
    }
  }

  const [actions, conversations, messages, audit, memory] = await Promise.all([
    supabase.client.from('war_room_actions').select('id,approval_granted').limit(1),
    supabase.client.from('war_room_conversations').select('id').limit(1),
    supabase.client.from('war_room_messages').select('id').limit(1),
    supabase.client.from('war_room_audit_logs').select('id').limit(1),
    supabase.client.from('war_room_memory_proposals').select('id').limit(1),
  ])
  const persistenceErrors = [actions.error, conversations.error, messages.error, audit.error, memory.error].filter(Boolean)
  const queueOk = !actions.error
  const persistenceOk = persistenceErrors.length === 0
  return {
    actionQueue: {
      id: 'action_queue',
      label: 'Action Queue',
      truthBoundary: queueOk ? 'VERIFIED' : 'UNAVAILABLE',
      health: queueOk ? 'healthy' : 'unavailable',
      confidence: queueOk ? 95 : 70,
      evidence: [queueOk ? 'Read war_room_actions succeeded.' : `Action queue read failed: ${actions.error?.message ?? 'unknown error'}`],
      missingEvidence: queueOk ? [] : ['Action queue table was not readable.'],
      downstreamImpact: ['Approval visibility', 'Commander OS', 'Feature Builder'],
      recommendedRecovery: queueOk ? ['Continue enforcing approval-required writes.'] : ['Repair war_room_actions migration or grants.'],
      lastChecked: now,
    },
    approvalGate: {
      id: 'approval_gate',
      label: 'Approval Gate',
      truthBoundary: queueOk ? 'VERIFIED' : 'UNAVAILABLE',
      health: queueOk ? 'healthy' : 'unavailable',
      confidence: queueOk ? 95 : 70,
      evidence: [queueOk ? 'approval_granted column readable; new actions remain approval-gated.' : 'Approval queue table unavailable.'],
      missingEvidence: queueOk ? [] : ['Cannot verify approval_granted state.'],
      downstreamImpact: ['External actions remain blocked unless explicit approval is persisted.'],
      recommendedRecovery: queueOk ? ['No recovery needed; keep approval checks explicit.'] : ['Repair approval queue persistence before claiming approvals.'],
      lastChecked: now,
    },
    persistence: {
      id: 'persistence',
      label: 'Persistence',
      truthBoundary: persistenceOk ? 'VERIFIED' : 'DEGRADED',
      health: persistenceOk ? 'healthy' : 'degraded',
      confidence: persistenceOk ? 95 : 65,
      evidence: [`${5 - persistenceErrors.length}/5 core persistence probes readable.`],
      missingEvidence: persistenceOk ? [] : persistenceErrors.map(error => error?.message ?? 'Unknown persistence error'),
      downstreamImpact: ['Runtime snapshots', 'conversation memory', 'actions', 'audits'],
      recommendedRecovery: persistenceOk ? ['No recovery needed.'] : ['Apply missing migrations and reload Supabase schema cache.'],
      lastChecked: now,
    },
  }
}

async function redSentinelSubsystem(now: string): Promise<CanonicalSubsystemStatus> {
  let scanAvailable = true
  try {
    await stat(path.join(process.cwd(), 'package.json'))
  } catch {
    scanAvailable = false
  }
  const supabase = tryWarRoomSupabase()
  let lastScanAt: string | null = null
  let findings = 0
  if (supabase.ok) {
    const { data } = await supabase.client
      .from('war_room_sentinel_scans')
      .select('created_at,findings_count')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    lastScanAt = typeof data?.created_at === 'string' ? data.created_at : null
    findings = typeof data?.findings_count === 'number' ? data.findings_count : 0
  }
  const health: CanonicalRuntimeHealth = scanAvailable ? (supabase.ok ? 'healthy' : 'degraded') : 'unavailable'
  return {
    id: 'red_sentinel',
    label: 'Red Sentinel',
    truthBoundary: health === 'healthy' ? 'VERIFIED' : health === 'unavailable' ? 'UNAVAILABLE' : 'DEGRADED',
    health,
    confidence: health === 'healthy' ? 90 : health === 'degraded' ? 60 : 40,
    evidence: [`scanAvailable=${scanAvailable}`, `persistence=${supabase.ok}`, `lastScanAt=${lastScanAt ?? 'none'}`, `findings=${findings}`],
    missingEvidence: lastScanAt ? [] : ['No persisted Sentinel scan timestamp found.'],
    downstreamImpact: ['Engineering Lane', 'Feature Builder risk review'],
    recommendedRecovery: lastScanAt ? ['Review current Sentinel findings before code mutation.'] : ['Run a bounded Sentinel scan after persistence is available.'],
    lastChecked: now,
  }
}

function dampenedComposite(input: {
  id: string
  label: string
  healthy: boolean
  unavailable: boolean
  confidence: number
  evidence: string[]
  missingEvidence: string[]
  downstreamImpact: string[]
  recommendedRecovery: string[]
  lastChecked: string
  truthWhenHealthy?: TruthBoundaryLabel
}): CanonicalSubsystemStatus {
  const health: CanonicalRuntimeHealth = input.healthy ? 'healthy' : input.unavailable ? 'unavailable' : 'degraded'
  return {
    id: input.id,
    label: input.label,
    truthBoundary: input.healthy ? input.truthWhenHealthy ?? 'SOURCE_BACKED' : input.unavailable ? 'UNAVAILABLE' : 'ADVISORY',
    health,
    confidence: clampConfidence(input.confidence - input.missingEvidence.length * 10),
    evidence: input.evidence,
    missingEvidence: input.missingEvidence,
    downstreamImpact: input.downstreamImpact,
    recommendedRecovery: input.recommendedRecovery,
    lastChecked: input.lastChecked,
  }
}

export async function collectCanonicalRuntimeStatus(req: Request): Promise<CanonicalRuntimeStatus> {
  const generatedAt = new Date().toISOString()
  const providerRuntime = await getProviderRuntimeHealth({ force: new URL(req.url).searchParams.get('refresh') === '1' })
  const providers = buildCanonicalProviderFamilies(providerRuntime)
  const tools = await buildToolRoutingSnapshotFromOrigin(requestOrigin(req))
  const engines = await collectEngineStatuses(tools)
  const engineControl = normalizeEngineControlPayload(buildEngineControlStatusResponse(engines), generatedAt)
  const [signals, revenue, commander, queue, sentinel] = await Promise.all([
    listPersistedSignalSnapshot(12),
    listRevenueEngineSnapshot(20),
    listCommanderSnapshot(20),
    probeActionQueue(generatedAt),
    redSentinelSubsystem(generatedAt),
  ])

  const liveSignalProvider = providerRuntime.signalAvailability.liveSignalsAvailable
  const signalReady = signals.migrationStatus === 'READY' && liveSignalProvider
  const signalUnavailable = signals.migrationStatus === 'MIGRATION_REQUIRED' || signals.migrationStatus === 'UNAVAILABLE'
  const signalSubsystem = dampenedComposite({
    id: 'signal_radar',
    label: 'Signal Radar',
    healthy: signalReady,
    unavailable: signalUnavailable,
    confidence: signalReady ? 90 : signalUnavailable ? 45 : 65,
    evidence: [
      `migrationStatus=${signals.migrationStatus}`,
      `persistenceAvailable=${signals.persistenceAvailable}`,
      `liveSignalProvider=${liveSignalProvider}`,
      `results=${signals.results.length}`,
    ],
    missingEvidence: [
      ...(liveSignalProvider ? [] : ['No live Tavily or Firecrawl provider is connected.']),
      ...(signals.migrationStatus === 'READY' ? [] : ['Signal persistence migration/status is not READY.']),
    ],
    downstreamImpact: ['Revenue Engine', 'Daily Briefing', 'Growth Calendar'],
    recommendedRecovery: ['Apply missing signal migrations if needed; restore at least one live signal provider.'],
    lastChecked: signals.generatedAt,
  })

  const revenueSubsystem = dampenedComposite({
    id: 'revenue_engine',
    label: 'Revenue Engine',
    healthy: revenue.persistenceAvailable && signalReady,
    unavailable: false,
    confidence: revenue.persistenceAvailable ? (signalReady ? 85 : 60) : 45,
    evidence: [
      `persistenceAvailable=${revenue.persistenceAvailable}`,
      `activeOpportunities=${revenue.stats.activeOpportunities}`,
      `recommendationOnly=${revenue.guardrails.recommendationOnly}`,
      `fakeIncomeClaims=${revenue.guardrails.fakeIncomeClaims}`,
    ],
    missingEvidence: signalReady ? [] : ['Fresh source-backed signals are not fully available; revenue output stays advisory.'],
    downstreamImpact: ['Commander OS', 'Daily Briefing'],
    recommendedRecovery: ['Restore Signal Radar before treating revenue confidence as source-backed.'],
    lastChecked: revenue.generatedAt,
  })

  const providerHealthy = providers.filter(provider => provider.family !== 'redteam').every(provider => provider.connected)
  const commanderSubsystem = dampenedComposite({
    id: 'commander_os',
    label: 'Commander OS',
    healthy: commander.persistenceAvailable && providerHealthy && queue.approvalGate.health === 'healthy',
    unavailable: false,
    confidence: commander.persistenceAvailable ? (providerHealthy ? 80 : 55) : 45,
    evidence: [
      `persistenceAvailable=${commander.persistenceAvailable}`,
      `providerRuntime=${providerHealthy ? 'connected' : 'degraded'}`,
      `approvalGate=${queue.approvalGate.health}`,
    ],
    missingEvidence: [
      ...(providerHealthy ? [] : ['One or more provider families lack CONNECTED live evidence.']),
      ...(queue.approvalGate.health === 'healthy' ? [] : ['Approval gate persistence is not verified.']),
    ],
    downstreamImpact: ['Daily Briefing', 'action recommendations'],
    recommendedRecovery: ['Restore provider runtime and approval gate before raising Commander OS confidence.'],
    lastChecked: commander.generatedAt,
  })

  const babyAiSubsystem = dampenedComposite({
    id: 'baby_ai',
    label: 'Baby AI',
    healthy: providerHealthy && queue.persistence.health !== 'unavailable',
    unavailable: false,
    confidence: providerHealthy ? 70 : 45,
    evidence: ['Baby AI is experimental, read-only, and approval-gated.', `providerRuntime=${providerHealthy ? 'connected' : 'degraded'}`],
    missingEvidence: providerHealthy ? [] : ['Provider runtime does not have CONNECTED evidence for every cloud family.'],
    downstreamImpact: ['Daily Briefing', 'council observer notes'],
    recommendedRecovery: ['Keep Baby AI outputs experimental until provider runtime recovers.'],
    lastChecked: generatedAt,
    truthWhenHealthy: 'EXPERIMENTAL',
  })

  const dailyBriefingSubsystem = dampenedComposite({
    id: 'daily_briefing',
    label: 'Daily Briefing',
    healthy: providerHealthy && signalReady && babyAiSubsystem.health === 'healthy',
    unavailable: false,
    confidence: providerHealthy && signalReady ? 75 : 45,
    evidence: [`providers=${providerHealthy ? 'connected' : 'degraded'}`, `signals=${signalSubsystem.health}`, `babyAi=${babyAiSubsystem.health}`],
    missingEvidence: [
      ...(providerHealthy ? [] : ['Provider runtime is not fully CONNECTED.']),
      ...(signalReady ? [] : ['Signal Radar is not fully source-backed.']),
    ],
    downstreamImpact: ['Operator briefings'],
    recommendedRecovery: ['Label briefing sections advisory until providers and signals are verified.'],
    lastChecked: generatedAt,
  })

  const subsystems = [
    providerSubsystem(providerRuntime, providers, generatedAt),
    engineSubsystem(engineControl),
    signalSubsystem,
    revenueSubsystem,
    commanderSubsystem,
    queue.actionQueue,
    queue.approvalGate,
    queue.persistence,
    sentinel,
    babyAiSubsystem,
    dailyBriefingSubsystem,
  ]
  const degradedSubsystems = subsystems.filter(subsystem => subsystem.health === 'degraded' || subsystem.health === 'unknown').map(subsystem => subsystem.id)
  const unavailableSubsystems = subsystems.filter(subsystem => subsystem.health === 'unavailable').map(subsystem => subsystem.id)
  const confidence = clampConfidence(subsystems.reduce((sum, subsystem) => sum + subsystem.confidence, 0) / Math.max(1, subsystems.length))
  return {
    generatedAt,
    subsystems,
    providers,
    engineControl,
    summary: {
      health: unavailableSubsystems.length ? 'degraded' : degradedSubsystems.length ? 'degraded' : 'healthy',
      confidence,
      degradedSubsystems,
      unavailableSubsystems,
      uncertaintyDampening: 'Missing telemetry lowers confidence and marks UNKNOWN/UNAVAILABLE; it is not treated as observed danger without evidence.',
    },
    guardrails: {
      fakeConnectedStates: false,
      fakeSourceBackedClaims: false,
      apiKeysExposed: false,
      hiddenExecution: false,
      autonomousFinancialAction: false,
      browserShellExecution: false,
      deploymentMutation: false,
    },
  }
}
