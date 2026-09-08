import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import type { DeliberationEvidenceReference, DeliberationTurn, DeliberationTurnRole } from '@/lib/council/family-deliberation/types'
import { buildDeliberationPrompt } from '@/lib/council/family-deliberation/runtime'
import type { NebulaAgentId } from '@/lib/council/nebula/identity'
import { assertDiscoveryIsolation } from './isolation'
import { formatPrivateEvidenceBlock } from './ledgers'
import { formatAuroraSynthesisInput } from './verify'
import type {
  AstraMissionPlan,
  AtomicClaim,
  ConvergenceMap,
  FrozenSeatReport,
  PhoenixChallengeResult,
  PrivateSeatLedger,
  SeatAssignment,
} from './types'

export function buildIndependentDiscoveryPrompt(input: {
  role: DeliberationTurnRole
  commanderMessage: string
  assignment: SeatAssignment
  ledger: PrivateSeatLedger
  identityId: NebulaAgentId
  evidenceReferences: DeliberationEvidenceReference[]
  priorKimiStoredBlock?: string
  runtimeBlock?: string
  warRoomContext?: string
  otherDrafts: Array<{ agentId: string; text: string }>
}): { prompt: string; isolationPass: boolean; leaks: string[] } {
  const privateBlock = [
    `ASTRA assignment for ${input.identityId.toUpperCase()} only:`,
    input.assignment.objective,
    '',
    formatPrivateEvidenceBlock(input.ledger),
    input.priorKimiStoredBlock ? `\nPrior Kimi/stored intelligence (not live proof):\n${input.priorKimiStoredBlock}` : '',
    input.runtimeBlock ? `\nLocal runtime/repo truth:\n${input.runtimeBlock}` : '',
  ].filter(Boolean).join('\n')

  const prompt = buildDeliberationPrompt({
    role: input.role,
    commanderMessage: input.commanderMessage,
    evidenceReferences: input.evidenceReferences,
    priorTurns: [],
    identityId: input.identityId,
    contextBlock: [
      privateBlock,
      input.warRoomContext ?? '',
      'INDEPENDENT DISCOVERY: You may not see another seat\'s current-round draft. Do not invent that you have.',
    ].filter(Boolean).join('\n\n'),
  })

  const audit = assertDiscoveryIsolation({
    phase: 'INDEPENDENT_DISCOVERY',
    prompt,
    ownerAgentId: input.identityId,
    otherDrafts: input.otherDrafts,
  })
  return { prompt, isolationPass: audit.pass, leaks: audit.leaks }
}

export function targetedCrossReviewPacket(input: {
  reviewer: NebulaAgentId
  reports: FrozenSeatReport[]
  claims: AtomicClaim[]
}): string {
  const others = input.reports.filter(report => report.agentId !== input.reviewer && report.agentId !== 'astra')
  if (input.reviewer === 'lumen') {
    return [
      'Targeted LUMEN verification packet (frozen claims only; omit scout transcripts):',
      ...input.claims.slice(0, 8).map(claim => `- ${claim.claim_id} from ${claim.seat}: ${claim.claim_text}`),
    ].join('\n')
  }
  if (input.reviewer === 'phoenix') {
    const strongest = others
      .slice()
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, 4)
    return [
      'Targeted PHOENIX disconfirmation packet (highest-confidence frozen claims):',
      ...strongest.map(report => `- ${report.agentId}: ${report.conclusion.slice(0, 400)}`),
    ].join('\n')
  }
  if (input.reviewer === 'orion') {
    return [
      'Targeted ORION review: technical evidence that may challenge the initial engineering conclusion.',
      ...others.filter(item => item.agentId === 'pulsar' || item.agentId === 'lumen').map(item => `- ${item.agentId}: ${item.conclusion.slice(0, 300)}`),
    ].join('\n')
  }
  if (input.reviewer === 'nova') {
    return [
      'Targeted NOVA review: verified constraints and competing scenarios.',
      ...others.filter(item => item.agentId === 'lumen' || item.agentId === 'phoenix').map(item => `- ${item.agentId}: ${item.conclusion.slice(0, 300)}`),
    ].join('\n')
  }
  if (input.reviewer === 'solara') {
    return [
      'Targeted SOLARA review: verified policy/technical conclusions for practical impact.',
      ...others.filter(item => item.agentId === 'orion' || item.agentId === 'lumen').map(item => `- ${item.agentId}: ${item.conclusion.slice(0, 300)}`),
    ].join('\n')
  }
  return others.map(item => `${item.agentId}: ${item.conclusion.slice(0, 240)}`).join('\n')
}

export function buildCrossReviewPrompt(input: {
  role: DeliberationTurnRole
  commanderMessage: string
  reviewer: NebulaAgentId
  reports: FrozenSeatReport[]
  claims: AtomicClaim[]
  evidenceReferences: DeliberationEvidenceReference[]
  identityId: NebulaAgentId
}): string {
  return buildDeliberationPrompt({
    role: input.role,
    commanderMessage: input.commanderMessage,
    evidenceReferences: input.evidenceReferences,
    priorTurns: [],
    identityId: input.identityId,
    contextBlock: [
      'CROSS_REVIEW is open because POSITION_FREEZE completed. You may now see other frozen conclusions, evidence IDs, and unresolved questions — not raw scout transcripts.',
      targetedCrossReviewPacket(input),
    ].join('\n\n'),
  })
}

export function buildAuroraPrompt(input: {
  commanderMessage: string
  plan: AstraMissionPlan
  astra: FrozenSeatReport | null
  reports: FrozenSeatReport[]
  revisions: string[]
  claims: AtomicClaim[]
  challenges: PhoenixChallengeResult[]
  convergence: ConvergenceMap
  evidenceReferences: DeliberationEvidenceReference[]
  priorEvidence?: IntelligenceEvidenceItem[]
}): string {
  return buildDeliberationPrompt({
    role: 'council_synthesis',
    commanderMessage: input.commanderMessage,
    evidenceReferences: input.evidenceReferences,
    priorTurns: [],
    identityId: 'aurora',
    contextBlock: formatAuroraSynthesisInput({
      astra: input.astra,
      reports: input.reports,
      revisions: input.revisions,
      claims: input.claims,
      challenges: input.challenges,
      convergence: input.convergence,
    }),
  })
}

export function otherDraftsFromTurns(turns: DeliberationTurn[], ownerSeat: string): Array<{ agentId: string; text: string }> {
  return turns
    .filter(turn => turn.provider_family !== ownerSeat && turn.full_response.trim())
    .map(turn => ({
      agentId: (turn.agent_identity ?? turn.provider_family).toLowerCase(),
      text: turn.full_response,
    }))
}
