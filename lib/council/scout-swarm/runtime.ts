import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { DeliberationTurnRole } from '@/lib/council/family-deliberation/types'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import type { LiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'
import type { StoredResearchPacket, StoredResearchWriteResult } from '@/lib/intelligence/storedResearch/types'
import type { NebulaAgentId } from '@/lib/council/nebula/identity'
import { evidenceReferencesFromLiveResearch } from '@/lib/council/family-deliberation/runtime'
import { advanceSwarmPhase, createSwarmPhaseState, freezeMustPrecedeCrossReview, type SwarmPhaseState } from './phases'
import { loadScoutGovernorLimits } from './governor'
import { discoveryAgents, freezeAstraMissionReport } from './mission'
import { planRoundScouts } from './scoutPlanner'
import { appendLedgerEvidence, createPrivateSeatLedger, formatPrivateEvidenceBlock } from './ledgers'
import { allRequiredReportsFrozen, freezeIndependentSeatReport } from './freeze'
import { assertDiscoveryIsolation } from './isolation'
import { executeScouts } from './scoutExecution'
import { buildAuroraPrompt, buildCrossReviewPrompt, buildIndependentDiscoveryPrompt } from './prompts'
import { buildConvergenceMap, challengeClaim, extractAtomicClaims, verifyClaimAgainstEvidence } from './verify'
import { swarmPacketStub, type CouncilSwarmPersistence } from './persist'
import type {
  AstraMissionPlan,
  AtomicClaim,
  ConvergenceMap,
  FrozenSeatReport,
  IsolationAudit,
  PhoenixChallengeResult,
  PrivateSeatLedger,
  RoundIdentity,
  ScoutGovernorLimits,
  ScoutMetadata,
  ScoutSwarmPublicMeta,
  SeatAssignment,
} from './types'

export type IsolatedSeatInvokeInput = {
  family: CouncilOrchestrationFamily
  agentId: NebulaAgentId
  prompt: string
  role: DeliberationTurnRole
}

export type IsolatedSeatInvokeResult = {
  content: string
  status: 'complete' | 'failed' | 'timed_out' | 'unavailable' | 'unresolved'
  failureReason?: string | null
}

export type ScoutSwarmRoundResult = {
  plan: AstraMissionPlan
  phaseState: SwarmPhaseState
  scouts: ScoutMetadata[]
  ledgers: PrivateSeatLedger[]
  reports: FrozenSeatReport[]
  claims: AtomicClaim[]
  challenges: PhoenixChallengeResult[]
  revisions: string[]
  convergence: ConvergenceMap
  isolation: IsolationAudit
  publicMeta: ScoutSwarmPublicMeta
  persistence: CouncilSwarmPersistence
  auroraPrompt: string
  discoveryPrompts: Partial<Record<NebulaAgentId, string>>
  aborted: boolean
}

export async function runIndependentScoutSwarm(input: {
  plan: AstraMissionPlan
  invokeSeat: (args: IsolatedSeatInvokeInput) => Promise<IsolatedSeatInvokeResult>
  getCurrentRoundIdentity: () => RoundIdentity
  signal?: AbortSignal
  limits?: ScoutGovernorLimits
  runLiveResearch?: (query: string) => Promise<LiveResearchEvidencePacket>
  persistPacket?: (packet: StoredResearchPacket) => Promise<StoredResearchWriteResult>
  priorEvidence?: IntelligenceEvidenceItem[]
  priorKimiStoredBlock?: string
  runtimeGrounding?: string
  warRoomContext?: string
  liveResearchPacket?: LiveResearchEvidencePacket
}): Promise<ScoutSwarmRoundResult> {
  const limits = input.limits ?? loadScoutGovernorLimits()
  let phaseState = createSwarmPhaseState(input.plan.createdAt)
  const astraReport = freezeAstraMissionReport(input.plan)
  const reports: FrozenSeatReport[] = [astraReport]
  const discoveryPrompts: Partial<Record<NebulaAgentId, string>> = {}
  const isolationLeaks: string[] = []
  const revisions: string[] = []
  let aborted = false

  phaseState = advanceSwarmPhase(phaseState, 'INDEPENDENT_DISCOVERY')
  const planned = planRoundScouts(input.plan, limits)
  const executed = await executeScouts(planned.scouts, {
    signal: input.signal,
    perScoutTimeoutMs: limits.perScoutTimeoutMs,
    maxConcurrentWeb: limits.maxConcurrentWebCalls,
    getCurrentRoundIdentity: input.getCurrentRoundIdentity,
    runLiveResearch: input.runLiveResearch,
    runtimeGrounding: input.runtimeGrounding,
  })
  const scouts = executed.map(item => item.metadata)

  const ledgers: PrivateSeatLedger[] = []
  const current = input.getCurrentRoundIdentity()
  for (const assignment of input.plan.assignments.filter(item => item.agentId !== 'aurora')) {
    const seed = planned.scouts.find(item => item.agentId === assignment.agentId)
    let ledger: PrivateSeatLedger = seed
      ? createPrivateSeatLedger(seed)
      : {
          agentId: assignment.agentId,
          seatId: assignment.seat,
          missionId: input.plan.missionId,
          roundRequestId: input.plan.roundRequestId,
          logicalRequestId: input.plan.logicalRequestId,
          entries: [],
          evidence: [...(input.priorEvidence ?? [])],
        }
    if (!seed && input.priorEvidence?.length) {
      ledger = { ...ledger, evidence: [...input.priorEvidence] }
    }
    for (const result of executed.filter(item => item.metadata.agentId === assignment.agentId)) {
      const scout = planned.scouts.find(item => item.scoutId === result.metadata.scoutId)
      if (!scout) continue
      const next = appendLedgerEvidence(ledger, scout, result.evidence, current)
      ledger = next.ledger
    }
    if (input.priorEvidence?.length) {
      const known = new Set(ledger.evidence.map(item => item.id))
      ledger = {
        ...ledger,
        evidence: [...ledger.evidence, ...input.priorEvidence.filter(item => !known.has(item.id))],
      }
    }
    ledgers.push(ledger)
  }

  const evidenceRefs = evidenceReferencesFromLiveResearch(input.liveResearchPacket)
  const otherDrafts: Array<{ agentId: string; text: string }> = []

  for (const agentId of discoveryAgents(input.plan)) {
    if (input.signal?.aborted) {
      aborted = true
      break
    }
    const assignment = input.plan.assignments.find(item => item.agentId === agentId)
    if (!assignment) continue
    const ledger = ledgers.find(item => item.agentId === agentId) ?? {
      agentId,
      seatId: assignment.seat,
      missionId: input.plan.missionId,
      roundRequestId: input.plan.roundRequestId,
      logicalRequestId: input.plan.logicalRequestId,
      entries: [],
      evidence: [],
    }
    const built = buildIndependentDiscoveryPrompt({
      role: 'direct_response',
      commanderMessage: input.plan.commanderDecree,
      assignment,
      ledger,
      identityId: agentId,
      evidenceReferences: evidenceRefs.filter(ref => ledger.evidence.some(item => ref.evidence_reference_id.includes(item.id) || ref.url === item.url)),
      priorKimiStoredBlock: assignment.kimiStored ? input.priorKimiStoredBlock : undefined,
      runtimeBlock: agentId === 'orion' ? input.runtimeGrounding : undefined,
      warRoomContext: agentId === 'orion' ? input.warRoomContext : undefined,
      otherDrafts,
    })
    discoveryPrompts[agentId] = built.prompt
    if (!built.isolationPass) {
      isolationLeaks.push(...built.leaks)
      reports.push(freezeIndependentSeatReport({
        agentId,
        assignment,
        conclusion: '',
        ledger,
        missionId: input.plan.missionId,
        roundRequestId: input.plan.roundRequestId,
        logicalRequestId: input.plan.logicalRequestId,
        scoutSummary: 'Isolation barrier failed closed; seat was not shown leaked context.',
        unanswered: built.leaks,
        confidence: 0,
      }))
      continue
    }
    const invoked = await input.invokeSeat({
      family: assignment.seat,
      agentId,
      prompt: built.prompt,
      role: 'direct_response',
    })
    const conclusion = invoked.status === 'complete' ? invoked.content : ''
    otherDrafts.push({ agentId, text: conclusion })
    const seatScouts = scouts.filter(item => item.agentId === agentId)
    reports.push(freezeIndependentSeatReport({
      agentId,
      assignment,
      conclusion,
      ledger,
      missionId: input.plan.missionId,
      roundRequestId: input.plan.roundRequestId,
      logicalRequestId: input.plan.logicalRequestId,
      scoutSummary: `${seatScouts.length} scouts; ${ledger.evidence.length} evidence items.`,
      unanswered: invoked.status === 'complete' ? [] : [invoked.failureReason ?? invoked.status],
      confidence: invoked.status === 'complete' ? 0.62 : 0,
    }))
  }

  phaseState = advanceSwarmPhase(phaseState, 'POSITION_FREEZE')
  const required = discoveryAgents(input.plan)
  const freezeComplete = allRequiredReportsFrozen(required, reports)

  const allEvidence = ledgers.flatMap(item => item.evidence)
  let claims: AtomicClaim[] = []
  let challenges: PhoenixChallengeResult[] = []

  if (freezeComplete && isolationLeaks.length === 0 && freezeMustPrecedeCrossReview(phaseState.history) && !aborted) {
    phaseState = advanceSwarmPhase(phaseState, 'CROSS_REVIEW')
    const frozenDiscovery = reports.filter(item => item.agentId !== 'astra' && item.agentId !== 'aurora')
    claims = frozenDiscovery.flatMap(report =>
      extractAtomicClaims(report).map(claim => verifyClaimAgainstEvidence(claim, allEvidence)),
    )

    for (const reviewer of ['lumen', 'phoenix', 'orion', 'nova', 'solara'] as const) {
      if (!input.plan.selectedPermanentSeats.includes(reviewer)) continue
      const assignment = input.plan.assignments.find(item => item.agentId === reviewer)
      if (!assignment) continue
      const role: DeliberationTurnRole = reviewer === 'phoenix' ? 'red_team_challenge' : 'revision_or_stand_firm'
      const prompt = buildCrossReviewPrompt({
        role,
        commanderMessage: input.plan.commanderDecree,
        reviewer,
        reports,
        claims,
        evidenceReferences: evidenceRefs,
        identityId: reviewer,
      })
      const invoked = await input.invokeSeat({
        family: assignment.seat,
        agentId: reviewer,
        prompt,
        role,
      })
      if (invoked.status === 'complete' && invoked.content.trim()) {
        revisions.push(`${reviewer}: ${invoked.content.trim()}`)
      }
    }

    phaseState = advanceSwarmPhase(phaseState, 'VERIFICATION')
    claims = claims.map(claim => verifyClaimAgainstEvidence(claim, allEvidence))
    challenges = claims.map(claim => challengeClaim(claim, allEvidence))
  }

  const convergence = buildConvergenceMap({
    missionId: input.plan.missionId,
    roundRequestId: input.plan.roundRequestId,
    logicalRequestId: input.plan.logicalRequestId,
    reports,
    claims,
    challenges,
    evidence: allEvidence,
  })

  phaseState = advanceSwarmPhase(phaseState, 'SYNTHESIS')
  const auroraPrompt = buildAuroraPrompt({
    commanderMessage: input.plan.commanderDecree,
    plan: input.plan,
    astra: astraReport,
    reports,
    revisions,
    claims,
    challenges,
    convergence,
    evidenceReferences: evidenceRefs,
    priorEvidence: input.priorEvidence,
  })
  const auroraAssignment: SeatAssignment | null = input.plan.assignments.find(item => item.agentId === 'aurora') ?? null
  let auroraContent = ''
  if (input.plan.selectedPermanentSeats.includes('aurora') && !aborted) {
    const invoked = await input.invokeSeat({
      family: 'chatgpt',
      agentId: 'aurora',
      prompt: auroraPrompt,
      role: 'council_synthesis',
    })
    auroraContent = invoked.status === 'complete' ? invoked.content : ''
  }
  reports.push(freezeIndependentSeatReport({
    agentId: 'aurora',
    assignment: auroraAssignment,
    conclusion: auroraContent,
    ledger: null,
    missionId: input.plan.missionId,
    roundRequestId: input.plan.roundRequestId,
    logicalRequestId: input.plan.logicalRequestId,
    scoutSummary: 'AURORA launched no discovery scouts.',
    confidence: auroraContent ? 0.66 : 0,
  }))

  phaseState = advanceSwarmPhase(phaseState, 'PERSISTENCE')
  const isolation: IsolationAudit = {
    pass: isolationLeaks.length === 0,
    phase: 'INDEPENDENT_DISCOVERY',
    leaks: isolationLeaks,
    checkedSeats: required,
  }
  const persistence: CouncilSwarmPersistence = {
    missionId: input.plan.missionId,
    phase: 'PERSISTENCE',
    astraMission: input.plan,
    reports,
    scoutMetadata: scouts,
    revisions: revisions.map((notes, index) => ({
      revision_id: `rev-${index + 1}`,
      report_id: reports[0]?.report_id ?? '',
      reviewer: (notes.split(':')[0] ?? 'lumen') as NebulaAgentId,
      createdAt: new Date().toISOString(),
      targetClaimIds: claims.slice(0, 4).map(item => item.claim_id),
      notes,
      surviving: true,
    })),
    convergence,
    isolation,
  }

  if (input.persistPacket) {
    await input.persistPacket(swarmPacketStub({
      decree: input.plan.commanderDecree,
      evidence: allEvidence,
      swarm: persistence,
    }))
  }

  const scoutsBySeat: ScoutSwarmPublicMeta['scoutsBySeat'] = {}
  for (const scout of scouts) {
    scoutsBySeat[scout.agentId] = (scoutsBySeat[scout.agentId] ?? 0) + 1
  }

  return {
    plan: input.plan,
    phaseState,
    scouts,
    ledgers,
    reports,
    claims,
    challenges,
    revisions,
    convergence,
    isolation,
    publicMeta: {
      phase: phaseState.phase,
      scoutsActive: scouts.some(item => !item.completedAt),
      scoutsBySeat,
      totalScouts: scouts.length,
      independentReportsFrozen: reports.filter(item => item.phase === 'POSITION_FREEZE').length,
      crossReviewStarted: phaseState.history.some(item => item.phase === 'CROSS_REVIEW'),
      evidenceCount: allEvidence.length,
      isolationPass: isolation.pass,
    },
    persistence,
    auroraPrompt,
    discoveryPrompts,
    aborted,
  }
}

export function formatDiscoveryContextPreview(assignment: SeatAssignment, ledger: PrivateSeatLedger): string {
  return `${assignment.objective}\n${formatPrivateEvidenceBlock(ledger)}`
}

export { assertDiscoveryIsolation }
