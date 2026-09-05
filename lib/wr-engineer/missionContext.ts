/**
 * WR-Engineer mission context.
 *
 * A MissionContext is the task/scope/constraints/acceptance-criteria/result record for one unit of
 * WR-Engineer work. Distinct from lib/mission-runtime's RuntimeMission (which projects
 * lib/native-builder's issue/repair records for the Engineering Mission UI) — this is WR-Engineer's
 * own lightweight "what am I doing and how will I know I'm done" record, not a second copy of
 * native-builder's persisted state. A WR-Engineer mission that ends up creating an actual
 * native-builder repair references that repair's id in engineering memory (see
 * lib/wr-engineer/memory/types.ts's MISSION category) rather than duplicating its fields here.
 */
import { randomUUID } from 'node:crypto'
import type { EpistemicStatus, MissionAcceptanceCriterion, MissionContext } from './types'

export type CreateMissionInput = {
  task: string
  scope: string
  constraints?: string[]
  acceptanceCriteria: string[]
}

export function createMissionContext(input: CreateMissionInput): MissionContext {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    task: input.task,
    scope: input.scope,
    constraints: input.constraints ?? [],
    acceptanceCriteria: input.acceptanceCriteria.map(description => ({ description, met: false })),
    createdAt: now,
    updatedAt: now,
  }
}

/** Marks one acceptance criterion met, with the evidence that justifies it — never met without an
 * evidence string, per SOUL.md §8 (validate before declaring done). */
export function markCriterionMet(
  mission: MissionContext,
  description: string,
  evidence: string,
): MissionContext {
  const acceptanceCriteria: MissionAcceptanceCriterion[] = mission.acceptanceCriteria.map(c =>
    c.description === description ? { ...c, met: true, evidence } : c,
  )
  return { ...mission, acceptanceCriteria, updatedAt: new Date().toISOString() }
}

export function allCriteriaMet(mission: MissionContext): boolean {
  return mission.acceptanceCriteria.length > 0 && mission.acceptanceCriteria.every(c => c.met)
}

/** A mission can only be resolved 'success' if every acceptance criterion actually carries
 * evidence — this function refuses to fabricate a success result the way SOUL.md §5 forbids. */
export function resolveMission(
  mission: MissionContext,
  outcome: 'success' | 'partial' | 'failed',
  summary: string,
  epistemicStatus: EpistemicStatus,
): MissionContext {
  if (outcome === 'success' && !allCriteriaMet(mission)) {
    throw new Error(
      'Cannot resolve mission as success: not every acceptance criterion is met with evidence.',
    )
  }
  return {
    ...mission,
    result: { outcome, summary, epistemicStatus },
    updatedAt: new Date().toISOString(),
  }
}
