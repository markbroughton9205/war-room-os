/**
 * TemporalWorldStateEngine — extract/extend intelligence/temporal.ts.
 * Does not replace EBC. Historical facts are retained, never deleted.
 */
import { resolveTemporalConflict, type TemporalFact } from '@/lib/council/intelligence/temporal'
import { createEngineReceipt } from '../receipts'
import type { EngineReceipt } from '../types'
import { TEMPORAL_WORLD_STATE_SCHEMA, type RefreshSignal, type TemporalFactRecord } from '../long-horizon/types'

export type TemporalEval = {
  state: TemporalFactRecord['freshness_state']
  speculative: boolean
  refresh: RefreshSignal
}

export function evaluateTemporalMemory(input: {
  observed_at?: string | null
  valid_to?: string | null
  truth?: TemporalFactRecord['truth_state']
  speculative?: boolean
  now?: number
}): TemporalEval {
  const now = input.now ?? Date.now()
  if (input.speculative) return { state: 'TIME_UNKNOWN', speculative: true, refresh: 'UNKNOWN' }
  if (!input.observed_at && !input.valid_to) return { state: 'TIME_UNKNOWN', speculative: false, refresh: 'UNKNOWN' }
  const observed = input.observed_at ? Date.parse(input.observed_at) : NaN
  const until = input.valid_to ? Date.parse(input.valid_to) : NaN
  if (Number.isNaN(observed) && Number.isNaN(until)) return { state: 'TIME_UNKNOWN', speculative: false, refresh: 'UNKNOWN' }
  if (!Number.isNaN(until) && until < now) return { state: 'STALE', speculative: false, refresh: 'REFRESH_REQUIRED' }
  if (!Number.isNaN(observed) && now - observed > 1000 * 60 * 60 * 24 * 30) return { state: 'STALE', speculative: false, refresh: 'REFRESH_REQUIRED' }
  if (!Number.isNaN(until) && until > now && !Number.isNaN(observed) && observed > now) return { state: 'FUTURE_SCHEDULED', speculative: false, refresh: 'UNKNOWN' }
  return { state: 'CURRENT', speculative: false, refresh: 'FRESH' }
}

export function createTemporalFact(input: Partial<TemporalFactRecord> & { fact_id: string; statement: string; entity_ids: string[] }): TemporalFactRecord {
  return {
    schema: TEMPORAL_WORLD_STATE_SCHEMA,
    fact_id: input.fact_id,
    claim_id: input.claim_id ?? input.fact_id,
    entity_ids: input.entity_ids,
    statement: input.statement,
    valid_from: input.valid_from ?? input.observed_at ?? null,
    valid_to: input.valid_to ?? null,
    observed_at: input.observed_at ?? null,
    published_at: input.published_at ?? null,
    updated_at: input.updated_at ?? input.observed_at ?? null,
    source_refs: input.source_refs ?? [],
    evidence_refs: input.evidence_refs ?? [],
    truth_state: input.truth_state ?? 'UNVERIFIED',
    freshness_state: input.freshness_state ?? evaluateTemporalMemory(input).state,
    supersedes: input.supersedes ?? null,
    superseded_by: input.superseded_by ?? null,
    temporal_scope: input.temporal_scope ?? 'WORLD',
    world_state_version: input.world_state_version ?? 1,
  }
}

export function supersedeFact(oldFact: TemporalFactRecord, newFact: TemporalFactRecord): { previous: TemporalFactRecord; current: TemporalFactRecord } {
  const current: TemporalFactRecord = {
    ...newFact,
    freshness_state: 'CURRENT',
    supersedes: oldFact.fact_id,
    superseded_by: null,
    world_state_version: oldFact.world_state_version + 1,
  }
  const previous: TemporalFactRecord = {
    ...oldFact,
    freshness_state: 'SUPERSEDED',
    superseded_by: newFact.fact_id,
    valid_to: oldFact.valid_to ?? newFact.valid_from ?? newFact.observed_at,
  }
  return { previous, current }
}

export function classifyTemporalPair(a: TemporalFactRecord, b: TemporalFactRecord): 'SUPERSESSION' | 'CONTRADICTION' {
  const aFrom = Date.parse(a.valid_from || a.observed_at || '') || 0
  const bFrom = Date.parse(b.valid_from || b.observed_at || '') || 0
  if (a.entity_ids.some(id => b.entity_ids.includes(id)) && aFrom !== bFrom) return 'SUPERSESSION'
  const aTo = Date.parse(a.valid_to || '') || Number.POSITIVE_INFINITY
  const bTo = Date.parse(b.valid_to || '') || Number.POSITIVE_INFINITY
  const overlap = Math.max(aFrom, bFrom) < Math.min(aTo, bTo)
  if (overlap && a.statement !== b.statement && a.truth_state === 'VERIFIED' && b.truth_state === 'VERIFIED') return 'CONTRADICTION'
  if (aFrom !== bFrom) return 'SUPERSESSION'
  return 'CONTRADICTION'
}

export function getCurrentState(facts: readonly TemporalFactRecord[], entity: string): TemporalFactRecord | null {
  const rows = facts.filter(row => row.entity_ids.includes(entity) && row.freshness_state === 'CURRENT' && row.truth_state === 'VERIFIED')
  if (rows.length) return rows.sort((a, b) => Date.parse(b.observed_at || b.updated_at || '') - Date.parse(a.observed_at || a.updated_at || ''))[0]
  const anyCurrent = facts.filter(row => row.entity_ids.includes(entity) && row.freshness_state === 'CURRENT')
  return anyCurrent.sort((a, b) => Date.parse(b.observed_at || '') - Date.parse(a.observed_at || ''))[0] ?? null
}

export function getStateAt(facts: readonly TemporalFactRecord[], entity: string, timestamp: string): TemporalFactRecord | null {
  const t = Date.parse(timestamp)
  const rows = facts.filter(row => {
    if (!row.entity_ids.includes(entity)) return false
    const from = Date.parse(row.valid_from || row.observed_at || '') || 0
    const to = Date.parse(row.valid_to || '') || Number.POSITIVE_INFINITY
    return from <= t && t < to
  })
  return rows.sort((a, b) => Date.parse(b.observed_at || '') - Date.parse(a.observed_at || ''))[0] ?? null
}

export function refreshSignal(input: { question: string; facts: readonly TemporalFactRecord[]; entity?: string }): RefreshSignal {
  const current = input.entity ? getCurrentState(input.facts, input.entity) : input.facts.find(row => row.freshness_state === 'CURRENT')
  if (!current) return 'REFRESH_REQUIRED'
  const evald = evaluateTemporalMemory(current)
  if (evald.refresh === 'REFRESH_REQUIRED' || current.freshness_state === 'STALE' || current.freshness_state === 'TIME_UNKNOWN') return 'REFRESH_REQUIRED'
  if (/current|now|today|latest/i.test(input.question) && current.freshness_state !== 'CURRENT') return 'REFRESH_REQUIRED'
  return evald.refresh
}

export function extractFromKgConflict(a: TemporalFact, b: TemporalFact): { current: TemporalFact; superseded: TemporalFact[] } {
  const resolved = resolveTemporalConflict(a, b)
  return { current: resolved.current, superseded: resolved.superseded }
}

export function temporalReceipt(input: {
  mission_id: string
  fact_id: string
  previous: string
  next: string
  evidence_refs: string[]
  reason: string
}): EngineReceipt {
  return createEngineReceipt({
    engine: 'temporal-world-state',
    mission_id: input.mission_id,
    started_at: Date.now(),
    decision_count: 1,
    decision: input.reason,
    input_refs: [input.fact_id, input.previous],
    output_refs: [input.next, ...input.evidence_refs],
  })
}
