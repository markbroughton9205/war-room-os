import type { NextActionInput, NextActionRecommendation } from './types'

/**
 * Pure and deterministic — no model call. Per Phase 16: "do not answer purely from the model's
 * guess if structured state exists." Priority: highest-priority, oldest open loop on the active
 * project → a delivered prompt artifact still awaiting a Commander outcome → review the project
 * itself if it exists but has no open loops → no_action.
 */
export function resolveNextAction(input: NextActionInput): NextActionRecommendation {
  const openLoops = input.openLoops.filter(l => l.status === 'open' || l.status === 'blocked' || l.status === 'in_progress')
  if (openLoops.length) {
    const sorted = [...openLoops].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
    })
    const top = sorted[0]
    return {
      kind: 'resume_open_loop',
      title: top.title,
      rationale: top.next_action
        ? `Highest-priority open loop on the active project; its recorded next action is: ${top.next_action}`
        : 'Highest-priority open loop on the active project with no recorded next action yet.',
      sourceRefs: [{ type: 'open_loop', id: top.id, label: top.title }],
    }
  }

  if (input.pendingPromptArtifacts.length) {
    const pending = input.pendingPromptArtifacts[0]
    return {
      kind: 'follow_up_prompt_outcome',
      title: `Report back on the ${pending.intent} prompt sent to ${pending.target_agent_id}`,
      rationale: 'A prompt artifact was generated and delivered but has no recorded outcome yet.',
      sourceRefs: [{ type: 'prompt_outcome', id: pending.id, label: pending.intent }],
    }
  }

  if (input.project) {
    return {
      kind: 'review_project',
      title: `Review ${input.project.name}`,
      rationale: input.project.current_objective
        ? `No open loops recorded; the project's current objective is: ${input.project.current_objective}`
        : 'No open loops recorded and no current objective set for the active project.',
      sourceRefs: [{ type: 'project', id: input.project.id, label: input.project.name }],
    }
  }

  return {
    kind: 'no_action',
    title: 'No active project or open loops found',
    rationale: 'There is no active project set for this conversation and no pending prompt outcomes.',
    sourceRefs: [],
  }
}
