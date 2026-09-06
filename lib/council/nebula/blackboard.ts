import type { NebulaAgentId } from './identity'
import { presentAgentMessage } from './presentation'

export type BlackboardFindingStatus = 'queued' | 'started' | 'completed' | 'failed' | 'skipped'

export type BlackboardProvenance = {
  backendType: string | null
  provider: string | null
  runtime: string | null
  model: string | null
  fallbackFrom: string | null
}

export type BlackboardFinding = {
  agentId: NebulaAgentId
  roundId: string
  status: BlackboardFindingStatus
  summary: string
  structuredOutput: Record<string, unknown> | null
  provenance: BlackboardProvenance
  confidence: number | null
  startedAt: string
  completedAt: string | null
  metrics: {
    ttftMs: number | null
    tokensPerSecond: number | null
    totalMs: number | null
  }
}

export type RoundBlackboard = {
  roundId: string
  findings: BlackboardFinding[]
}

export function createRoundBlackboard(roundId: string): RoundBlackboard {
  return { roundId, findings: [] }
}

export function recordBlackboardFinding(
  board: RoundBlackboard,
  finding: BlackboardFinding,
): RoundBlackboard {
  if (finding.roundId !== board.roundId) {
    throw new Error('Blackboard finding roundId does not match the active round')
  }
  const next = board.findings.filter(item => item.agentId !== finding.agentId || item.status !== finding.status)
  return { roundId: board.roundId, findings: [...next, finding] }
}

export function upsertCompletedFinding(
  board: RoundBlackboard,
  input: {
    agentId: NebulaAgentId
    roundId: string
    raw: string
    provenance: BlackboardProvenance
    confidence?: number | null
    startedAt: string
    completedAt?: string | null
    metrics?: BlackboardFinding['metrics']
    status?: BlackboardFindingStatus
  },
): RoundBlackboard {
  const presented = presentAgentMessage({ agentId: input.agentId, raw: input.raw })
  return recordBlackboardFinding(board, {
    agentId: input.agentId,
    roundId: input.roundId,
    status: input.status ?? (presented.prose ? 'completed' : 'failed'),
    summary: presented.prose,
    structuredOutput: presented.structuredOutput,
    provenance: input.provenance,
    confidence: input.confidence ?? null,
    startedAt: input.startedAt,
    completedAt: input.completedAt ?? new Date().toISOString(),
    metrics: input.metrics ?? { ttftMs: null, tokensPerSecond: null, totalMs: null },
  })
}

export function blackboardSummariesForPrompt(board: RoundBlackboard): string[] {
  return board.findings
    .filter(item => item.status === 'completed' && item.summary.trim())
    .map(item => `${item.agentId.toUpperCase()}: ${item.summary}`)
}

export function chatMustNotRenderStructuredOutput(finding: BlackboardFinding): string {
  return finding.summary
}
