/**
 * Temporal truth for knowledge records.
 * Conflicts: evidence quality → observation time → source authority.
 * History is preserved; older CURRENT becomes SUPERSEDED, never deleted.
 */

import type { EvidenceKind } from '@/lib/council/evidence-board/types'
import { EVIDENCE_KIND_RANK } from '@/lib/council/evidence-board/types'
import type { KgNode, SourceQualityState, TemporalState, TruthState } from './types'

const QUALITY_RANK: Record<SourceQualityState, number> = {
  LIVE_TELEMETRY: 1,
  TOOL_RESULT: 2,
  PRIMARY_EXTERNAL: 3,
  OFFICIAL_DOC: 4,
  SECONDARY: 5,
  USER_REPORTED: 6,
  INFERRED: 7,
}

export function sourceQualityFromEvidenceKind(kind: EvidenceKind): SourceQualityState {
  if (kind === 'live_telemetry') return 'LIVE_TELEMETRY'
  if (kind === 'tool_result') return 'TOOL_RESULT'
  if (kind === 'primary_external') return 'PRIMARY_EXTERNAL'
  if (kind === 'repo_config' || kind === 'logs') return 'OFFICIAL_DOC'
  if (kind === 'secondary_external') return 'SECONDARY'
  if (kind === 'inference') return 'INFERRED'
  return 'INFERRED'
}

export function truthFromEbcStatus(status: string): TruthState {
  if (status === 'VERIFIED') return 'VERIFIED'
  if (status === 'SUPPORTED') return 'SUPPORTED'
  if (status === 'CONTRADICTED') return 'CONFLICTED'
  if (status === 'UNVERIFIED' || status === 'PROPOSED') return 'UNVERIFIED'
  if (status === 'STALE') return 'UNVERIFIED'
  return 'UNKNOWN'
}

export function temporalFromEbcLayer(layer: string): TemporalState {
  if (layer === 'CURRENT_LIVE') return 'CURRENT'
  if (layer === 'HISTORICAL') return 'HISTORICAL'
  if (layer === 'LAST_VERIFIED') return 'CURRENT'
  return 'UNKNOWN'
}

export type TemporalFact = Pick<KgNode, 'node_id' | 'canonical_name' | 'observed_at' | 'confidence_state' | 'source_evidence_ids' | 'temporal_state' | 'metadata'> & {
  source_quality?: SourceQualityState
  source_authority?: number
}

export type TemporalResolution = {
  current: TemporalFact
  superseded: TemporalFact[]
  deleted: false
}

function qualityOf(fact: TemporalFact): number {
  if (fact.source_quality) return QUALITY_RANK[fact.source_quality]
  return 5
}

function timeOf(fact: TemporalFact): number {
  return fact.observed_at ? Date.parse(fact.observed_at) : 0
}

function authorityOf(fact: TemporalFact): number {
  return fact.source_authority ?? 0
}

/**
 * If two facts conflict on the same canonical current-state key:
 * 1. evidence quality  2. observation time  3. source authority
 * Winner becomes CURRENT. Loser is SUPERSEDED and retained.
 */
export function resolveTemporalConflict(a: TemporalFact, b: TemporalFact): TemporalResolution {
  const aQ = qualityOf(a)
  const bQ = qualityOf(b)
  let winner = a
  let loser = b
  if (aQ !== bQ) {
    winner = aQ < bQ ? a : b
    loser = aQ < bQ ? b : a
  } else {
    const aT = timeOf(a)
    const bT = timeOf(b)
    if (aT !== bT) {
      winner = aT >= bT ? a : b
      loser = aT >= bT ? b : a
    } else if (authorityOf(a) !== authorityOf(b)) {
      winner = authorityOf(a) >= authorityOf(b) ? a : b
      loser = authorityOf(a) >= authorityOf(b) ? b : a
    }
  }
  const current: TemporalFact = { ...winner, temporal_state: 'CURRENT' }
  const superseded: TemporalFact = {
    ...loser,
    temporal_state: 'SUPERSEDED',
  }
  return { current, superseded: [superseded], deleted: false }
}

export function applySupersession(graphNodes: KgNode[], winnerId: string, loserId: string, at: string): KgNode[] {
  return graphNodes.map(node => {
    if (node.node_id === winnerId) {
      return { ...node, temporal_state: 'CURRENT', last_verified_at: at, superseded_at: null, superseded_by: null }
    }
    if (node.node_id === loserId) {
      return {
        ...node,
        temporal_state: node.temporal_state === 'CURRENT' ? 'SUPERSEDED' : node.temporal_state === 'UNKNOWN' ? 'HISTORICAL' : node.temporal_state,
        superseded_at: at,
        superseded_by: winnerId,
      }
    }
    return node
  })
}

export function evidenceKindRank(kind: EvidenceKind): number {
  return EVIDENCE_KIND_RANK[kind]
}

export function isStale(node: KgNode, now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  if (node.temporal_state === 'STALE' || node.temporal_state === 'SUPERSEDED' || node.temporal_state === 'HISTORICAL') return true
  if (!node.last_verified_at && !node.observed_at) return node.temporal_state === 'UNKNOWN'
  const ts = Date.parse(node.last_verified_at || node.observed_at || '')
  return Number.isFinite(ts) && now - ts > maxAgeMs
}
