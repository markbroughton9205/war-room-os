import { createHash } from 'node:crypto'
import {
  DEFAULT_ECHO_THRESHOLD,
  EVIDENCE_BOARD_SCHEMA,
  EVIDENCE_KIND_RANK,
  type AgentEnvelopeV1,
  type BoardRelation,
  type BoardSnapshot,
  type ClaimStatus,
  type EbcClaim,
  type EbcConflict,
  type EbcEvidence,
  type EbcMissionClass,
  type EbcTask,
  type EvidenceKind,
  type MissionEvidenceBoard,
  type NoveltyKind,
  type NoveltyRecord,
  type TemporalLayer,
} from './types'

export function fingerprintArgs(args: unknown): string {
  const json = JSON.stringify(args ?? {})
  return createHash('sha256').update(json).digest('hex').slice(0, 16)
}

export function toolFingerprint(toolName: string, args: unknown): string {
  return `${toolName}:${fingerprintArgs(args)}`
}

function tokenize(text: string): Map<string, number> {
  const tokens = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

export function lexicalCosine(a: string, b: string): number {
  const left = tokenize(a)
  const right = tokenize(b)
  if (!left.size || !right.size) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (const [token, weight] of left) {
    leftNorm += weight * weight
    const other = right.get(token)
    if (other) dot += weight * other
  }
  for (const weight of right.values()) rightNorm += weight * weight
  const denom = Math.sqrt(leftNorm) * Math.sqrt(rightNorm)
  return denom === 0 ? 0 : dot / denom
}

export function normalizeSourceUrl(url: string | null | undefined): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    const host = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return `${parsed.protocol}//${host}${pathname}${parsed.search}`
  } catch {
    return url.trim().replace(/\/+$/, '')
  }
}

export function createEvidenceBoard(input: {
  mission_id: string
  mission_class: EbcMissionClass
  question: string
  agents: MissionEvidenceBoard['mission']['agents']
  ttl_seconds: number
  budget_tokens: number
  budget_ms: number
  created_at?: string
}): MissionEvidenceBoard {
  return {
    schema: EVIDENCE_BOARD_SCHEMA,
    mission: {
      mission_id: input.mission_id,
      mission_class: input.mission_class,
      question: input.question,
      agents: [...input.agents],
      ttl_seconds: input.ttl_seconds,
      budgets: { tokens: input.budget_tokens, ms: input.budget_ms },
      created_at: input.created_at ?? new Date().toISOString(),
    },
    tasks: [],
    evidence: [],
    claims: [],
    conflicts: [],
    decisions: [],
    relations: [],
    suppressed: [],
    chat_partition_forbidden: true,
  }
}

function provenance(board: MissionEvidenceBoard, agent_id: AgentEnvelopeV1['agent_id'], round: number, provenance: string) {
  return {
    mission_id: board.mission.mission_id,
    agent_id,
    round,
    timestamp: new Date().toISOString(),
    provenance,
  }
}

export function appendTasks(board: MissionEvidenceBoard, tasks: readonly EbcTask[], agent_id: AgentEnvelopeV1['agent_id'] = 'ORION'): void {
  for (const task of tasks) {
    board.tasks.push({ ...task, ...provenance(board, agent_id, 1, 'task_decomposer') })
  }
}

export function evidenceIsFresh(row: Pick<EbcEvidence, 'retrieved_at'>, ttlSeconds: number, now = Date.now()): boolean {
  const retrieved = Date.parse(row.retrieved_at)
  if (!Number.isFinite(retrieved)) return false
  return now - retrieved <= ttlSeconds * 1000
}

export function demoteStaleEvidence(board: MissionEvidenceBoard, now = Date.now()): EbcClaim[] {
  const demoted: EbcClaim[] = []
  for (const evidence of board.evidence) {
    if (!evidenceIsFresh(evidence, board.mission.ttl_seconds, now) && evidence.temporal_layer === 'CURRENT_LIVE') {
      evidence.temporal_layer = 'LAST_VERIFIED'
      evidence.stale_reason = 'ttl_exceeded'
      for (const claim of board.claims) {
        if (claim.evidence_ids.includes(evidence.evidence_id) && claim.temporal_layer === 'CURRENT_LIVE') {
          claim.temporal_layer = 'LAST_VERIFIED'
          if (claim.status === 'VERIFIED' || claim.status === 'SUPPORTED') {
            claim.status = 'STALE'
            demoted.push(claim)
          }
        }
      }
    }
  }
  return demoted
}

export function highestEvidenceRank(kinds: readonly EvidenceKind[]): number {
  if (!kinds.length) return 99
  return Math.min(...kinds.map(kind => EVIDENCE_KIND_RANK[kind]))
}

export function liveKindsForMission(missionClass: EbcMissionClass): EvidenceKind[] {
  if (missionClass === 'DEEP_RESEARCH' || missionClass === 'CURRENT_INTEL' || missionClass === 'DOCUMENT_ANALYSIS') {
    return ['live_telemetry', 'tool_result', 'primary_external']
  }
  return ['live_telemetry', 'tool_result']
}

export function canVerifyFromKinds(
  kinds: readonly EvidenceKind[],
  requireLive: boolean,
  liveKinds: readonly EvidenceKind[] = ['live_telemetry', 'tool_result'],
): boolean {
  if (kinds.length === 0) return false
  if (kinds.every(kind => kind === 'model_prior' || kind === 'inference')) return false
  if (kinds.every(kind => kind === 'secondary_external' || kind === 'model_prior' || kind === 'inference')) return false
  if (requireLive && !kinds.some(kind => liveKinds.includes(kind))) return false
  if (requireLive) {
    const ceiling = Math.max(...liveKinds.map(kind => EVIDENCE_KIND_RANK[kind] ?? 99))
    return highestEvidenceRank(kinds) <= ceiling
  }
  return highestEvidenceRank(kinds) <= EVIDENCE_KIND_RANK.primary_external
}

export function noveltyAgainstBoard(
  envelope: AgentEnvelopeV1,
  board: MissionEvidenceBoard,
  threshold = DEFAULT_ECHO_THRESHOLD,
): NoveltyRecord {
  if (envelope.omit_reason) {
    return { adds: [], suppressed: false, reason: envelope.omit_reason, similarity: 0 }
  }
  const adds: NoveltyKind[] = []
  let maxSimilarity = 0
  const existingClaimText = board.claims.map(claim => claim.text)
  const existingEvidencePointers = new Set(board.evidence.map(row => `${row.tool_name}:${row.pointer}`))

  for (const claim of envelope.claims) {
    const nearest = existingClaimText.reduce((best, text) => Math.max(best, lexicalCosine(claim.text, text)), 0)
    maxSimilarity = Math.max(maxSimilarity, nearest)
    if (nearest < threshold) adds.push('NEW_CLAIM')
  }
  for (const row of envelope.evidence) {
    const key = `${row.tool_name}:${row.pointer}`
    if (!existingEvidencePointers.has(key)) adds.push('NEW_EVIDENCE')
  }
  if (envelope.contradictions.length) adds.push('NEW_CONTRADICTION')
  if (envelope.risks.length) adds.push('NEW_RISK')
  if (envelope.tests_recommended.length) adds.push('NEW_TEST')
  if (envelope.claims.some(claim => /\bbecause\b|\bcaused by\b|\bdue to\b/i.test(claim.text))) adds.push('NEW_CAUSAL_EXPLANATION')
  if (envelope.agent_id === 'NOVA' && (envelope.claims.some(claim => /wr\.ports\.list\.v1|typed table|columns/i.test(claim.text)) || envelope.claims.some(claim => /schema/i.test(claim.text)))) {
    adds.push('NEW_STRUCTURE')
  }
  if (envelope.agent_id === 'NOVA' && envelope.claims.some(claim => /\b\d+(\.\d+)?\b/.test(claim.text))) {
    adds.push('NEW_QUANT_RESULT')
  }

  const uniqueAdds = [...new Set(adds)]
  if (!uniqueAdds.length) {
    return { adds: [], suppressed: true, reason: 'no_novelty_and_no_omit_reason', similarity: maxSimilarity }
  }
  if (maxSimilarity >= threshold && uniqueAdds.every(kind => kind === 'NEW_CLAIM')) {
    return { adds: uniqueAdds, suppressed: true, reason: 'near_duplicate_claim_text', similarity: maxSimilarity }
  }
  return { adds: uniqueAdds, suppressed: false, similarity: maxSimilarity }
}

export function appendEnvelope(
  board: MissionEvidenceBoard,
  envelope: AgentEnvelopeV1,
  opts?: { echoThreshold?: number },
): { accepted: boolean; reason: string; novelty: NoveltyRecord } {
  const novelty = envelope.omit_reason
    ? { adds: [] as NoveltyKind[], suppressed: false, reason: envelope.omit_reason, similarity: 0 }
    : noveltyAgainstBoard(envelope, board, opts?.echoThreshold ?? DEFAULT_ECHO_THRESHOLD)
  if (!envelope.omit_reason && novelty.suppressed) {
    board.suppressed.push({
      envelope,
      reason: novelty.reason ?? 'novelty_gate',
      ...{
        mission_id: board.mission.mission_id,
        agent_id: envelope.agent_id,
        round: envelope.round,
        timestamp: new Date().toISOString(),
        provenance: 'novelty_gate',
      },
    })
    return { accepted: false, reason: novelty.reason ?? 'novelty_gate', novelty }
  }
  if (envelope.omit_reason) {
    return { accepted: true, reason: 'omit', novelty }
  }

  const knownEvidence = new Set(board.evidence.map(row => row.evidence_id))
  for (const row of envelope.evidence) {
    if (knownEvidence.has(row.evidence_id)) continue
    board.evidence.push({
      ...row,
      mission_id: board.mission.mission_id,
      agent_id: envelope.agent_id,
      round: envelope.round,
      timestamp: row.retrieved_at,
      provenance: `envelope:${envelope.agent_id}`,
    })
    knownEvidence.add(row.evidence_id)
  }
  for (const claim of envelope.claims) {
    board.claims.push({
      ...claim,
      mission_id: board.mission.mission_id,
      agent_id: envelope.agent_id,
      round: envelope.round,
      timestamp: new Date().toISOString(),
      provenance: `envelope:${envelope.agent_id}`,
    })
    for (const evidenceId of claim.evidence_ids) {
      board.relations.push(relation(board, 'supports', evidenceId, claim.claim_id, envelope))
    }
  }
  for (const conflict of envelope.contradictions) {
    board.conflicts.push({
      ...conflict,
      mission_id: board.mission.mission_id,
      agent_id: envelope.agent_id,
      round: envelope.round,
      timestamp: new Date().toISOString(),
      provenance: `envelope:${envelope.agent_id}`,
    })
  }
  return { accepted: true, reason: 'appended', novelty }
}

function relation(
  board: MissionEvidenceBoard,
  kind: BoardRelation['kind'],
  from_id: string,
  to_id: string,
  envelope: AgentEnvelopeV1,
): BoardRelation {
  return {
    relation_id: `rel-${board.relations.length + 1}`,
    kind,
    from_id,
    to_id,
    agent_id: envelope.agent_id,
    round: envelope.round,
    timestamp: new Date().toISOString(),
  }
}

export function setClaimStatus(board: MissionEvidenceBoard, claimId: string, status: ClaimStatus, extra?: Partial<EbcClaim>): EbcClaim | null {
  const claim = board.claims.find(item => item.claim_id === claimId)
  if (!claim) return null
  claim.status = status
  if (extra) Object.assign(claim, extra)
  return claim
}

export function openConflicts(board: MissionEvidenceBoard): EbcConflict[] {
  return board.conflicts.filter(conflict => conflict.open)
}

export function boardSnapshot(board: MissionEvidenceBoard, extras?: {
  unknowns?: BoardSnapshot['unknowns']
  tool_blocks?: BoardSnapshot['tool_blocks']
  risks?: BoardSnapshot['risks']
  tests_recommended?: BoardSnapshot['tests_recommended']
}): BoardSnapshot {
  return {
    mission_id: board.mission.mission_id,
    mission_class: board.mission.mission_class,
    claims: board.claims.map(claim => ({ ...claim })),
    evidence: board.evidence.map(row => ({ ...row })),
    conflicts: board.conflicts.map(conflict => ({ ...conflict })),
    unknowns: extras?.unknowns ?? [],
    tool_blocks: extras?.tool_blocks ?? [],
    risks: extras?.risks ?? [],
    tests_recommended: extras?.tests_recommended ?? [],
  }
}

export function lastVerifiedLabel(timestamp: string, method: string): string {
  return `Last verified healthy at ${timestamp}. Current state not verified. Verification method: ${method}.`
}

export function temporalLayerForEvidence(kind: EvidenceKind, fresh: boolean): TemporalLayer {
  if (fresh && (kind === 'live_telemetry' || kind === 'tool_result')) return 'CURRENT_LIVE'
  if (kind === 'model_prior' || kind === 'inference') return 'HISTORICAL'
  return 'LAST_VERIFIED'
}
