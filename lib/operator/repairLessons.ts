/**
 * Lesson candidates captured when a repair is verified (sessionStorage).
 */

import type { SelfRepairRecord } from './selfRepair/types'

export type RepairLessonCandidate = {
  id: string
  repairId: string
  gapId: string
  title: string
  summary: string
  whatWorked: string
  whatToWatch: string
  capturedAt: string
  validationEvidence: string[]
}

export type RepairLessonsSnapshot = {
  version: 1
  lessons: RepairLessonCandidate[]
}

export const REPAIR_LESSONS_STORAGE_KEY = 'war-room-repair-lessons'

const EMPTY: RepairLessonsSnapshot = { version: 1, lessons: [] }

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined'
}

export function loadRepairLessons(): RepairLessonsSnapshot {
  if (!isBrowser()) return { ...EMPTY, lessons: [] }
  try {
    const raw = sessionStorage.getItem(REPAIR_LESSONS_STORAGE_KEY)
    if (!raw) return { ...EMPTY, lessons: [] }
    const parsed = JSON.parse(raw) as Partial<RepairLessonsSnapshot>
    if (parsed.version !== 1 || !Array.isArray(parsed.lessons)) return { ...EMPTY, lessons: [] }
    return { version: 1, lessons: parsed.lessons.filter(l => typeof l.id === 'string') }
  } catch {
    return { ...EMPTY, lessons: [] }
  }
}

export function saveRepairLessons(snapshot: RepairLessonsSnapshot): void {
  if (!isBrowser()) return
  try {
    sessionStorage.setItem(REPAIR_LESSONS_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* private mode */
  }
}

export function createLessonCandidateFromRepair(record: SelfRepairRecord): RepairLessonCandidate {
  const snapshot = loadRepairLessons()
  const existing = snapshot.lessons.find(l => l.repairId === record.id)
  if (existing) return existing

  const evidence = record.validation?.evidence ?? []
  const lesson: RepairLessonCandidate = {
    id: `lesson-${record.id}`,
    repairId: record.id,
    gapId: record.gapId,
    title: record.plan.title,
    summary: record.plan.expectedBehavior,
    whatWorked: evidence.length
      ? evidence.join('; ')
      : 'Repair marked validated — add operator notes in Cursor if needed.',
    whatToWatch: `Re-run self-audit for gap ${record.gapId} after deploy.`,
    capturedAt: new Date().toISOString(),
    validationEvidence: evidence,
  }

  const next: RepairLessonsSnapshot = {
    version: 1,
    lessons: [lesson, ...snapshot.lessons],
  }
  saveRepairLessons(next)
  return lesson
}

export function countRepairLessons(snapshot = loadRepairLessons()): number {
  return snapshot.lessons.length
}
