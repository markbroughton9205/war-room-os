import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { annotateEvidenceIndependence, clusterIndependentEvidence } from '@/lib/intelligence/sourceIndependence'
import type { LiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'
import { isCurrentRoundIdentity, mapWithConcurrency } from './governor'
import type { RoundIdentity, ScoutAbortReason, ScoutMetadata, ScoutPlan } from './types'

export type ScoutExecutionDeps = {
  signal?: AbortSignal
  perScoutTimeoutMs: number
  phaseTimeoutMs?: number
  maxConcurrentWeb: number
  getCurrentRoundIdentity: () => RoundIdentity
  runLiveResearch?: (query: string, scout?: ScoutPlan) => Promise<LiveResearchEvidencePacket>
  runtimeGrounding?: string
}

export function composeAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const live = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (live.length === 0) return undefined
  if (live.length === 1) return live[0]
  return AbortSignal.any(live)
}

function timeoutSignal(ms: number, parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return parent ? AbortSignal.any([parent, timeout]) : timeout
}

function runtimeEvidence(scout: ScoutPlan, grounding: string, nowIso: string): IntelligenceEvidenceItem[] {
  if (!grounding.trim()) return []
  return [{
    id: `runtime-${scout.scoutId}`,
    source_id: 'war_room_runtime',
    source_type: 'logistics',
    source_label: 'War Room runtime/repo telemetry',
    verified_level: 'semi_verified',
    title: `${scout.scoutType} local truth`,
    claim: grounding.slice(0, 400),
    content: grounding.slice(0, 2000),
    observed_at: nowIso,
    confidence: 0.7,
    confidence_tier: 'corroborated',
    corroboration_count: 1,
    freshness: 'live',
    source_reputation: 0.8,
    contradiction_flags: [],
    evidence_density: 0.4,
    related_evidence_links: [],
    weak_signal: false,
    origin_type: 'RUNTIME_TELEMETRY',
  }]
}

export type ScoutExecutionResult = {
  metadata: ScoutMetadata
  evidence: IntelligenceEvidenceItem[]
}

function emptyResult(
  scout: ScoutPlan,
  startedAt: string,
  flags: { aborted?: boolean; timeout?: boolean; stale?: boolean; abortReason?: ScoutAbortReason; findings?: string },
): ScoutExecutionResult {
  return {
    evidence: [],
    metadata: {
      scoutId: scout.scoutId,
      scoutType: scout.scoutType,
      seatId: scout.seatId,
      agentId: scout.agentId,
      missionId: scout.missionId,
      roundRequestId: scout.roundRequestId,
      logicalRequestId: scout.logicalRequestId,
      query: scout.query,
      assignment: scout.assignment,
      region: scout.region,
      provider: scout.preferLocalTruth ? 'runtime_local' : 'live_research_router',
      resultCount: 0,
      evidenceIds: [],
      findings: flags.findings ?? '',
      uncertainties: [],
      confidence: null,
      startedAt,
      completedAt: new Date().toISOString(),
      aborted: flags.aborted ?? false,
      staleDiscarded: flags.stale ?? false,
      timeout: flags.timeout ?? false,
      languageAccess: scout.languageAccess,
      abortReason: flags.abortReason,
      preferredProviders: scout.preferredProviders,
      queryLanguage: scout.queryLanguage,
    },
  }
}

export async function executeScout(scout: ScoutPlan, deps: ScoutExecutionDeps): Promise<ScoutExecutionResult> {
  const startedAt = new Date().toISOString()
  const current = deps.getCurrentRoundIdentity()
  const stale = !isCurrentRoundIdentity(current, {
    missionId: scout.missionId,
    roundRequestId: scout.roundRequestId,
    logicalRequestId: scout.logicalRequestId,
  })
  const baseMeta: ScoutMetadata = {
    scoutId: scout.scoutId,
    scoutType: scout.scoutType,
    seatId: scout.seatId,
    agentId: scout.agentId,
    missionId: scout.missionId,
    roundRequestId: scout.roundRequestId,
    logicalRequestId: scout.logicalRequestId,
    query: scout.query,
    assignment: scout.assignment,
    region: scout.region,
    provider: scout.preferLocalTruth ? 'runtime_local' : 'live_research_router',
    resultCount: 0,
    evidenceIds: [],
    findings: '',
    uncertainties: [],
    confidence: null,
    startedAt,
    completedAt: null,
    aborted: false,
    staleDiscarded: stale,
    timeout: false,
    languageAccess: scout.languageAccess,
    preferredProviders: scout.preferredProviders,
    queryLanguage: scout.queryLanguage,
  }
  if (stale) {
    return { metadata: { ...baseMeta, completedAt: new Date().toISOString(), abortReason: 'superseded' }, evidence: [] }
  }
  if (deps.signal?.aborted) {
    const timeout = deps.signal.reason === 'phase_timeout' || String(deps.signal.reason ?? '').includes('timeout')
    return {
      metadata: {
        ...baseMeta,
        aborted: true,
        timeout,
        abortReason: timeout ? 'timeout' : 'signal',
        completedAt: new Date().toISOString(),
      },
      evidence: [],
    }
  }

  try {
    if (!scout.executeLive && !scout.preferLocalTruth) {
      return {
        evidence: [],
        metadata: {
          ...baseMeta,
          provider: 'assignment_only',
          findings: 'Scout recorded an independent query plan without a live retrieval (bounded fanout / non-live assignment).',
          completedAt: new Date().toISOString(),
        },
      }
    }
    if (scout.preferLocalTruth) {
      const raw = runtimeEvidence(scout, deps.runtimeGrounding ?? '', startedAt)
      const { items: evidence } = clusterIndependentEvidence(annotateEvidenceIndependence(raw, {
        region: scout.region ?? null,
        queryLanguage: scout.queryLanguage ?? null,
      }))
      return {
        evidence,
        metadata: {
          ...baseMeta,
          resultCount: evidence.length,
          evidenceIds: evidence.map(item => item.id),
          findings: evidence[0]?.claim ?? 'No local runtime evidence was available.',
          confidence: evidence.length ? 0.7 : 0,
          completedAt: new Date().toISOString(),
        },
      }
    }
    if (!deps.runLiveResearch) {
      return {
        evidence: [],
        metadata: {
          ...baseMeta,
          uncertainties: ['Live research runner was not provided for this scout.'],
          completedAt: new Date().toISOString(),
        },
      }
    }

    const packet = await Promise.race([
      deps.runLiveResearch(scout.query, scout),
      new Promise<never>((_, reject) => {
        timeoutSignal(deps.perScoutTimeoutMs, deps.signal).addEventListener('abort', () => {
          reject(Object.assign(new Error('scout_timeout'), { name: 'TimeoutError' }))
        })
      }),
    ])

    if (deps.signal?.aborted) {
      const timeout = String(deps.signal.reason ?? '') === 'phase_timeout'
      return emptyResult(scout, startedAt, {
        aborted: true,
        timeout,
        abortReason: timeout ? 'timeout' : 'signal',
        findings: 'Late scout result discarded after abort/timeout.',
      })
    }

    const stillCurrent = isCurrentRoundIdentity(deps.getCurrentRoundIdentity(), {
      missionId: scout.missionId,
      roundRequestId: scout.roundRequestId,
      logicalRequestId: scout.logicalRequestId,
    })
    if (!stillCurrent) {
      return { metadata: { ...baseMeta, staleDiscarded: true, abortReason: 'superseded', completedAt: new Date().toISOString() }, evidence: [] }
    }

    const raw = (packet.intelligencePacket?.evidence ?? []).filter(item =>
      item.origin_type === 'LIVE_WEB' || item.origin_type === 'KIMI_WAVE' || item.origin_type === 'STORED_RESEARCH',
    )
    const { items: evidence } = clusterIndependentEvidence(annotateEvidenceIndependence(raw, {
      region: scout.region ?? (typeof raw[0]?.region === 'string' ? raw[0].region as ScoutPlan['region'] : null),
      queryLanguage: scout.queryLanguage ?? raw[0]?.query_language ?? null,
      fallbackUsed: raw.some(item => item.fallback_used),
      fallbackReason: raw.find(item => item.fallback_reason)?.fallback_reason ?? packet.intelligencePacket?.gaps.find(gap => /fallback|rss/i.test(gap)) ?? null,
    }))
    return {
      evidence,
      metadata: {
        ...baseMeta,
        provider: packet.usedLiveResearch ? 'live_research_router' : 'prior_only',
        resultCount: evidence.length,
        evidenceIds: evidence.map(item => item.id),
        findings: packet.findings.slice(0, 1200),
        uncertainties: packet.unresolvedQuestions.slice(0, 6),
        confidence: packet.confidence,
        completedAt: new Date().toISOString(),
        fallbackUsed: evidence.some(item => item.fallback_used),
        fallbackReason: evidence.find(item => item.fallback_reason)?.fallback_reason ?? null,
      },
    }
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || /timeout|aborted/i.test(error.message))
    const phaseTimeout = deps.signal?.aborted === true && String(deps.signal.reason ?? '') === 'phase_timeout'
    return {
      evidence: [],
      metadata: {
        ...baseMeta,
        aborted: deps.signal?.aborted === true,
        timeout: timeout || phaseTimeout,
        abortReason: phaseTimeout || timeout ? 'timeout' : deps.signal?.aborted ? 'signal' : undefined,
        uncertainties: [error instanceof Error ? error.message : String(error)],
        completedAt: new Date().toISOString(),
      },
    }
  }
}

export async function executeScouts(scouts: ScoutPlan[], deps: ScoutExecutionDeps): Promise<ScoutExecutionResult[]> {
  const phaseController = new AbortController()
  const phaseMs = deps.phaseTimeoutMs ?? 0
  const phaseTimer = phaseMs > 0
    ? setTimeout(() => phaseController.abort('phase_timeout'), phaseMs)
    : undefined
  const signal = composeAbortSignals([deps.signal, phaseMs > 0 ? phaseController.signal : undefined])
  try {
    const results = await mapWithConcurrency(
      scouts,
      deps.maxConcurrentWeb,
      async scout => {
        if (signal?.aborted) {
          const timeout = String(signal.reason ?? '') === 'phase_timeout'
          return emptyResult(scout, new Date().toISOString(), {
            aborted: true,
            timeout,
            abortReason: timeout ? 'timeout' : 'signal',
            findings: 'Scout skipped after phase abort; result not published.',
          })
        }
        return executeScout(scout, { ...deps, signal })
      },
      signal,
    )
    return scouts.map((scout, index) => {
      const existing = results[index]
      if (existing) return existing
      const timeout = String(signal?.reason ?? '') === 'phase_timeout'
      return emptyResult(scout, new Date().toISOString(), {
        aborted: true,
        timeout,
        abortReason: timeout ? 'timeout' : 'signal',
        findings: 'Scout never started before phase abort; result not published.',
      })
    })
  } finally {
    if (phaseTimer) clearTimeout(phaseTimer)
  }
}
