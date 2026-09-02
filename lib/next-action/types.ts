export type NextActionKind = 'resume_open_loop' | 'follow_up_prompt_outcome' | 'review_project' | 'no_action'

export type NextActionSourceRef = { type: 'open_loop' | 'project' | 'prompt_outcome'; id: string; label: string }

export type NextActionRecommendation = {
  kind: NextActionKind
  title: string
  rationale: string
  sourceRefs: NextActionSourceRef[]
}

export type OpenLoopForNextAction = {
  id: string
  title: string
  status: string
  priority: number
  next_action: string | null
  updated_at: string
}

export type ProjectForNextAction = {
  id: string
  name: string
  status: string
  current_objective: string | null
}

/** A delivered PromptArtifact the Commander has not yet recorded an outcome for. */
export type PendingPromptArtifact = {
  id: string
  target_agent_id: string
  intent: string
  created_at: string
}

export type NextActionInput = {
  project: ProjectForNextAction | null
  openLoops: OpenLoopForNextAction[]
  pendingPromptArtifacts: PendingPromptArtifact[]
}
