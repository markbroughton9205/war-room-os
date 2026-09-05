import type { BackendType } from '@/lib/council/live-orchestration/backends/types'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { NEBULA_AGENTS_BY_ID, type NebulaAgentId } from './identity'
import { isFinalCouncilSynthesizer, isOrchestrationOnly } from './roleContracts'

/**
 * Backend fallback is allowed. Identity fallback is not.
 * Every execution retains who it was for, which brain ran, and whether it fell back.
 */

export type NebulaExecutionRecord = {
  agentId: NebulaAgentId
  seatId: CouncilOrchestrationFamily | null
  backendType: BackendType | null
  provider: string | null
  runtime: string | null
  model: string | null
  fallbackFrom: BackendType | null
  attempt: number
  displayedIdentity: string
}

export function createExecutionRecord(params: {
  agentId: NebulaAgentId
  seatId?: CouncilOrchestrationFamily | null
  backendType?: BackendType | null
  provider?: string | null
  runtime?: string | null
  model?: string | null
  fallbackFrom?: BackendType | null
  attempt?: number
}): NebulaExecutionRecord {
  const agent = NEBULA_AGENTS_BY_ID[params.agentId]
  return {
    agentId: params.agentId,
    seatId: params.seatId ?? agent.backendPreference.seatId,
    backendType: params.backendType ?? null,
    provider: params.provider ?? null,
    runtime: params.runtime ?? null,
    model: params.model ?? null,
    fallbackFrom: params.fallbackFrom ?? null,
    attempt: params.attempt ?? 1,
    displayedIdentity: agent.name,
  }
}

export function identitySurvivesBackendChange(
  before: Pick<NebulaExecutionRecord, 'agentId' | 'displayedIdentity'>,
  after: Pick<NebulaExecutionRecord, 'agentId' | 'displayedIdentity' | 'backendType' | 'model'>,
): boolean {
  return before.agentId === after.agentId && before.displayedIdentity === after.displayedIdentity
}

export function isIdentityFallback(displayedIdentity: string, actualAgentId: NebulaAgentId): boolean {
  return displayedIdentity !== NEBULA_AGENTS_BY_ID[actualAgentId].name
}

export function auroraMustRemainAurora(record: NebulaExecutionRecord): boolean {
  return record.agentId === 'aurora' && record.displayedIdentity === 'AURORA'
}

export function astraMustNotSpeakAsCouncilSeat(agentId: NebulaAgentId): boolean {
  return isOrchestrationOnly(agentId)
}

export function onlyAuroraMaySynthesize(agentId: NebulaAgentId): boolean {
  return isFinalCouncilSynthesizer(agentId)
}
