import type { AgentOpsLog } from '../log'
import type { CheckpointState } from '../types'
import { handoffFor, latestCheckpoint, planResume } from './continuity'

export type SuccessorSeed =
  | { seeded: false; reason: string }
  | { seeded: true; fromAssignment: string; state: CheckpointState; skip: string[]; redo: string[]; carriedDoNotRepeat: number; conflicts: string[]; safe: boolean }

/**
 * A successor assignment (created by continueAssignment) starts from the PREDECESSOR's structured checkpoint, never from scratch and never
 * from a transcript: DONE steps whose files are still in their recorded state are kept DONE (not repeated); failed, active, drifted or
 * not-applied steps return to PENDING; doNotRepeat (including the predecessor's consequential-action keys) is carried forward. Drifted files
 * make the seed unsafe (the workflow must report CONFLICT instead of overwriting).
 */
export function seedFromHandoff(log: AgentOpsLog, successorId: string, ws: { hash(path: string): string | null; snapshot(): Record<string, string> }): SuccessorSeed {
  const h = handoffFor(log, successorId)
  if (!h) return { seeded: false, reason: 'no handoff record links this assignment to a predecessor' }
  const pred = latestCheckpoint(log, h.fromAssignment)
  if (!pred) return { seeded: false, reason: `predecessor ${h.fromAssignment} has no checkpoint` }
  const plan = planResume(log, h.fromAssignment, { fileHash: (p) => ws.hash(p), allFileHashes: ws.snapshot() })
  const redo = new Set(plan.redo.map((r) => r.stepId))
  const steps = pred.state.steps.map((s) => {
    if (s.status === 'DONE' && !redo.has(s.id)) return { ...s }
    if (s.status === 'SKIPPED') return { ...s }
    const reason = redo.has(s.id) ? plan.redo.find((r) => r.stepId === s.id)!.reason : s.status === 'FAILED' ? 'failed under the predecessor' : 'not finished by the predecessor'
    return { ...s, status: 'PENDING' as const, note: `successor retry: ${reason}`.slice(0, 160) }
  })
  const doNotRepeat = [...pred.state.doNotRepeat]
  for (const d of h.packet.doNotRepeat) if (!doNotRepeat.some((x) => x.key === d.key)) doNotRepeat.push(d)
  const state: CheckpointState = {
    ...pred.state, steps, currentStepId: steps.find((s) => s.status === 'PENDING')?.id ?? null, doNotRepeat,
    effectsDone: [...pred.state.effectsDone], stopReason: undefined, failureReason: undefined, blockers: [],
  }
  return { seeded: true, fromAssignment: h.fromAssignment, state, skip: plan.skip, redo: [...redo], carriedDoNotRepeat: doNotRepeat.length, conflicts: plan.conflicts, safe: plan.safeToResume }
}
