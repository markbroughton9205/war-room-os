import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import type { LiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'
import { isCurrentRoundIdentity, mapWithConcurrency } from './governor'
import type { RoundIdentity, ScoutMetadata, ScoutPlan } from './types'

export type ScoutExecutionDeps = {
  signal?: AbortSignal
  perScoutTimeoutMs: number
  maxConcurrentWeb: number
  getCurrentRoundIdentity: () => RoundIdentity
  runLiveResearch?: (query: string) => Promise<LiveResearchEvidencePacket>
  runtimeGrounding?: string
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
  }
  if (stale) {
    return { metadata: { ...baseMeta, completedAt: new Date().toISOString() }, evidence: [] }
  }
  if (deps.signal?.aborted) {
    return { metadata: { ...baseMeta, aborted: true, completedAt: new Date().toISOString() }, evidence: [] }
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
      const evidence = runtimeEvidence(scout, deps.runtimeGrounding ?? '', startedAt)
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
      deps.runLiveResearch(scout.query),
      new Promise<never>((_, reject) => {
        timeoutSignal(deps.perScoutTimeoutMs, deps.signal).addEventListener('abort', () => {
          reject(Object.assign(new Error('scout_timeout'), { name: 'TimeoutError' }))
        })
      }),
    ])

    const stillCurrent = isCurrentRoundIdentity(deps.getCurrentRoundIdentity(), {
      missionId: scout.missionId,
      roundRequestId: scout.roundRequestId,
      logicalRequestId: scout.logicalRequestId,
    })
    if (!stillCurrent) {
      return { metadata: { ...baseMeta, staleDiscarded: true, completedAt: new Date().toISOString() }, evidence: [] }
    }

    const evidence = (packet.intelligencePacket?.evidence ?? []).filter(item =>
      item.origin_type === 'LIVE_WEB' || item.origin_type === 'KIMI_WAVE' || item.origin_type === 'STORED_RESEARCH',
    )
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
      },
    }
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || /timeout|aborted/i.test(error.message))
    return {
      evidence: [],
      metadata: {
        ...baseMeta,
        aborted: deps.signal?.aborted === true,
        timeout,
        uncertainties: [error instanceof Error ? error.message : String(error)],
        completedAt: new Date().toISOString(),
      },
    }
  }
}

export async function executeScouts(scouts: ScoutPlan[], deps: ScoutExecutionDeps): Promise<ScoutExecutionResult[]> {
  return mapWithConcurrency(scouts, deps.maxConcurrentWeb, scout => executeScout(scout, deps), deps.signal)
}
