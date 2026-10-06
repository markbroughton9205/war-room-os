/**
 * Canonical WRIM generation stop policy (P1).
 * Numbers must match scripts/wrim-environment/stop_policy.json.
 * Validator proves this module agrees with the Python implementation.
 */
export const STOP_POLICY_VERSION = 'wrim-stop-policy-v1' as const
export const SOFT_STOP_MIN_HITS = 2 as const
export const REVIEW_REQUIRED_HITS = 1 as const
export const LOOPING_DEGRADE_DELTA = 2 as const
export const COLLAPSE_DEGRADE_DELTA = 2 as const
export const UNIQUE_DEGRADE_DELTA = 0.05 as const
export const UNIQUE_IMPROVE_DELTA = 0.03 as const
export const GENERATION_AXES = ['looping', 'collapse', 'unique128', 'unique256'] as const
export const FLOOR_METRICS = ['json_valid', 'instruction', 'entity'] as const

export type StopSnapshot = {
  looping: number
  collapse: number
  unique128: number
  unique256: number
  json_valid: number
  instruction: number
  entity: number
  dnll?: number | null
  kl?: number | null
  val0?: number | null
  cap_pass?: number | null
  special_rate?: number | null
  nan_or_inf?: boolean
  hash_mismatch?: boolean
  contamination?: boolean
  disk_integrity_failure?: boolean
}

export type StopDecision = 'HARD_ABORT' | 'SOFT_STOP' | 'REVIEW_REQUIRED' | 'CONTINUE_ELIGIBLE'

function uniqueCmp(cand: number, parent: number): 'DEGRADED' | 'IMPROVED' | 'UNCHANGED' {
  if (cand < parent - UNIQUE_DEGRADE_DELTA) return 'DEGRADED'
  if (cand > parent + UNIQUE_IMPROVE_DELTA) return 'IMPROVED'
  return 'UNCHANGED'
}

function countCmp(cand: number, parent: number, degradeDelta: number, improveDelta: number): 'DEGRADED' | 'IMPROVED' | 'UNCHANGED' {
  if (cand >= parent + degradeDelta) return 'DEGRADED'
  if (cand <= parent - improveDelta) return 'IMPROVED'
  return 'UNCHANGED'
}

export function snapshotFromCompact(row: Record<string, unknown>): StopSnapshot {
  const pickInt = (...keys: string[]) => {
    for (const k of keys) {
      const v = row[k]
      if (v != null && v !== '') return Number(v)
    }
    return 0
  }
  const pickNum = (...keys: string[]) => {
    for (const k of keys) {
      const v = row[k]
      if (v != null && v !== '') return Number(v)
    }
    return 0
  }
  return {
    looping: pickInt('dev_looping', 'looping'),
    collapse: pickInt('dev_collapsed', 'collapse'),
    unique128: pickNum('dev_unique_128', 'unique128'),
    unique256: pickNum('dev_unique_256', 'unique256'),
    json_valid: pickInt('dev_json_valid', 'json_valid'),
    instruction: pickInt('dev_instruction_ok', 'instruction'),
    entity: pickInt('dev_entity_ok', 'entity'),
    dnll: row.dnll == null ? null : Number(row.dnll),
    kl: row.kl == null ? null : Number(row.kl),
    val0: row.val0 == null ? null : Number(row.val0),
    cap_pass: row.cap_pass == null ? null : Number(row.cap_pass),
    special_rate: row.special_rate == null ? null : Number(row.special_rate),
    nan_or_inf: Boolean(row.nan_or_inf),
    hash_mismatch: Boolean(row.hash_mismatch),
    contamination: Boolean(row.contamination),
    disk_integrity_failure: Boolean(row.disk_integrity_failure),
  }
}

export function floorStatus(parent: number, cand: number): 'UNCHANGED_AT_FLOOR' | 'LEFT_FLOOR' | 'DEGRADED' | 'IMPROVED' | 'UNCHANGED' {
  if (parent === 0 && cand === 0) return 'UNCHANGED_AT_FLOOR'
  if (parent === 0 && cand > 0) return 'LEFT_FLOOR'
  if (cand < parent) return 'DEGRADED'
  if (cand > parent) return 'IMPROVED'
  return 'UNCHANGED'
}

export function decideStop(parent: StopSnapshot, cand: StopSnapshot): {
  decision: StopDecision
  hits: string[]
  hit_count: number
  next_optimizer_step_allowed: boolean
  floor_metric_states: Record<string, string>
  generation_axis_states: Record<string, string>
} {
  let hard: string | null = null
  if (cand.nan_or_inf) hard = 'NaN_or_Inf'
  else if (cand.hash_mismatch) hard = 'hash_mismatch'
  else if (cand.contamination) hard = 'contamination'
  else if (cand.disk_integrity_failure) hard = 'disk_runtime_integrity_failure'
  else if (cand.dnll != null && cand.dnll > 0.105) hard = 'dnll_gt_0.105'
  else if (cand.kl != null && cand.kl > 0.018) hard = 'kl_gt_0.018'
  else if (cand.val0 != null && cand.val0 > 8.890125) hard = 'val0_gt_parent'
  else if (cand.cap_pass != null && cand.cap_pass <= 3) hard = 'cap_le_3_of_6'
  else if (cand.special_rate != null && cand.special_rate > 0.08) hard = 'special_rate_gt_0.08'

  const axes = {
    looping: countCmp(cand.looping, parent.looping, LOOPING_DEGRADE_DELTA, LOOPING_DEGRADE_DELTA),
    collapse: countCmp(cand.collapse, parent.collapse, COLLAPSE_DEGRADE_DELTA, COLLAPSE_DEGRADE_DELTA),
    unique128: uniqueCmp(cand.unique128, parent.unique128),
    unique256: uniqueCmp(cand.unique256, parent.unique256),
  }
  const floors: Record<string, string> = {
    json_valid: floorStatus(parent.json_valid, cand.json_valid),
    instruction: floorStatus(parent.instruction, cand.instruction),
    entity: floorStatus(parent.entity, cand.entity),
  }
  const hits = GENERATION_AXES.filter(axis => axes[axis] === 'DEGRADED')
  let decision: StopDecision
  if (hard) decision = 'HARD_ABORT'
  else if (hits.length >= SOFT_STOP_MIN_HITS) decision = 'SOFT_STOP'
  else if (hits.length >= REVIEW_REQUIRED_HITS) decision = 'REVIEW_REQUIRED'
  else decision = 'CONTINUE_ELIGIBLE'
  return {
    decision,
    hits,
    hit_count: hits.length,
    next_optimizer_step_allowed: decision === 'CONTINUE_ELIGIBLE',
    floor_metric_states: floors,
    generation_axis_states: axes,
  }
}
