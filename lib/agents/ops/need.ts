import { randomUUID } from 'node:crypto'
import { NEED_CRITERIA, type NeedCriterion, type NeedEvidenceItem, type NeedRecord } from './types'

/** Criteria with no substantive evidence. Missing evidence is never defaulted. */
export function missingCriteria(need: Pick<NeedRecord, 'evidence'>): NeedCriterion[] {
  return NEED_CRITERIA.filter((c) => !need.evidence.some((e) => e.criterion === c && e.summary.trim().length >= 10 && e.evidenceRefs.filter((r) => r.trim()).length >= 1))
}

export function detectNeed(input: { title: string; evidence: NeedEvidenceItem[]; id?: string }, now: Date = new Date()): NeedRecord {
  if (!input.title.trim()) throw new Error('need title required')
  return { id: input.id ?? `need-${randomUUID()}`, title: input.title.trim(), detectedAt: now.toISOString(), evidence: input.evidence }
}
